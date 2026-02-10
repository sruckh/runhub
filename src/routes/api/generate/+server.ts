import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const POST: RequestHandler = async ({ request }) => {
    const {
        loraUrl,
        subject,
        aspectRatio,
        geminiKey,
        rhubKey
    } = await request.json();

    if (!geminiKey || !rhubKey) {
        return json({ error: 'API Keys are required' }, { status: 400 });
    }

    try {
        const genAI = new GoogleGenerativeAI(geminiKey);
        // Use temperature 1.0+ for higher randomness/variety
        const model = genAI.getGenerativeModel({ 
            model: "gemini-3-pro-preview",
            generationConfig: {
                temperature: 1.2,
                topP: 0.95,
            }
        });

        const systemPrompt = `You are an expert FLUX.1‑dev prompt engineer. Your task is to generate a single, high-fidelity prompt for a character LoRA that looks like a high-quality social media post or professional photograph.

STRICT REALISM & VARIETY PROTOCOL:
1. Every prompt must depict a scene that could actually exist in the real world. NO fantasy, NO sci-fi, NO surrealism.
2. Focus on "Social Media Realism": Think Instagram, TikTok, Pinterest, or Travel Photography.
3. REAL-WORLD ANCHORING: For every request, randomly choose a distinct realistic 'anchor': [Candid Urban Street, Cozy Modern Interior, Luxury Travel Destination, Moody Nightlife/Cityscape, Outdoor Fitness/Adventure, High-Fashion Streetwear, Seasonal Nature (Autumn woods/Beach/Snow), or Chic Cafe/Restaurant].
4. VARY EVERYTHING: Change the time of day, weather, camera angle (candid, selfie-style, professional portrait), and clothing style while staying true to the subject's characteristics.

DO NOT USE PLACEHOLDERS: Never use "[TRIGGER]", "[CHARACTER]", or "trigger".

1. Overall goals: Maximize character fidelity, natural language, 25-60 words.
3. Modular structure: Character identity, Subject + action, Environment / context, Lighting & mood, Style & technical modifiers.
7. Output format: PROMPT: <single detailed prompt here>`;

        console.log('Generating realistic unique prompt with Social Media Anchoring...');
        const geminiResult = await model.generateContent([
            { text: systemPrompt },
            { text: `Subject Characteristics: ${subject}\n\nTASK: Generate a prompt for a REALISTIC, grounded, and visually interesting scene. Avoid cliches like "standing in a park" or "drinking coffee" unless the composition is unique. Focus on authentic textures and lighting.` }
        ]);
        const responseText = geminiResult.response.text();
        const promptMatch = responseText.match(/PROMPT:\s*(.*)/i);
        const finalPrompt = promptMatch ? promptMatch[1].trim() : responseText.trim();

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

        console.log('--- RunningHub Submission Data ---');
        console.log('URL: https://www.runninghub.ai/openapi/v2/run/ai-app/1982245789865000962');
        console.log('Payload:', JSON.stringify(rhubPayload, null, 2));

        const rhubResponse = await fetch('https://www.runninghub.ai/openapi/v2/run/ai-app/1982245789865000962', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${rhubKey}`
            },
            body: JSON.stringify(rhubPayload)
        });

        const submitData = await rhubResponse.json();
        console.log('RunningHub Raw Response:', JSON.stringify(submitData, null, 2));
        
        if (!submitData.taskId) {
            throw new Error(`RunningHub submission failed: ${submitData.errorMessage || JSON.stringify(submitData)}`);
        }

        return json({ taskId: submitData.taskId, prompt: finalPrompt });

    } catch (err) {
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