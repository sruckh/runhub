import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { GoogleGenAI } from '@google/genai';
import { getNextLocation } from '$lib/locations';

const RUNPOD_ZIMAGE_ENDPOINT_DEFAULT = 'https://api.runpod.ai/v2/j7rrb3raom3lzh';

export const POST: RequestHandler = async ({ request }) => {
    const {
        model = 'flux-dev',
        loraUrl,
        subject,
        aspectRatio,
        geminiKey: userGeminiKey,
        rhubKey: userRhubKey,
        runpodKey: userRunpodKey,
        promptProvider = 'gemini',
        useTtDecoder = false,
        customPrompt = '',
        useCustomPrompt = false,
        // Shared extra params
        loraKeyword = '',
        // Z-Image extra params
        negativePrompt = '',
        steps = 30,
        guidanceScale = 3.5,
        seed = -1,
        loraScale = 0.9,
    } = await request.json();

    // Resolve keys: user input overrides env vars
    const geminiKey = userGeminiKey || env.GEMINI_API_KEY || '';
    const rhubKey = userRhubKey || env.RUNNINGHUB_API_KEY || '';
    const runpodKey = userRunpodKey || env.RUNPOD_API_KEY || '';

    if (!useCustomPrompt) {
        if (promptProvider === 'gemini' && !geminiKey) {
            return json({ error: 'Gemini API Key is required' }, { status: 400 });
        }
        if (promptProvider === 'runpod' && !runpodKey) {
            return json({ error: 'RunPod API Key is required' }, { status: 400 });
        }
    }

    if (model === 'flux-dev' && !rhubKey) {
        return json({ error: 'RunningHub API Key is required for FLUX.1-dev' }, { status: 400 });
    }
    if (model === 'z-image' && !runpodKey) {
        return json({ error: 'RunPod API Key is required for Z-Image' }, { status: 400 });
    }

    try {
        let finalPrompt = '';

        if (useCustomPrompt) {
            if (!customPrompt.trim()) {
                return json({ error: 'Custom prompt is required when "Use Custom Prompt" is enabled' }, { status: 400 });
            }
            finalPrompt = customPrompt.trim();
            console.log('Using CUSTOM PROMPT:', finalPrompt);
        } else {
            if (!subject.trim()) {
                return json({ error: 'Subject characteristics are required for AI prompt engineering' }, { status: 400 });
            }

            const askAI = async (system: string, user: string, temperature = 1.0): Promise<string> => {
                if (promptProvider === 'gemini') {
                    const ai = new GoogleGenAI({ apiKey: geminiKey });
                    const response = await ai.models.generateContent({
                        model: 'gemini-3-flash-preview',
                        contents: user,
                        config: { systemInstruction: system, temperature }
                    });
                    return (response.text || '').trim();
                } else {
                    const runpodPayload = {
                        input: {
                            model: "qwen3-30b-a3b",
                            messages: [
                                { role: "system", content: system },
                                { role: "user", content: user }
                            ],
                            temperature
                        }
                    };
                    const response = await fetch('https://api.runpod.ai/v2/xj5960btg70pgu/runsync', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${runpodKey}` },
                        body: JSON.stringify(runpodPayload)
                    });
                    const data = await response.json();
                    if (data.status === 'COMPLETED') return data.output.result.choices[0].message.content.trim();
                    throw new Error('RunPod call failed');
                }
            };

            // STEP 1: Pick location from curated pool (true randomness, no AI bias)
            const location = getNextLocation();
            console.log('Step 1: Location (from pool):', location);

            // STEP 2: AI designs composition for this location + subject
            console.log('Step 2: Choosing Composition...');
            const compositionPrompt = await askAI(
                `You are a professional photographer planning a social media shoot.
Given a specific location and subject, describe a compelling composition, lighting, and activity.
Rules:
- Avoid cliches: no "standing and smiling", no "looking at camera", no "posing".
- Think about movement, candidness, cinematic angles, and storytelling.
- Describe specific clothing that fits the location and mood.
- Include time of day and lighting quality.
Location: ${location}
Subject: ${loraKeyword ? `${loraKeyword} — ` : ''}${subject}`,
                "Describe the scene in 2-3 vivid sentences: composition, activity, clothing, and lighting.",
                1.3
            );

            // STEP 3: Generate final FLUX prompt
            console.log('Step 3: Generating FLUX Prompt...');
            const finalSystemPrompt = `You are an expert FLUX.1-dev prompt engineer.
Generate a single, detailed prompt for a character LoRA photograph that looks like a real social media post.

RULES:
1. You MUST incorporate the LOCATION and COMPOSITION provided — do not change them.
2. FORBIDDEN: "leather jacket", "neon lights", "nightclub", "flash photography", "brick wall", "bokeh".
3. Focus on authentic everyday realism: natural textures, real fabrics, ambient lighting.
4. Include specific details: fabric types, colors, accessories, environment textures.
5. Output format: PROMPT: <single detailed prompt here>${loraKeyword ? `\n6. You MUST include the exact trigger word "${loraKeyword}" in the prompt as the subject's name/identifier — do not paraphrase or omit it.` : ''}`;

            const finalUserMessage = `Subject: ${loraKeyword ? `${loraKeyword} — ` : ''}${subject}\nLocation: ${location}\nComposition: ${compositionPrompt}\n\nGenerate one detailed, unique FLUX prompt.`;

            const responseText = await askAI(finalSystemPrompt, finalUserMessage, 1.0);
            const promptMatch = responseText.match(/PROMPT:\s*(.*)/is);
            finalPrompt = promptMatch ? promptMatch[1].trim() : responseText.trim();
        }

        const { width, height } = calculateDimensions(aspectRatio);

        // ── Z-Image via RunPod Serverless ──────────────────────────────────────
        if (model === 'z-image') {
            const endpointUrl = env.RUNPOD_ZIMAGE_ENDPOINT || RUNPOD_ZIMAGE_ENDPOINT_DEFAULT;
            const effectiveSeed = seed === -1 ? Math.floor(Math.random() * 1000000000) : seed;

            console.log(`[Z-Image] Submitting: "${finalPrompt.substring(0, 80)}..." seed=${effectiveSeed}`);

            const zimageRes = await fetch(`${endpointUrl}/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${runpodKey}` },
                body: JSON.stringify({
                    input: {
                        prompt: finalPrompt,
                        ...(loraUrl ? { lora_url: loraUrl } : {}),
                        negative_prompt: negativePrompt,
                        width,
                        height,
                        steps,
                        guidance_scale: guidanceScale,
                        seed: effectiveSeed,
                        lora_scale: loraScale,
                    }
                })
            });

            const zimageData = await zimageRes.json();
            if (!zimageData.id) throw new Error(`RunPod submission failed: ${JSON.stringify(zimageData)}`);
            console.log(`[Z-Image] Job queued: ${zimageData.id}`);

            return json({ jobId: zimageData.id, model: 'z-image', prompt: finalPrompt });
        }

        // ── FLUX.1-dev via RunningHub ──────────────────────────────────────────
        const rhubPayload = {
            nodeInfoList: [
                { nodeId: "4", fieldName: "text", fieldValue: finalPrompt },
                { nodeId: "6", fieldName: "height", fieldValue: height.toString() },
                { nodeId: "6", fieldName: "width", fieldValue: width.toString() },
                { nodeId: "70", fieldName: "value", fieldValue: Math.floor(Math.random() * 1000000000).toString() },
                { nodeId: "80", fieldName: "value", fieldValue: loraUrl },
                { nodeId: "81", fieldName: "value", fieldValue: "1" }
            ],
            instanceType: "default",
            usePersonalQueue: "false"
        };

        const workflowId = useTtDecoder ? '1982245789865000962' : '2021692093294452738';
        const rhubResponse = await fetch(`https://www.runninghub.ai/openapi/v2/run/ai-app/${workflowId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rhubKey}` },
            body: JSON.stringify(rhubPayload)
        });

        const submitData = await rhubResponse.json();
        if (!submitData.taskId) throw new Error(`RunningHub submission failed: ${JSON.stringify(submitData)}`);

        return json({ taskId: submitData.taskId, model: 'flux-dev', prompt: finalPrompt });

    } catch (err: any) {
        console.error('Generation init error:', err);
        return json({ error: err.message }, { status: 500 });
    }
};

function calculateDimensions(ar: string) {
    const [wRatio, hRatio] = ar.split(':').map(Number);
    const ratio = wRatio / hRatio;
    const targetArea = 1024 * 1024;
    let h = Math.sqrt(targetArea / ratio);
    let w = h * ratio;
    return { width: Math.ceil(w / 16) * 16, height: Math.ceil(h / 16) * 16 };
}
