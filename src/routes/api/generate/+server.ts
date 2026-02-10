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
        "A friend group laughing at an outdoor café table.",
        "A solo traveler posing with a suitcase in an airport terminal.",
        "A couple holding hands while walking through a city at night.",
        "A family picnic on a blanket in a sunny park.",
        "A runner mid-stride on a bridge at sunrise.",
        "A gym selfie in the mirror with headphones on.",
        "A yoga class in a bright studio, everyone in a pose.",
        "A chef plating food in a restaurant kitchen.",
        "A barista pouring latte art behind the counter.",
        "A student studying at a desk with a laptop and notes.",
        "A person reading a book in a cozy window seat.",
        "A group toasting drinks at a rooftop bar.",
        "Friends at a backyard BBQ flipping burgers.",
        "A birthday person blowing out candles with friends around.",
        "A wedding couple walking down the aisle smiling.",
        "Bridesmaids and groomsmen lined up for a formal photo.",
        "A parent holding a toddler on a playground.",
        "A baby's first birthday smash-cake moment.",
        "Friends in matching outfits at a themed party.",
        "A prom couple posing under string lights.",
        "A street-style fashion shot on a crosswalk.",
        "A model posing against a textured wall for an outfit post.",
        "A 'get ready with me' mirror photo showing full fit.",
        "A group in coordinated costumes at a festival.",
        "A musician playing guitar on a small stage.",
        "A DJ behind decks with club lighting.",
        "A concert crowd selfie with the stage behind.",
        "A person singing into a microphone in karaoke.",
        "Friends dancing at a wedding reception.",
        "A dancer mid-leap in a studio with dramatic shadows.",
        "A graduation cap toss with classmates.",
        "A new job 'first day' photo in office attire.",
        "A team meeting around a whiteboard.",
        "Coworkers celebrating a launch with confetti.",
        "A remote-work laptop setup with a person in frame.",
        "A person holding a 'sold' sign outside a house.",
        "A doctor or nurse smiling in scrubs at a hospital corridor.",
        "A firefighter in gear near a truck.",
        "A teacher in a classroom pointing at a board.",
        "A mechanic working under a lifted car.",
        "A hair stylist cutting hair in a salon chair.",
        "A nail artist showing freshly done nails with the client.",
        "A tattoo artist at work with gloved hands.",
        "A spa moment: person in robe with cucumber water.",
        "A skincare routine sink selfie with products visible.",
        "A 'before and after' makeover split-frame with the same person.",
        "A couple cooking together in a home kitchen.",
        "A person holding a homemade loaf of bread, bake day.",
        "Friends doing a potluck spread at a dining table.",
        "A person eating a messy street taco mid-bite, candid.",
        "A coffee-and-pastry flat lay with hands reaching in.",
        "A 'cheers' shot with hands clinking glasses close-up.",
        "Friends road-tripping in a car, candid laughter.",
        "A person leaning on a convertible with scenic backdrop.",
        "A cyclist pausing with bike beside a mountain view.",
        "A hiker standing on a summit with arms raised.",
        "A group in matching jerseys at a stadium.",
        "A basketball player taking a shot on an outdoor court.",
        "A surfer holding a board at the shoreline.",
        "A skier on a snowy slope with goggles up.",
        "A person kayaking on calm water.",
        "A camper cooking by a campfire with tents behind.",
        "Friends under a starry sky doing a long-exposure shot.",
        "A person in a hammock with a tropical beach behind.",
        "A couple at a landmark doing a timer photo.",
        "A group on a boat deck with wind-blown hair.",
        "A person snorkeling selfie with mask and reef water.",
        "A person in a museum looking at a painting, over-the-shoulder.",
        "Friends at an art gallery opening with drinks.",
        "A person holding a new book at a bookstore shelf.",
        "A cafe laptop and matcha shot with a person typing.",
        "A person journaling at a desk with candles lit.",
        "A cozy rainy-day portrait by a foggy window.",
        "Friends in winter coats walking through a snowy street.",
        "A person holding an umbrella in neon city rain.",
        "A silhouette portrait at golden hour in a field.",
        "A couple sitting on a bench watching a sunset.",
        "A proposal moment captured mid-kneel.",
        "Friends hugging goodbye at a train station.",
        "A pet-owner selfie with a dog licking their face.",
        "A family photo with everyone wearing matching pajamas.",
        "A holiday dinner table with a host in frame serving food.",
        "A Halloween pumpkin-carving scene with friends.",
        "A New Year's countdown selfie with sparklers.",
        "A person at a farmers market holding flowers.",
        "A volunteer handing out supplies at a community event.",
        "A charity run group photo with bib numbers visible.",
        "A person speaking on a panel with audience blurred behind.",
        "A candid 'behind the scenes' photo on a photo or video set.",
        "A person unboxing a product with excited expression.",
        "A 'new haircut reveal' spinning chair shot.",
        "A couple doing a 'date night' elevator mirror selfie.",
        "Friends doing a 'photo booth strip' style pose lineup.",
        "A person holding a sign at a protest or march.",
        "A sports fan face-painted, cheering in the stands.",
        "A person posing with a diploma close-up, smiling.",
        "A chef's-table portrait holding a signature dish.",
        "A person in a library aisle, pulling a book, candid.",
        "A group at a beach playing volleyball mid-action.",
        "A person reflecting in a mirror with artistic composition."
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
