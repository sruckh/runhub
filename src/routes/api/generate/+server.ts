import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { env } from "$env/dynamic/private";
import { GoogleGenAI } from "@google/genai";
import { getNextLocation } from "$lib/locations";

const RUNPOD_ZIMAGE_ENDPOINT_DEFAULT = "https://api.runpod.ai/v2/j7rrb3raom3lzh";
const RUNPOD_FLUX_KLEIN_ENDPOINT_DEFAULT = "https://api.runpod.ai/v2/639jlguymlblim";

export const POST: RequestHandler = async ({ request }) => {
  const {
    model = "flux-dev",
    loraUrl,
    subject,
    aspectRatio,
    geminiKey: userGeminiKey,
    rhubKey: userRhubKey,
    runpodKey: userRunpodKey,
    promptProvider = "gemini",
    useTtDecoder = false,
    customPrompt = "",
    useCustomPrompt = false,
    // Shared extra params
    loraKeyword = "",
    // FLUX.2-klein multi-LoRA stack (array of { url, keyword, scale })
    kleinLoras = [],
    // Z-Image / FLUX.2-klein extra params
    steps = 30,
    guidanceScale = 3.5,
    seed = -1,
    loraScale = 0.9,
    shift = 1.5,
    preset = "realistic_character",
    // Z-Image second pass params
    second_pass_enabled = false,
    second_pass_upscale = 1.5,
    second_pass_strength = 0.18,
    second_pass_guidance_scale = 1.2,
    // FLUX.2-klein 2nd pass / upscale params
    klein_enable_2nd_pass = false,
    klein_second_pass_strength = 0.2,
    klein_second_pass_steps = 12,
    klein_second_pass_lora_scale_multiplier = 1.0,
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
    rhub_klein_lora1_url = "",
    rhub_klein_lora1_keyword = "",
    rhub_klein_lora1_strength = 0,
    rhub_klein_lora2_url = "",
    rhub_klein_lora2_keyword = "",
    rhub_klein_lora2_strength = 0,
    rhub_klein_aspect_ratio = "1:1",
    rhub_klein_orientation = "portrait",
  } = await request.json();

  // Resolve keys: user input overrides env vars
  const geminiKey = userGeminiKey || env.GEMINI_API_KEY || "";
  const rhubKey = userRhubKey || env.RUNNINGHUB_API_KEY || "";
  const runpodKey = userRunpodKey || env.RUNPOD_API_KEY || "";

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

    const { width, height } = calculateDimensions(aspectRatio);

    // ── Z-Image via RunPod Serverless ──────────────────────────────────────
    if (model === "z-image") {
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
            width,
            height,
            steps,
            guidance_scale: guidanceScale,
            seed: effectiveSeed,
            ...lorasPayload,
            second_pass_enabled,
            second_pass_upscale,
            second_pass_strength,
            second_pass_guidance_scale,
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
                  second_pass_lora_scale_multiplier: klein_second_pass_lora_scale_multiplier,
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

      // Build trigger words prefix from LoRA keywords
      const triggerWords = [rhub_klein_lora1_keyword, rhub_klein_lora2_keyword]
        .filter((k) => k?.trim())
        .join(", ");
      const promptWithTriggers = triggerWords
        ? `${triggerWords} — ${finalPrompt}`
        : finalPrompt;

      console.log(
        `[RHUB-Klein] Submitting ${rhub_klein_aspect_ratio} ${rhub_klein_orientation} = ${rhub_klein_width}x${rhub_klein_height}`,
      );
      console.log(`[RHUB-Klein] LoRA1: ${rhub_klein_lora1_url || "none"} (${rhub_klein_lora1_strength}) keyword="${rhub_klein_lora1_keyword}"`);
      console.log(`[RHUB-Klein] LoRA2: ${rhub_klein_lora2_url || "none"} (${rhub_klein_lora2_strength}) keyword="${rhub_klein_lora2_keyword}"`);
      console.log(`[RHUB-Klein] Prompt (first 80): ${promptWithTriggers.substring(0, 80)}`);

      const rhubKleinPayload = {
        nodeInfoList: [
          {
            nodeId: "425",
            fieldName: "value",
            fieldValue: rhub_klein_lora1_url || "",
            description: "URL of LoRA 1 safetensor",
          },
          {
            nodeId: "427",
            fieldName: "value",
            fieldValue: rhub_klein_lora1_strength.toString(),
            description: "Strength of LoRA 1",
          },
          {
            nodeId: "426",
            fieldName: "value",
            fieldValue: rhub_klein_lora2_url || "",
            description: "URL of LoRA 2 safetensor",
          },
          {
            nodeId: "428",
            fieldName: "value",
            fieldValue: rhub_klein_lora2_strength.toString(),
            description: "Strength of LoRA 2",
          },
          {
            nodeId: "396",
            fieldName: "text",
            fieldValue: promptWithTriggers,
            description: "Prompt",
          },
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
        ],
        instanceType: "default",
        usePersonalQueue: "false",
      };

      const rhubKleinResponse = await fetch(
        "https://www.runninghub.ai/openapi/v2/run/ai-app/2029780093899378690",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${rhubKey}` },
          body: JSON.stringify(rhubKleinPayload),
        },
      );

      const kleinSubmitData = await rhubKleinResponse.json();
      if (!kleinSubmitData.taskId)
        throw new Error(`RunningHub Klein submission failed: ${JSON.stringify(kleinSubmitData)}`);

      return json({ taskId: kleinSubmitData.taskId, model: "rhub-klein", prompt: promptWithTriggers });
    }

    // ── FLUX.1-dev via RunningHub ──────────────────────────────────────────
    const rhubPayload = {
      nodeInfoList: [
        { nodeId: "4", fieldName: "text", fieldValue: finalPrompt },
        { nodeId: "6", fieldName: "height", fieldValue: height.toString() },
        { nodeId: "6", fieldName: "width", fieldValue: width.toString() },
        {
          nodeId: "70",
          fieldName: "value",
          fieldValue: Math.floor(Math.random() * 1000000000).toString(),
        },
        { nodeId: "80", fieldName: "value", fieldValue: loraUrl },
        { nodeId: "81", fieldName: "value", fieldValue: "1" },
      ],
      instanceType: "default",
      usePersonalQueue: "false",
    };

    const workflowId = useTtDecoder ? "1982245789865000962" : "2021692093294452738";
    const rhubResponse = await fetch(
      `https://www.runninghub.ai/openapi/v2/run/ai-app/${workflowId}`,
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
