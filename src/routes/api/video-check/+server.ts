import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { env } from "$env/dynamic/private";
import fs from "fs/promises";
import path from "path";

const MOUNT_PATH = "/mount";
const FAL_MODEL = "bytedance/seedance-2.0/reference-to-video";

export const POST: RequestHandler = async ({ request }) => {
  try {
    const {
      requestId,
      falKey: userFalKey,
      outputDir = "generations",
      prefix = "video",
      statusUrl: providedStatusUrl,
      responseUrl: providedResponseUrl,
    } = await request.json();

    const falKey = (userFalKey as string) || env.FAL_KEY || "";

    if (!falKey) return json({ error: "fal.ai API Key is required" }, { status: 400 });
    if (!requestId) return json({ error: "requestId is required" }, { status: 400 });

    // Use the URLs returned from the submit call; fall back to constructed URLs
    const statusUrl =
      providedStatusUrl ||
      `https://queue.fal.run/${FAL_MODEL}/requests/${requestId}/status`;
    const responseUrl =
      providedResponseUrl ||
      `https://queue.fal.run/${FAL_MODEL}/requests/${requestId}/response`;

    const statusRes = await fetch(`${statusUrl}?logs=1`, {
      headers: { Authorization: `Key ${falKey}` },
    });

    if (!statusRes.ok) {
      const errorText = await statusRes.text();
      throw new Error(`FAL status check failed: ${statusRes.status} ${errorText}`);
    }

    const statusData = await statusRes.json();
    const status: string = statusData.status;

    console.log(`[VideoCheck] ${requestId}: ${status}`);

    if (status === "IN_QUEUE" || status === "IN_PROGRESS") {
      return json({ status: "PROCESSING" });
    }

    if (status === "COMPLETED" && statusData.error) {
      return json({ status: "FAILED", error: statusData.error });
    }

    if (status === "COMPLETED") {
      const resultRes = await fetch(responseUrl, {
        headers: { Authorization: `Key ${falKey}` },
      });

      if (!resultRes.ok) {
        throw new Error(`FAL result fetch failed: ${resultRes.status}`);
      }

      const resultData = await resultRes.json();
      // Result may be wrapped in data or at the top level
      const videoUrl =
        resultData?.video?.url ??
        resultData?.data?.video?.url;
      if (!videoUrl) throw new Error("No video URL in FAL response");

      console.log(`[VideoCheck] Downloading video: ${videoUrl}`);

      const fullOutputDir = path.join(MOUNT_PATH, outputDir);
      await fs.mkdir(fullOutputDir, { recursive: true });

      const videoRes = await fetch(videoUrl);
      if (!videoRes.ok) throw new Error(`Failed to download video: ${videoRes.status}`);
      const arrayBuffer = await videoRes.arrayBuffer();
      const videoBuffer = Buffer.from(arrayBuffer);

      const filename = await getNextFilename(fullOutputDir, prefix, "mp4");
      await fs.writeFile(path.join(fullOutputDir, filename), videoBuffer);
      console.log(`[VideoCheck] Saved: ${filename}`);

      return json({ status: "SUCCESS", filename });
    }

    return json({ status: "PROCESSING" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[VideoCheck] Error:", err);
    return json({ status: "FAILED", error: message }, { status: 500 });
  }
};

async function getNextFilename(
  dir: string,
  prefix: string,
  extension: string,
): Promise<string> {
  const files = await fs.readdir(dir);
  const regex = new RegExp(
    `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_(\\d{3})\\.${extension}$`,
  );
  let maxNum = 0;
  for (const file of files) {
    const match = file.match(regex);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }
  return `${prefix}_${String(maxNum + 1).padStart(3, "0")}.${extension}`;
}
