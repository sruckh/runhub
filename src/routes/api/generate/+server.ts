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

    const scenarios = [
        "A sun-drenched Mediterranean balcony overlooking a turquoise ocean, light linen clothing, breakfast setting.",
        "A high-end modern art gallery with minimalist white walls, wearing sophisticated avant-garde tailoring, soft gallery spotlighting.",
        "A rugged mountain hiking trail at golden hour, wearing technical outdoor gear, vast valley view in the background.",
        "A rainy afternoon inside a cozy, plant-filled greenhouse or conservatory, wearing a soft wool cardigan and jeans.",
        "A professional high-rise office at blue hour, city lights through floor-to-ceiling glass, wearing a sharp business suit.",
        "A vibrant local farmer's market in a rustic village, holding a basket of fresh produce, wearing a sundress and sunhat.",
        "A gritty industrial workshop or garage, natural light through dusty windows, wearing stained denim overalls.",
        "A snowy luxury ski resort lounge, sitting by a roaring stone fireplace, wearing a heavy cable-knit sweater and winter boots.",
        "A sun-bleached desert landscape at dusk, wearing bohemian desert attire, long shadows and warm orange lighting.",
        "A sleek, futuristic underground subway station, clean lines and cool fluorescent lighting, wearing techwear-inspired street fashion."
    ];

    const randomScenario = scenarios[Math.floor(Math.random() * scenarios.length)];

    try {
        const genAI = new GoogleGenerativeAI(geminiKey);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-3-pro-preview",
            generationConfig: { temperature: 1.3, topP: 0.95 }
        });

        const systemPrompt = `You are an expert FLUX.1‑dev prompt engineer.
Your task is to generate a single, high-fidelity prompt for a character LoRA that looks like a high-quality social media post or professional photograph.

STRICT UNIQUENESS PROTOCOL:
1. You MUST use the SPECIFIC SCENARIO provided in the user prompt as the exclusive setting.
2. EXPLICITLY FORBIDDEN: Do not use "leather jackets", "neon lights", "nightclubs", "flash photography", or "brick walls" in this generation. 
3. Focus on authentic, diverse everyday realism.
4. Output format: PROMPT: <single detailed prompt here>`;

        console.log('Generating unique prompt with Scenario:', randomScenario);
        const geminiResult = await model.generateContent([
            { text: systemPrompt },
            { text: `Subject Characteristics: ${subject}\nREQUIRED SCENARIO: ${randomScenario}\n\nTASK: Create a unique, detailed prompt. Focus on textures, specific clothing items (not leather), and natural lighting.` }
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

        const rhubResponse = await fetch('https://www.runninghub.ai/openapi/v2/run/ai-app/1982245789865000962', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rhubKey}` },
            body: JSON.stringify(rhubPayload)
        });

        const submitData = await rhubResponse.json();
        if (!submitData.taskId) throw new Error(`RunningHub submission failed: ${JSON.stringify(submitData)}`);

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
