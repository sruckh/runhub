import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GoogleGenAI } from '@google/genai';
import { getNextLocation } from '$lib/locations';

export const POST: RequestHandler = async ({ request }) => {
    const {
        loraUrl,
        subject,
        aspectRatio,
        geminiKey,
        rhubKey,
        runpodKey: userRunpodKey,
        promptProvider = 'gemini',
        useTtDecoder = false,
        customPrompt = '',
        useCustomPrompt = false
    } = await request.json();

    // Use user-provided RunPod key (no fallback to env var)
    const runpodKey = userRunpodKey;

    if (!useCustomPrompt) {
        if (promptProvider === 'gemini' && !geminiKey) {
            return json({ error: 'Gemini API Key is required' }, { status: 400 });
        }
        if (promptProvider === 'runpod' && !runpodKey) {
            return json({ error: 'RunPod API Key is required' }, { status: 400 });
        }
    }
    
    if (!rhubKey) {
        return json({ error: 'RunningHub API Key is required' }, { status: 400 });
    }

    try {
        let finalPrompt = '';

        if (useCustomPrompt) {
            if (!customPrompt.trim()) {
                return json({ error: 'Custom prompt is required when "Use Custom Prompt" is enabled' }, { status: 400 });
            }
            finalPrompt = customPrompt.trim();
            console.log('Using CUSTOM PROMPT (Directly to RunningHub):', finalPrompt);
        } else {
            if (!subject.trim()) {
                return json({ error: 'Subject characteristics are required for AI prompt engineering' }, { status: 400 });
            }
            // Helper for AI calls
            async function askAI(system: string, user: string, temperature = 1.0) {
                if (promptProvider === 'gemini') {
                    const ai = new GoogleGenAI({ apiKey: geminiKey });
                    const response = await ai.models.generateContent({
                        model: 'gemini-3-flash-preview',
                        contents: user,
                        config: {
                            systemInstruction: system,
                            temperature
                        }
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
            }

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
Subject: ${subject}`,
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
5. Output format: PROMPT: <single detailed prompt here>`;

            const finalUserMessage = `Subject: ${subject}\nLocation: ${location}\nComposition: ${compositionPrompt}\n\nGenerate one detailed, unique FLUX prompt.`;

            const responseText = await askAI(finalSystemPrompt, finalUserMessage, 1.0);
            const promptMatch = responseText.match(/PROMPT:\s*(.*)/is);
            finalPrompt = promptMatch ? promptMatch[1].trim() : responseText.trim();
        }

        const { width, height } = calculateDimensions(aspectRatio);

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

        return json({ taskId: submitData.taskId, prompt: finalPrompt });

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
