import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { env } from "$env/dynamic/private";
import { GoogleGenAI } from "@google/genai";
import { getNextLocation } from "$lib/locations";
import fs from "fs/promises";
import path from "path";

const RUNPOD_ZIMAGE_ENDPOINT_DEFAULT = "https://api.runpod.ai/v2/j7rrb3raom3lzh";
const RUNPOD_FLUX_KLEIN_ENDPOINT_DEFAULT = "https://api.runpod.ai/v2/639jlguymlblim";

// Where generated images are persisted (shared with /api/enhance and /api/upscale).
const MOUNT_PATH = "/mount";

export const POST: RequestHandler = async ({ request }) => {
  const {
    model = "flux-dev",
    loraUrl,
    subject,
    aspectRatio,
    outputDir = "generations",
    prefix = "image",
    geminiKey: userGeminiKey,
    rhubKey: userRhubKey,
    runpodKey: userRunpodKey,
    falKey: userFalKey,
    promptProvider = "gemini",
    useTtDecoder = false,
    customPrompt = "",
    useCustomPrompt = false,
    // Shared extra params
    loraKeyword = "",
    flux_dev_seed = 0,
    flux_dev_lora_strength = 1,
    // FLUX.2-klein multi-LoRA stack (array of { url, keyword, scale })
    kleinLoras = [],
    // Z-Image / FLUX.2-klein extra params
    steps = 50,
    guidanceScale = 4.5,
    seed = -1,
    loraScale = 0.85,
    shift = null,
    preset = "realistic_character",
    // Z-Image new params
    zimage_negative_prompt = "",
    zimage_max_sequence_length = 512,
    zimage_use_beta_sigmas = false,
    zimage_cfg_normalization = true,
    zimage_cfg_truncation = 1.0,
    zimage_vae_tiling = null,
    upscale_model = "nomos_webphoto",
    upscale_enabled = true,
    upscale_factor = 1.5,
    // Z-Image second pass params
    second_pass_enabled = true,
    second_pass_upscale = 1.25,
    second_pass_strength = 0.42,
    second_pass_guidance_scale = 4.5,
    second_pass_steps = 28,
    second_pass_seed = null,
    second_pass_max_sequence_length = 512,
    second_pass_cfg_normalization = true,
    second_pass_cfg_truncation = 1.0,
    second_pass_use_beta_sigmas = null,
    second_pass_vae_tiling = false,
    second_pass_vae_slicing = true,
    // FLUX.2-klein 2nd pass / upscale params
    klein_enable_2nd_pass = false,
    klein_second_pass_strength = 0.2,
    klein_second_pass_steps = 4,
    klein_enable_upscale = false,
    klein_upscale_factor = 2.0,
    klein_upscale_blend = 0.35,
    klein_max_sequence_length = 512,
    klein_shift = 0,
    klein_width = 1024,
    klein_height = 1024,
    // RunningHub ZImage Upscale + Face Detailer params
    rhub_zimage_style = "None",
    rhub_zimage_width = 896,
    rhub_zimage_height = 1120,
    // RunningHub FLUX.2-klein params
    rhub_klein_workflow = "standard",
    rhub_klein_lora1_url = "",
    rhub_klein_aspect_ratio = "1:1",
    rhub_klein_orientation = "portrait",
    // RunningHub Krea2 Kim params (fixed LoRA; trigger K1mScum is forced below)
    kim_lora_strength = 1,
    kim_aspect_ratio = "1:1 (Square)",
  } = await request.json();

  // Resolve keys: user input overrides env vars
  const geminiKey = userGeminiKey || env.GEMINI_API_KEY || "";
  const rhubKey = userRhubKey || env.RUNNINGHUB_API_KEY || "";
  const runpodKey = userRunpodKey || env.RUNPOD_API_KEY || "";
  const falKey = userFalKey || env.FAL_KEY || "";

  if (!useCustomPrompt) {
    if (promptProvider === "gemini" && !geminiKey) {
      return json({ error: "Gemini API Key is required" }, { status: 400 });
    }
    if (promptProvider === "runpod" && !runpodKey) {
      return json({ error: "RunPod API Key is required" }, { status: 400 });
    }
  }

  if ((model === "flux-dev" || model === "rhub-zimage" || model === "rhub-klein") && !rhubKey) {
    return json({ error: "RunningHub API Key is required" }, { status: 400 });
  }
  if ((model === "z-image" || model === "flux-klein") && !runpodKey) {
    return json({ error: `RunPod API Key is required for ${model}` }, { status: 400 });
  }
  if (model === "fal-ideogram4" && !falKey) {
    return json({ error: "fal.ai API Key is required for Ideogram4" }, { status: 400 });
  }
  // RunningHost Ideogram4 workflow is not wired up yet — fail fast with a clear
  // message and make NO upstream API call.
  if (model === "rhub-ideogram4") {
    return json({ error: "Ideogram4 on RunningHub is not available yet" }, { status: 400 });
  }

  try {
    let finalPrompt = "";

    const normalizedKleinLoras = (Array.isArray(kleinLoras) ? kleinLoras : []).map(
      (entry: any) => ({
        url: typeof entry?.url === "string" ? entry.url.trim() : "",
        keyword: typeof entry?.keyword === "string" ? entry.keyword.trim() : "",
        scale:
          typeof entry?.scale === "number" && Number.isFinite(entry.scale) ? entry.scale : 0.85,
      }),
    );
    const kleinTriggerWords = Array.from(
      new Set(normalizedKleinLoras.map((l) => l.keyword).filter(Boolean)),
    );
    const effectiveLoraKeyword =
      (model === "flux-klein" || model === "z-image")
        ? kleinTriggerWords.join(", ") ||
          (typeof loraKeyword === "string" ? loraKeyword.trim() : "")
        : typeof loraKeyword === "string"
          ? loraKeyword.trim()
          : "";

    if (useCustomPrompt) {
      if (!customPrompt.trim()) {
        return json(
          { error: 'Custom prompt is required when "Use Custom Prompt" is enabled' },
          { status: 400 },
        );
      }
      finalPrompt = customPrompt.trim();
      console.log("Using CUSTOM PROMPT:", finalPrompt);
    } else {
      if (!subject.trim()) {
        return json(
          { error: "Subject characteristics are required for AI prompt engineering" },
          { status: 400 },
        );
      }

      const askAI = async (system: string, user: string, temperature = 1.0): Promise<string> => {
        if (promptProvider === "gemini") {
          const ai = new GoogleGenAI({ apiKey: geminiKey });
          const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: user,
            config: { systemInstruction: system, temperature },
          });
          return (response.text || "").trim();
        } else {
          const runpodPayload = {
            input: {
              model: "qwen3-30b-a3b",
              messages: [
                { role: "system", content: system },
                { role: "user", content: user },
              ],
              temperature,
            },
          };
          const response = await fetch("https://api.runpod.ai/v2/xj5960btg70pgu/runsync", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${runpodKey}` },
            body: JSON.stringify(runpodPayload),
          });
          const data = await response.json();
          if (data.status === "COMPLETED")
            return data.output.result.choices[0].message.content.trim();
          throw new Error("RunPod call failed");
        }
      };

      // STEP 1: Pick location from curated pool (true randomness, no AI bias)
      const location = getNextLocation();
      console.log("Step 1: Location (from pool):", location);

      // STEP 2: AI designs composition for this location + subject
      console.log("Step 2: Choosing Composition...");
      const compositionPrompt = await askAI(
        `You are a professional photographer planning a social media shoot.
Given a specific location and subject, describe a compelling composition, lighting, and activity.
Rules:
- Avoid cliches: no "standing and smiling", no "looking at camera", no "posing".
- Think about movement, candidness, cinematic angles, and storytelling.
- Describe specific clothing that fits the location and mood.
- Include time of day and lighting quality.
Location: ${location}
Subject: ${effectiveLoraKeyword ? `${effectiveLoraKeyword} — ` : ""}${subject}`,
        "Describe the scene in 2-3 vivid sentences: composition, activity, clothing, and lighting.",
        1.3,
      );

      // STEP 3: Generate final prompt
      console.log(
        `Step 3: Generating ${model === "z-image" || model === "rhub-zimage" ? "Z-Image" : model === "flux-klein" ? "FLUX-Klein" : "FLUX"} Prompt...`,
      );
      let finalSystemPrompt = "";
      let finalUserMessage = "";

      if (model === "flux-klein") {
        finalSystemPrompt = `You are **FLUX Prompt Director** — a specialized prompt-refinement assistant for **FLUX.2 [klein] 9B**.

## Mission
When the user provides **(a)** an idea, **(b)** a messy prompt, or **(c)** a prompt written for another image model, you will transform it into a **single, cut-and-paste-ready, highly detailed, highly optimized prompt** for **FLUX.2 [klein] 9B**.

Your default bias is toward **realistic, photographic images featuring people**, with believable anatomy, natural skin texture, and real-world lighting.

You do **not** explain your reasoning. You do **not** include citations. You output only the requested final artifacts.

---

## Core Principles (Non-Negotiable)
1. **Write like a novelist, not a search engine.**  
   Convert keyword lists into natural, vivid prose that clearly describes relationships, materials, and physical reality.

2. **Assume no automatic “upsampling.”**  
   The final prompt must be complete, richly descriptive, and specific. Do not rely on the model to infer missing details.

3. **Use the reliable structure:**  
   **Subject → Setting → Details → Lighting → Atmosphere**

4. **Lighting is the strongest realism lever.**  
   Always describe lighting like a photographer: source, direction, quality, temperature, and how it interacts with skin and surfaces.

5. **Word order matters.**  
   Front-load the most important information: main subject + action + photographic intent, then context, then supporting details.

6. **Be detailed but purposeful.**  
   Every phrase must add visual specificity. Avoid filler, hype words, and contradictory instructions.

---

## Default Bias: Photographic Realism with People
Unless the user overrides, assume:
- Photorealistic / editorial / documentary realism
- Human subjects with believable proportions and natural expression
- Skin microtexture (pores, fine hairs), realistic hair strands, subtle imperfections
- Clothing that behaves like fabric (seams, folds, weight, stretch, wrinkles)
- Plausible optics (depth of field, lens behavior, motion blur only when justified)
- Realistic environment physics (reflections, shadows, bounce light, atmospheric depth)

---

## Prompt Construction Rules
### Output should be:
- **One cohesive paragraph** (typically 2–8 sentences)
- **30–120 words** by default (expand only when the concept demands it)
- Written in **clear, cinematic, photographic prose**
- Focused on a **single, coherent scene**

### Always follow this internal order:
1. **Subject (first words):**
   - Who/what (person or people), age range, appearance, defining features
   - Wardrobe and materials
   - Pose/body language and facial expression
   - Action (what they are doing) and intent

2. **Setting:**
   - Location, time of day, season, era if relevant
   - Key spatial elements (foreground/background), believable context

3. **Details:**
   - Materials, textures, small props, grooming, makeup if relevant
   - Environmental cues (dust in sunbeams, condensation, bokeh highlights)
   - Concrete physical descriptors (glass, metal, fabric types, skin sheen)

4. **Lighting (mandatory, specific):**
   Include ALL of these when possible:
   - Source(s): natural, practicals, softbox, window light, streetlights, etc.
   - Direction: camera-left/right, backlight, rim light, overhead, bounce fill
   - Quality: soft/diffused vs hard/direct, falloff, shadow softness
   - Temperature: warm/cool, golden hour, tungsten, fluorescent, mixed lighting
   - Interaction: catchlights, specular highlights, subsurface scattering in skin,
     reflections on glass/metal, bounce off walls, edge separation from background

5. **Atmosphere:**
   - Mood and emotional tone (quiet intimacy, confident energy, tense stillness)
   - Air quality cues (haze, mist, rain) only if they fit the concept

### Optional tags (only when helpful)
At the end of the paragraph, you MAY add:
- Style: ...
- Mood: ...

Keep them short and consistent with photorealism.

---

## Photographic Specificity (Use When It Helps)
Add concrete camera language when it improves results:
- Lens choice: **35mm** (environmental), **50mm** (natural perspective), **85mm** (portrait)
- Framing: close-up / head-and-shoulders / three-quarter / full-body
- Depth of field: shallow DOF with sharp eyes; background softly blurred
- Composition: rule of thirds, centered symmetry, leading lines (subtle)
- Film/sensor vibe: “35mm film look” or “medium format clarity” (only if relevant)

Avoid excessive technical jargon. Use only what reinforces the visual.

---

## Handling Different User Inputs
### If the user gives keywords:
- Rewrite into flowing prose with clear relationships and physical realism.

### If the user gives another-model prompt:
- Translate it into this system’s structure and prose.
- Remove model-specific tokens that don’t help.
- Preserve meaningful constraints (subject, setting, lens, mood, time of day, wardrobe).

### If the user is vague:
- Make strong, creative decisions that increase realism:
  choose lighting, lens/framing, wardrobe materials, and a coherent setting.
- Do not ask questions unless the user explicitly requests a Q&A flow.

### If the user gives constraints:
- Follow them exactly (modesty, no logos, PG tone, specific wardrobe, etc.).

---

## Output Format (ALWAYS)
Return **only** the following sections, nothing else:

**OPTIMIZED PROMPT:**
<one paragraph, subject-first, lighting explicit, atmosphere clear; optional Style/Mood lines only if helpful>${kleinTriggerWords.length > 0 ? `\n\nYou MUST include each exact trigger word in the prompt: ${kleinTriggerWords.map((w) => `"${w}"`).join(", ")}.` : ""}

Do not include analysis, bullet explanations, or extra commentary.`;

        finalUserMessage = `Subject: ${effectiveLoraKeyword ? `${effectiveLoraKeyword} — ` : ""}${subject}\nLocation: ${location}\nComposition: ${compositionPrompt}\n\nGenerate the optimized FLUX.2 [klein] 9B prompt.`;
      } else if (model === "z-image" || model === "rhub-zimage") {
        finalSystemPrompt = `# Role
You are the Z-Image Turbo Prompt Architect. Your goal is to transform simple user ideas into "Single-Stream DiT" optimized prompts for the Z-Image Turbo 6B model.

# Model Knowledge
- Architecture: Single-Stream DiT (Text, semantic, and VAE tokens are unified).
- Strengths: Extreme photorealism, skin textures, volumetric lighting, and accurate bilingual (English/Chinese) text rendering.
- Constraints: Does NOT use negative prompts effectively. You must use "positive constraints" (e.g., "sharp focus" instead of "no blur").
- Length: Prefers long, descriptive prose (80–250 words).

# Prompt Structure Protocol
When the user gives a concept, generate a prompt using this 4-Layer framework:
1. [Subject & Action]: Detailed description of the person/object, their age, clothing, and specific movement.
2. [Style & Lens]: Specify the medium (e.g., "cinematic film still," "Hasselblad X1D," "Leica M6," "Kodak Portra 400").
3. [Lighting & Atmosphere]: Focus on Z-Image's strength: "volumetric lighting," "rim light," "chiaroscuro," or "soft studio glow."
4. [Technical Polish]: Add "8k," "sharp focus," "intricate skin textures," and "cinematic composition."

# Text Rendering Rules
- If the user wants text, wrap it in double quotes: "TEXT".
- Describe the placement (e.g., "a large neon sign saying 'OPEN' in the background").
- Z-Image supports Chinese; use it if requested (e.g., "Chinese title '造相' in gold calligraphy").

# Response Format
1. **The Optimized Prompt**: A single block of text ready for copy-pasting.`;

        finalUserMessage = `Concept: ${effectiveLoraKeyword ? `${effectiveLoraKeyword} — ` : ""}${subject}\nLocation: ${location}\nComposition: ${compositionPrompt}\n\nGenerate the optimized prompt.`;
      } else {
        // Original Generic FLUX Prompt used for flux-dev
        finalSystemPrompt = `You are an expert FLUX.1-dev prompt engineer.
Generate a single, detailed prompt for a character LoRA photograph that looks like a real social media post.

RULES:
1. You MUST incorporate the LOCATION and COMPOSITION provided — do not change them.
2. FORBIDDEN: "leather jacket", "neon lights", "nightclub", "flash photography", "brick wall", "bokeh".
3. Focus on authentic everyday realism: natural textures, real fabrics, ambient lighting.
4. Include specific details: fabric types, colors, accessories, environment textures.
5. Output format: PROMPT: <single detailed prompt here>${effectiveLoraKeyword ? `\n6. You MUST include the exact trigger word "${effectiveLoraKeyword}" in the prompt as the subject's name/identifier — do not paraphrase or omit it.` : ""}`;

        finalUserMessage = `Subject: ${effectiveLoraKeyword ? `${effectiveLoraKeyword} — ` : ""}${subject}\nLocation: ${location}\nComposition: ${compositionPrompt}\n\nGenerate one detailed, unique FLUX prompt.`;
      }

      const responseText = await askAI(finalSystemPrompt, finalUserMessage, 1.0);

      let promptMatch: RegExpMatchArray | null = null;

      if (model === "flux-klein") {
        promptMatch = responseText.match(/OPTIMIZED PROMPT:\s*(.*)/is);
      } else if (model === "z-image" || model === "rhub-zimage") {
        promptMatch = responseText.match(/\*\*The Optimized Prompt\*\*:\s*(.*)/is);
      } else {
        promptMatch = responseText.match(/PROMPT:\s*(.*)/is);
      }

      finalPrompt = promptMatch ? promptMatch[1].trim() : responseText.trim();
    }

    // ── Z-Image via RunPod Serverless ──────────────────────────────────────
    if (model === "z-image") {
      const { width, height } = calculateDimensions(aspectRatio);
      const endpointUrl = env.RUNPOD_ZIMAGE_ENDPOINT || RUNPOD_ZIMAGE_ENDPOINT_DEFAULT;
      const effectiveSeed = seed === -1 ? Math.floor(Math.random() * 1000000000) : seed;

      console.log(
        `[Z-Image] Submitting: "${finalPrompt.substring(0, 80)}..." seed=${effectiveSeed}`,
      );

      // Build multi-LoRA array if provided, else legacy
      const activeLoras = normalizedKleinLoras.filter((l) => l.url?.trim());
      const lorasPayload =
        activeLoras.length > 0
          ? { loras: activeLoras.map((l) => ({ url: l.url.trim(), scale: l.scale })) }
          : loraUrl
            ? { lora_url: loraUrl, lora_scale: loraScale }
            : {};

      const zimageRes = await fetch(`${endpointUrl}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${runpodKey}` },
        body: JSON.stringify({
          input: {
            prompt: finalPrompt,
            ...(zimage_negative_prompt !== "" ? { negative_prompt: zimage_negative_prompt } : {}),
            width,
            height,
            steps,
            guidance_scale: guidanceScale,
            seed: effectiveSeed,
            ...(shift !== null ? { shift } : {}),
            max_sequence_length: zimage_max_sequence_length,
            use_beta_sigmas: zimage_use_beta_sigmas,
            cfg_normalization: zimage_cfg_normalization,
            cfg_truncation: zimage_cfg_truncation,
            ...(zimage_vae_tiling !== null ? { vae_tiling: zimage_vae_tiling } : {}),
            upscale_model,
            upscale_enabled: second_pass_enabled ? false : upscale_enabled,
            upscale_factor,
            ...lorasPayload,
            second_pass_enabled,
            ...(second_pass_enabled
              ? {
                  second_pass_upscale,
                  second_pass_strength,
                  second_pass_steps,
                  second_pass_guidance_scale,
                  ...(second_pass_seed !== null ? { second_pass_seed } : {}),
                  second_pass_max_sequence_length,
                  second_pass_cfg_normalization,
                  second_pass_cfg_truncation,
                  ...(second_pass_use_beta_sigmas !== null
                    ? { second_pass_use_beta_sigmas }
                    : {}),
                  second_pass_vae_tiling,
                  second_pass_vae_slicing,
                }
              : {}),
          },
        }),
      });

      const zimageData = await zimageRes.json();
      if (!zimageData.id)
        throw new Error(`RunPod submission failed: ${JSON.stringify(zimageData)}`);
      return json({ jobId: zimageData.id, model: "z-image", prompt: finalPrompt });
    }

    // ── FLUX.2-klein via RunPod Serverless ─────────────────────────────────
    if (model === "flux-klein") {
      const endpointUrl = env.RUNPOD_FLUX_KLEIN_ENDPOINT || RUNPOD_FLUX_KLEIN_ENDPOINT_DEFAULT;
      const effectiveSeed = seed === -1 ? Math.floor(Math.random() * 1000000000) : seed;

      console.log(
        `[FLUX-Klein] Submitting: "${finalPrompt.substring(0, 80)}..." preset=${preset} seed=${effectiveSeed}`,
      );

      // Build multi-LoRA array from kleinLoras entries that have a URL
      const activeLoras = normalizedKleinLoras.filter((l) => l.url?.trim());
      const legacyLoraUrl = typeof loraUrl === "string" ? loraUrl.trim() : "";
      const lorasForPayload =
        activeLoras.length > 0
          ? activeLoras
          : legacyLoraUrl
            ? [{ url: legacyLoraUrl, keyword: effectiveLoraKeyword, scale: loraScale }]
            : [];
      const lorasPayload =
        lorasForPayload.length > 0
          ? {
              loras: lorasForPayload.map((l, i) => {
                const safeKeyword = l.keyword
                  .toLowerCase()
                  .replace(/[^a-z0-9_-]+/g, "_")
                  .replace(/^_+|_+$/g, "")
                  .slice(0, 40);
                return {
                  path: l.url.trim(),
                  scale: l.scale,
                  adapter_name: safeKeyword ? `${safeKeyword}_${i}` : `flux_lora_${i}`,
                };
              }),
            }
          : {};

      const kleinRes = await fetch(`${endpointUrl}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${runpodKey}` },
        body: JSON.stringify({
          input: {
            prompt: finalPrompt,
            preset,
            width: klein_width,
            height: klein_height,
            ...lorasPayload,
            seed: effectiveSeed,
            output_format: "jpeg",
            return_type: "s3",
            max_sequence_length: Number(klein_max_sequence_length) || 512,
            lora_scale_mode: "absolute",
            ...(klein_shift > 0 ? { shift: klein_shift } : {}),
            ...(klein_enable_2nd_pass
              ? {
                  enable_2nd_pass: true,
                  second_pass_strength: klein_second_pass_strength,
                  second_pass_steps: klein_second_pass_steps,
                }
              : {}),
            ...(klein_enable_upscale
              ? {
                  enable_upscale: true,
                  upscale_factor: klein_upscale_factor,
                  upscale_blend: klein_upscale_blend,
                }
              : {}),
          },
        }),
      });

      const kleinData = await kleinRes.json();
      if (!kleinData.id) throw new Error(`RunPod submission failed: ${JSON.stringify(kleinData)}`);
      return json({ jobId: kleinData.id, model: "flux-klein", prompt: finalPrompt });
    }

    // ── ZImage Upscale + Face Detailer via RunningHub ─────────────────────
    if (model === "rhub-zimage") {
      const effectiveSeed = seed === -1 ? Math.floor(Math.random() * 1000000000) : seed;

      console.log(
        `[RHUB-ZImage] Submitting style="${rhub_zimage_style}" seed=${effectiveSeed} size=${rhub_zimage_width}x${rhub_zimage_height}`,
      );
      console.log(
        `[RHUB-ZImage] nodeId 98 fieldValue raw: ${JSON.stringify(`"${rhub_zimage_style}"`)}`,
      );
      console.log(`[RHUB-ZImage] Prompt (first 80): ${finalPrompt.substring(0, 80)}`);

      const rhubZimagePayload = {
        nodeInfoList: [
          {
            nodeId: "81",
            fieldName: "value",
            fieldValue: rhub_zimage_width.toString(),
            description: "Width before 2x Upscale",
          },
          {
            nodeId: "82",
            fieldName: "value",
            fieldValue: rhub_zimage_height.toString(),
            description: "Height before 2x Upscale",
          },
          {
            nodeId: "83",
            fieldName: "value",
            fieldValue: effectiveSeed.toString(),
            description: "Seed",
          },
          {
            nodeId: "89",
            fieldName: "value",
            fieldValue: loraUrl || "",
            description: "ZImage LoRA URL",
          },
          { nodeId: "99", fieldName: "value", fieldValue: finalPrompt, description: "Prompt" },
          {
            nodeId: "98",
            fieldName: "text",
            fieldValue: `"${rhub_zimage_style}"`,
            description: "Image Style",
          },
        ],
        instanceType: "default",
        usePersonalQueue: "false",
      };

      const rhubZimageResponse = await fetch(
        "https://www.runninghub.ai/openapi/v2/run/ai-app/2027454454034862082",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${rhubKey}` },
          body: JSON.stringify(rhubZimagePayload),
        },
      );

      const zimageSubmitData = await rhubZimageResponse.json();
      if (!zimageSubmitData.taskId)
        throw new Error(`RunningHub ZImage submission failed: ${JSON.stringify(zimageSubmitData)}`);

      return json({ taskId: zimageSubmitData.taskId, model: "rhub-zimage", prompt: finalPrompt });
    }

    // ── FLUX.2-klein via RunningHub ─────────────────────────────────────────
    if (model === "rhub-klein") {
      // Aspect ratio lookup (closest to 1K, divisible by 32)
      const rhubKleinAspectRatios: Record<string, { width: number; height: number }> = {
        "1:1": { width: 1024, height: 1024 },
        "2:3": { width: 672, height: 1024 },
        "3:4": { width: 768, height: 1024 },
        "4:5": { width: 832, height: 1024 },
        "9:16": { width: 576, height: 1024 },
        "21:9": { width: 448, height: 1024 },
      };

      const baseDims = rhubKleinAspectRatios[rhub_klein_aspect_ratio] || { width: 1024, height: 1024 };
      const rhub_klein_width = rhub_klein_orientation === "landscape" ? baseDims.height : baseDims.width;
      const rhub_klein_height = rhub_klein_orientation === "landscape" ? baseDims.width : baseDims.height;

      const selectedLora =
        typeof rhub_klein_lora1_url === "string" ? rhub_klein_lora1_url.trim() : "";
      if (!selectedLora) {
        return json({ error: "Character LoRA URL is required for FLUX.2-klein (RH)" }, { status: 400 });
      }

      console.log(
        `[RHUB-Klein] Submitting ${rhub_klein_aspect_ratio} ${rhub_klein_orientation} = ${rhub_klein_width}x${rhub_klein_height}`,
      );
      console.log(`[RHUB-Klein] Character LoRA URL: ${selectedLora}`);
      console.log(`[RHUB-Klein] Prompt (first 80): ${finalPrompt.substring(0, 80)}`);

      const isUpscaleWorkflow = rhub_klein_workflow === "upscale";
      const rhubKleinAppId = isUpscaleWorkflow
        ? "2029780093899378690"
        : "2036237857823662082";
      const rhubKleinDimensionNodes = isUpscaleWorkflow
        ? [
            {
              nodeId: "205",
              fieldName: "height",
              fieldValue: rhub_klein_height.toString(),
              description: "Height before Upscale",
            },
            {
              nodeId: "205",
              fieldName: "width",
              fieldValue: rhub_klein_width.toString(),
              description: "Width before Upscale",
            },
          ]
        : [
            {
              nodeId: "98",
              fieldName: "value",
              fieldValue: rhub_klein_width.toString(),
              description: "Width",
            },
            {
              nodeId: "99",
              fieldName: "value",
              fieldValue: rhub_klein_height.toString(),
              description: "Height",
            },
          ];
      const rhubKleinPayload = {
        nodeInfoList: [
          {
            nodeId: isUpscaleWorkflow ? "447" : "132",
            fieldName: "value",
            fieldValue: selectedLora,
            description: "URL of Character LoRA",
          },
          ...rhubKleinDimensionNodes,
          {
            nodeId: isUpscaleWorkflow ? "396" : "6",
            fieldName: "text",
            fieldValue: finalPrompt,
            description: "Prompt",
          },
        ],
        instanceType: "default",
        usePersonalQueue: "false",
      };

      const rhubKleinResponse = await fetch(
        `https://www.runninghub.ai/openapi/v2/run/ai-app/${rhubKleinAppId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${rhubKey}` },
          body: JSON.stringify(rhubKleinPayload),
        },
      );

      const kleinSubmitData = await rhubKleinResponse.json();
      if (!kleinSubmitData.taskId)
        throw new Error(`RunningHub Klein submission failed: ${JSON.stringify(kleinSubmitData)}`);

      return json({ taskId: kleinSubmitData.taskId, model: "rhub-klein", prompt: finalPrompt });
    }

    // ── Ideogram4 via fal.ai (synchronous fal.run call) ────────────────────
    if (model === "fal-ideogram4") {
      // fal's LoRAInput uses `path` (the weights URL) + `scale`. Only send a
      // loras entry when a Character LoRA URL is present.
      const ideogramLoraUrl = typeof loraUrl === "string" ? loraUrl.trim() : "";
      const ideogramLoraScale =
        typeof loraScale === "number" && Number.isFinite(loraScale) ? loraScale : 0.85;
      const ideogramLoras = ideogramLoraUrl
        ? [{ path: ideogramLoraUrl, scale: ideogramLoraScale }]
        : [];

      console.log(
        `[FAL-Ideogram4] Submitting loras=${ideogramLoras.length} scale=${ideogramLoraScale}`,
      );
      console.log(`[FAL-Ideogram4] Prompt (first 80): ${finalPrompt.substring(0, 80)}`);

      const ideogramResponse = await fetch("https://fal.run/ideogram/v4/lora", {
        method: "POST",
        headers: {
          Authorization: `Key ${falKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: finalPrompt,
          loras: ideogramLoras,
          expansion_model: "None",
          rendering_speed: "QUALITY",
          acceleration: "none",
          enable_safety_checker: false,
          output_format: "png",
          num_images: 1,
        }),
      });

      if (!ideogramResponse.ok) {
        const errorText = await ideogramResponse.text();
        console.error(
          `[FAL-Ideogram4] fal.ai error: ${ideogramResponse.status} ${errorText}`,
        );
        throw new Error(`fal.ai API error: ${ideogramResponse.status}`);
      }

      const ideogramData = await ideogramResponse.json();
      const resultImageUrl = ideogramData?.images?.[0]?.url;
      if (!resultImageUrl) throw new Error("No image URL in fal.ai response");

      // Sync path: download + persist now, mirroring /api/enhance and /api/upscale.
      const fullOutputDir = path.join(MOUNT_PATH, outputDir);
      await fs.mkdir(fullOutputDir, { recursive: true });

      const imageRes = await fetch(resultImageUrl);
      if (!imageRes.ok)
        throw new Error(`Failed to download Ideogram4 image: ${imageRes.status}`);
      const arrayBuffer = await imageRes.arrayBuffer();
      const imageBuffer = Buffer.from(arrayBuffer);

      const filename = await getNextFilename(fullOutputDir, prefix, "png");
      await fs.writeFile(path.join(fullOutputDir, filename), imageBuffer);
      console.log(`[FAL-Ideogram4] Saved: ${filename}`);

      return json({ model: "fal-ideogram4", filename, prompt: finalPrompt });
    }

    // ── Krea2 Kim via RunningHub ───────────────────────────────────────────
    if (model === "rhub-krea2-kim") {
      // The workflow's LoRA is fixed; its trigger word (K1mScum) MUST be present
      // in every prompt. Inject it if the user didn't include it.
      const kimPrompt = /K1mScum/i.test(finalPrompt)
        ? finalPrompt
        : `K1mScum ${finalPrompt}`.trim();

      const kimLoraStrength =
        typeof kim_lora_strength === "number" && Number.isFinite(kim_lora_strength)
          ? kim_lora_strength
          : 1;

      // Krea2 Kim takes explicit width/height (nodeId 148/149). The UI still
      // exposes an aspect-ratio dropdown; resolve it to pixels here, mirroring
      // the other RHUB services (long side ~1024). Both dims are forced to be
      // divisible by 8 (see the rounding below) — a hard requirement of the
      // workflow.
      const kimAspectRatioOptions = [
        "1:1 (Square)",
        "2:3 (Portrait Photo)",
        "3:2 (Photo)",
        "3:4 (Portrait Standard)",
        "4:3 (Standard)",
        "4:5 (Portrait)",
        "5:4 (Landscape)",
        "9:16 (Portrait Widescreen)",
        "16:9 (Widescreen)",
        "21:9 (Ultrawide)",
        "1.91:1 (Facebook/LinkedIn)",
      ];
      const kimDimensions: Record<string, { width: number; height: number }> = {
        "1:1 (Square)": { width: 1024, height: 1024 },
        "2:3 (Portrait Photo)": { width: 672, height: 1024 },
        "3:2 (Photo)": { width: 1024, height: 672 },
        "3:4 (Portrait Standard)": { width: 768, height: 1024 },
        "4:3 (Standard)": { width: 1024, height: 768 },
        "4:5 (Portrait)": { width: 832, height: 1024 },
        "5:4 (Landscape)": { width: 1024, height: 832 },
        "9:16 (Portrait Widescreen)": { width: 576, height: 1024 },
        "16:9 (Widescreen)": { width: 1024, height: 576 },
        "21:9 (Ultrawide)": { width: 1024, height: 448 },
        "1.91:1 (Facebook/LinkedIn)": { width: 1024, height: 536 },
      };
      const kimAspectRatio = kimAspectRatioOptions.includes(kim_aspect_ratio)
        ? kim_aspect_ratio
        : "1:1 (Square)";
      const kimDims = kimDimensions[kimAspectRatio] ?? { width: 1024, height: 1024 };
      // Hard guarantee of the workflow's divisible-by-8 constraint; idempotent
      // for the 8-aligned table values above (e.g. 536 is 8- but not 32-aligned).
      const kimWidth = Math.round(kimDims.width / 8) * 8;
      const kimHeight = Math.round(kimDims.height / 8) * 8;

      console.log(
        `[RHUB-Krea2Kim] Submitting aspect="${kimAspectRatio}" ${kimWidth}x${kimHeight} loraStrength=${kimLoraStrength}`,
      );
      console.log(`[RHUB-Krea2Kim] Prompt (first 80): ${kimPrompt.substring(0, 80)}`);

      const rhubKimPayload = {
        nodeInfoList: [
          { nodeId: "81", fieldName: "value", fieldValue: kimPrompt, description: "Prompt" },
          {
            nodeId: "82",
            fieldName: "strength_model",
            fieldValue: String(kimLoraStrength),
            description: "LoRA Strength",
          },
          {
            nodeId: "148",
            fieldName: "value",
            fieldValue: String(kimWidth),
            description: "Width",
          },
          {
            nodeId: "149",
            fieldName: "value",
            fieldValue: String(kimHeight),
            description: "Height",
          },
        ],
        instanceType: "default",
        usePersonalQueue: "false",
      };

      const rhubKimResponse = await fetch(
        "https://www.runninghub.ai/openapi/v2/run/ai-app/2073899469871075329",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${rhubKey}` },
          body: JSON.stringify(rhubKimPayload),
        },
      );

      const kimSubmitData = await rhubKimResponse.json();
      if (!kimSubmitData.taskId)
        throw new Error(`RunningHub Krea2 Kim submission failed: ${JSON.stringify(kimSubmitData)}`);

      return json({ taskId: kimSubmitData.taskId, model: "rhub-krea2-kim", prompt: kimPrompt });
    }

    // ── FLUX.1-dev via RunningHub ──────────────────────────────────────────
    const { width: fluxDevWidth, height: fluxDevHeight } =
      calculateRunningHubDimensions(aspectRatio);
    const fluxDevSeed =
      typeof flux_dev_seed === "number" && Number.isFinite(flux_dev_seed)
        ? Math.round(flux_dev_seed)
        : 0;
    const fluxDevLoraStrength =
      typeof flux_dev_lora_strength === "number" && Number.isFinite(flux_dev_lora_strength)
        ? flux_dev_lora_strength
        : 1;
    const rhubPayload = {
      nodeInfoList: [
        { nodeId: "4", fieldName: "text", fieldValue: finalPrompt },
        { nodeId: "6", fieldName: "width", fieldValue: fluxDevWidth.toString() },
        { nodeId: "6", fieldName: "height", fieldValue: fluxDevHeight.toString() },
        {
          nodeId: "70",
          fieldName: "value",
          fieldValue: fluxDevSeed.toString(),
        },
        { nodeId: "80", fieldName: "value", fieldValue: loraUrl },
        { nodeId: "81", fieldName: "value", fieldValue: fluxDevLoraStrength.toString() },
      ],
      instanceType: "default",
      usePersonalQueue: "false",
    };

    const fluxDevWorkflow = useTtDecoder
      ? "1982245789865000962"
      : "2021692093294452738";

    const rhubResponse = await fetch(
      `https://www.runninghub.ai/openapi/v2/run/ai-app/${fluxDevWorkflow}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${rhubKey}` },
        body: JSON.stringify(rhubPayload),
      },
    );

    const submitData = await rhubResponse.json();
    if (!submitData.taskId)
      throw new Error(`RunningHub submission failed: ${JSON.stringify(submitData)}`);

    return json({ taskId: submitData.taskId, model: "flux-dev", prompt: finalPrompt });
  } catch (err: any) {
    console.error("Generation init error:", err);
    return json({ error: err.message }, { status: 500 });
  }
};

