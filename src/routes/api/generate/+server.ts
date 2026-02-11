import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { RUNPOD_API_KEY } from '$env/static/private';

export const POST: RequestHandler = async ({ request }) => {
    const {
        loraUrl,
        subject,
        aspectRatio,
        geminiKey,
        rhubKey,
        runpodKey: userRunpodKey,
        promptProvider = 'gemini'
    } = await request.json();

    const runpodKey = userRunpodKey || RUNPOD_API_KEY;

    if (promptProvider === 'gemini' && !geminiKey) {
        return json({ error: 'Gemini API Key is required' }, { status: 400 });
    }
    if (promptProvider === 'runpod' && !runpodKey) {
        return json({ error: 'RunPod API Key is required' }, { status: 400 });
    }
    if (!rhubKey) {
        return json({ error: 'RunningHub API Key is required' }, { status: 400 });
    }

    try {
        let finalPrompt = '';

        // Helper for AI calls
        async function askAI(system: string, user: string, temperature = 1.0) {
            if (promptProvider === 'gemini') {
                const genAI = new GoogleGenerativeAI(geminiKey);
                const model = genAI.getGenerativeModel({ 
                    model: "gemini-1.5-flash",
                    generationConfig: { temperature }
                });
                const result = await model.generateContent([{ text: system }, { text: user }]);
                return result.response.text().trim();
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

        // STEP 1: Choose a Location
        console.log('Step 1: Choosing Location...');
        const locationPrompt = await askAI(
            "You are a travel scout. Pick a specific, visually stunning, and unique location in the world that would make an incredible social media photograph. Be specific (e.g., 'A hidden blue-water cenote in Tulum' instead of just 'Mexico').",
            "Pick one random, high-vibe location. Output ONLY the location name and a 5-word description.",
            1.5 // High temperature for variety
        );

        // STEP 2: Choose Composition/Activity
        console.log('Step 2: Choosing Composition for Location:', locationPrompt);
        const compositionPrompt = await askAI(
            `You are a professional photographer. Given a location and a subject, describe a compelling composition, lighting setup, and activity. 
            Avoid cliches like "standing and smiling". Think about movement, candidness, and cinematic angles.
            Location: ${locationPrompt}
            Subject: ${subject}`,
            "Describe the scene's composition, the subject's activity, and the lighting in 2-3 sentences.",
            1.2
        );

        // STEP 3: Generate Final FLUX Prompt
        console.log('Step 3: Generating Final FLUX Prompt...');
        const finalSystemPrompt = `You are an expert FLUX.1‑dev prompt engineer.
Your task is to generate a single, high-fidelity prompt for a character LoRA that looks like a high-quality social media post or professional photograph.

STRICT UNIQUENESS PROTOCOL:
1. You MUST use the LOCATION and COMPOSITION provided.
2. EXPLICITLY FORBIDDEN: Do not use "leather jackets", "neon lights", "nightclubs", "flash photography", or "brick walls". 
3. Focus on authentic, diverse everyday realism.
4. Output format: PROMPT: <single detailed prompt here>`;

        const finalUserMessage = `Subject: ${subject}\nLocation: ${locationPrompt}\nComposition & Vibe: ${compositionPrompt}\n\nTASK: Create a unique, detailed prompt. Focus on textures, specific clothing items, and natural lighting.`;

        const responseText = await askAI(finalSystemPrompt, finalUserMessage, 1.0);
        const promptMatch = responseText.match(/PROMPT:\s*(.*)/i);
        finalPrompt = promptMatch ? promptMatch[1].trim() : responseText.trim();

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

        const rhubResponse = await fetch('https://www.runninghub.ai/openapi/v2/run/ai-app/1982245789865000962', {
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
