import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { env } from "$env/dynamic/private";

const FAL_MODEL = "bytedance/seedance-2.0/reference-to-video";

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const falKey = (body.falKey as string) || env.FAL_KEY || "";

    if (!falKey) return json({ error: "fal.ai API Key is required" }, { status: 400 });
    if (!body.prompt?.trim()) return json({ error: "Prompt is required" }, { status: 400 });

    const input: Record<string, unknown> = {
      prompt: body.prompt.trim(),
      resolution: body.resolution || "720p",
      duration: body.duration || "auto",
      aspect_ratio: body.aspect_ratio || "auto",
      generate_audio: body.generate_audio !== false,
    };

    if (Array.isArray(body.image_urls) && body.image_urls.filter(Boolean).length > 0) {
      input.image_urls = body.image_urls.filter(Boolean);
    }

    if (typeof body.seed === "number" && body.seed >= 0) {
      input.seed = body.seed;
    }

    console.log(`[Video] Submitting to FAL queue: ${FAL_MODEL}`);

    const submitRes = await fetch(`https://queue.fal.run/${FAL_MODEL}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${falKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    if (!submitRes.ok) {
      const errorText = await submitRes.text();
      throw new Error(`FAL submit failed: ${submitRes.status} ${errorText}`);
    }

    const submitData = await submitRes.json();
    const requestId = submitData.request_id;
    if (!requestId) {
      throw new Error(`No request_id in FAL response: ${JSON.stringify(submitData)}`);
    }

    console.log(`[Video] FAL request submitted: ${requestId}`);
    return json({
      requestId,
      outputDir: body.outputDir || "generations",
      prefix: body.prefix || "video",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Video] Error:", err);
    return json({ error: message }, { status: 500 });
  }
};
