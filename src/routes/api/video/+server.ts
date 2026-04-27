import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { env } from "$env/dynamic/private";

const FAL_MODEL = "bytedance/seedance-2.0/reference-to-video";
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const VALID_RESOLUTIONS = new Set(["480p", "720p", "1080p"]);
const VALID_DURATIONS = new Set(["auto", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"]);
const VALID_ASPECT_RATIOS = new Set(["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]);
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const AUDIO_MIME_TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav"]);
const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime"]);

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function dataUriInfo(value: string): { mimeType: string; bytes: number } | null {
  const match = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const padding = match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0;
  return {
    mimeType: match[1].toLowerCase(),
    bytes: Math.floor((match[2].length * 3) / 4) - padding,
  };
}

function validateReferences(
  label: string,
  values: string[],
  maxCount: number,
  allowedMimeTypes: Set<string>,
  maxDataUriBytes: number,
): string | null {
  if (values.length > maxCount) return `${label} supports at most ${maxCount} files`;

  for (const value of values) {
    if (value.startsWith("data:")) {
      const info = dataUriInfo(value);
      if (!info) return `${label} data URIs must be base64 encoded`;
      if (!allowedMimeTypes.has(info.mimeType)) return `${label} contains unsupported file type ${info.mimeType}`;
      if (info.bytes > maxDataUriBytes) return `${label} data URI exceeds ${Math.floor(maxDataUriBytes / 1024 / 1024)} MB`;
      continue;
    }

    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return `${label} must contain public http(s) URLs or base64 data URIs`;
      }
    } catch {
      return `${label} contains an invalid URL`;
    }
  }

  return null;
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const falKey = (body.falKey as string) || env.FAL_KEY || "";

    if (!falKey) return json({ error: "fal.ai API Key is required" }, { status: 400 });
    if (!body.prompt?.trim()) return json({ error: "Prompt is required" }, { status: 400 });

    const resolution = typeof body.resolution === "string" ? body.resolution : "720p";
    const duration = typeof body.duration === "string" ? body.duration : "auto";
    const aspectRatio = typeof body.aspect_ratio === "string" ? body.aspect_ratio : "auto";
    const imageUrls = stringArray(body.image_urls);
    const videoUrls = stringArray(body.video_urls);
    const audioUrls = stringArray(body.audio_urls);
    const totalReferences = imageUrls.length + videoUrls.length + audioUrls.length;

    if (!VALID_RESOLUTIONS.has(resolution)) return json({ error: "Resolution must be one of 480p, 720p, or 1080p" }, { status: 400 });
    if (!VALID_DURATIONS.has(duration)) return json({ error: "Duration must be auto or a value from 4 through 15" }, { status: 400 });
    if (!VALID_ASPECT_RATIOS.has(aspectRatio)) return json({ error: "Aspect ratio is not supported by Seedance 2.0" }, { status: 400 });
    if (totalReferences > 12) return json({ error: "Seedance supports at most 12 total reference files" }, { status: 400 });
    if (audioUrls.length > 0 && imageUrls.length === 0 && videoUrls.length === 0) {
      return json({ error: "Reference audio requires at least one reference image or video" }, { status: 400 });
    }

    const referenceError =
      validateReferences("Reference images", imageUrls, 9, IMAGE_MIME_TYPES, MAX_IMAGE_BYTES) ||
      validateReferences("Reference videos", videoUrls, 3, VIDEO_MIME_TYPES, MAX_VIDEO_BYTES) ||
      validateReferences("Reference audio", audioUrls, 3, AUDIO_MIME_TYPES, MAX_AUDIO_BYTES);
    if (referenceError) return json({ error: referenceError }, { status: 400 });

    const input: Record<string, unknown> = {
      prompt: body.prompt.trim(),
      resolution,
      duration,
      aspect_ratio: aspectRatio,
      generate_audio: body.generate_audio !== false,
    };

    if (imageUrls.length > 0) input.image_urls = imageUrls;
    if (videoUrls.length > 0) input.video_urls = videoUrls;
    if (audioUrls.length > 0) input.audio_urls = audioUrls;

    if (Number.isInteger(body.seed) && body.seed >= 0) {
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
      return json({ error: `FAL submit failed: ${submitRes.status} ${errorText}` }, { status: submitRes.status });
    }

    const submitData = await submitRes.json();
    const requestId = submitData.request_id;
    if (!requestId) {
      throw new Error(`No request_id in FAL response: ${JSON.stringify(submitData)}`);
    }

    // Use the URLs returned by FAL directly — they include the correct path format
    const statusUrl =
      submitData.status_url ||
      `https://queue.fal.run/${FAL_MODEL}/requests/${requestId}/status`;
    const responseUrl =
      submitData.response_url ||
      `https://queue.fal.run/${FAL_MODEL}/requests/${requestId}/response`;

    console.log(`[Video] FAL request submitted: ${requestId}`);
    return json({
      requestId,
      statusUrl,
      responseUrl,
      outputDir: body.outputDir || "generations",
      prefix: body.prefix || "video",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Video] Error:", err);
    return json({ error: message }, { status: 500 });
  }
};
