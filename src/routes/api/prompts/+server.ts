import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GoogleGenAI } from '@google/genai';

export const POST: RequestHandler = async ({ request }) => {
    try {
        const {
            provider,
            subject,
            geminiKey,
            runpodKey
        } = await request.json();

        if (!subject) {
            return json({ error: 'Subject is required' }, { status: 400 });
        }

        if (provider === 'gemini') {
            if (!geminiKey) {
                return json({ error: 'Gemini API Key is required' }, { status: 400 });
            }

            const ai = new GoogleGenAI({ apiKey: geminiKey });
            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: `Subject: ${subject}\n\nGenerate a single detailed prompt.`,
                config: {
                    systemInstruction: `You are an expert image prompt engineer.
Your task is to generate a single, high-fidelity prompt for an image generation model (like FLUX or Midjourney).
The prompt should be descriptive, focusing on lighting, composition, style, and detail.
Output ONLY the prompt text, nothing else.`,
                    temperature: 1.0
                }
            });
            const responseText = response.text || '';
            
            return json({ prompt: responseText.trim() });

        } else if (provider === 'runpod') {
            if (!runpodKey) {
                return json({ error: 'RunPod API Key is required' }, { status: 400 });
            }

            const runpodPayload = {
                input: {
                    model: "qwen3-30b-a3b",
                    messages: [
                        { 
                            role: "system", 
                            content: "You are an expert image prompt engineer. Generate a detailed, high-quality prompt for an image generation model based on the user's request. Output ONLY the final prompt." 
                        },
                        { 
                            role: "user", 
                            content: subject 
                        }
                    ],
                    temperature: 0.7,
                    max_tokens: 1000
                }
            };

            const response = await fetch('https://api.runpod.ai/v2/xj5960btg70pgu/runsync', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${runpodKey}`
                },
                body: JSON.stringify(runpodPayload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                return json({ error: `RunPod API error: ${response.status}`, details: errorText }, { status: response.status });
            }

            const data = await response.json();
            
            if (data.status === 'COMPLETED' && data.output && data.output.result) {
                const choices = data.output.result.choices;
                if (choices && choices.length > 0) {
                    const content = choices[0].message.content;
                    // Clean up markdown if present
                    const cleanContent = content.replace(/^(PROMPT:|\*\*AI Image Prompt:\*\*)\s*/i, '').trim();
                    return json({ prompt: cleanContent });
                }
            }

            return json({ error: 'Unexpected RunPod response format', data }, { status: 500 });

        } else {
            return json({ error: 'Invalid provider. Choose "gemini" or "runpod".' }, { status: 400 });
        }

    } catch (err: any) {
        console.error('Prompt generation error:', err);
        return json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
};