function calculateDimensions(ar: string) {
  const [wRatio, hRatio] = ar.split(":").map(Number);
  const ratio = wRatio / hRatio;
  const targetArea = 1024 * 1024;
  let h = Math.sqrt(targetArea / ratio);
  let w = h * ratio;
  return { width: Math.ceil(w / 16) * 16, height: Math.ceil(h / 16) * 16 };
}

function calculateRunningHubDimensions(ar: string) {
  const [wRatio, hRatio] = ar.split(":").map(Number);
  const ratio = wRatio / hRatio;
  const targetArea = 1024 * 1024;
  let h = Math.sqrt(targetArea / ratio);
  let w = h * ratio;
  return { width: Math.ceil(w / 32) * 32, height: Math.ceil(h / 32) * 32 };
}

// Shared with /api/enhance and /api/upscale — sequential <prefix>_NNN.<ext>.
async function getNextFilename(
  dir: string,
  prefix: string,
  extension: string,
): Promise<string> {
  const files = await fs.readdir(dir);
  const regex = new RegExp(
    `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_(\\d{3})\\.${extension}$`,
  );
  let maxNum = 0;
  for (const file of files) {
    const match = file.match(regex);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }
  return `${prefix}_${String(maxNum + 1).padStart(3, "0")}.${extension}`;
}
