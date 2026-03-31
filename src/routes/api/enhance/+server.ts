import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { env } from "$env/dynamic/private";
import fs from "fs/promises";
import path from "path";

const MOUNT_PATH = "/mount";

const RUNNINGHUB_WORKFLOWS: Record<string, { appId: string; nodeId: string; label: string }> = {
  "runninghub":        { appId: "2038750666184724482", nodeId: "85", label: "Enhance" },
  "runninghub-detail": { appId: "2038840598580436994", nodeId: "47", label: "Enhance+Detail" },
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const formData = await request.formData();
    const engine = (formData.get("engine") as string) || "fal";
    const outputDir = (formData.get("outputDir") as string) || "generations";
    const prefix = (formData.get("prefix") as string) || "image";
    const imageUrlInput = formData.get("imageUrl") as string;
    const imageFile = formData.get("image") as File | null;

    // ── RunningHub engines ───────────────────────────────────────────────────
    const rhubWorkflow = RUNNINGHUB_WORKFLOWS[engine];
    if (rhubWorkflow) {
      const userRhubKey = formData.get("rhubKey") as string;
      const rhubKey = userRhubKey || env.RUNNINGHUB_API_KEY || "";

      if (!imageUrlInput) {
        return json(
          { error: "An image URL is required for the RunningHub engine" },
          { status: 400 },
        );
      }

      console.log(`[Enhance/${rhubWorkflow.label}] Submitting URL: ${imageUrlInput}`);
      const rhubRes = await fetch(
        `https://www.runninghub.ai/openapi/v2/run/ai-app/${rhubWorkflow.appId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${rhubKey}`,
          },
          body: JSON.stringify({
            nodeInfoList: [
              {
                nodeId: rhubWorkflow.nodeId,
                fieldName: "value",
                fieldValue: imageUrlInput,
                description: "URL of Input Image",
              },
            ],
            instanceType: "default",
            usePersonalQueue: "false",
          }),
        },
      );

      const rhubData = await rhubRes.json();
      const taskId = rhubData?.taskId;
      if (!taskId) {
        throw new Error(
          `RunningHub submission failed: ${JSON.stringify(rhubData)}`,
        );
      }

      console.log(`[Enhance/${rhubWorkflow.label}] Task submitted: ${taskId}`);
      return json({ taskId, outputDir, prefix });
    }

    // ── fal.ai engine (default) ──────────────────────────────────────────────
    const outputFormat = (formData.get("outputFormat") as string) || "jpeg";
    const userFalKey = formData.get("falKey") as string;
    const falKey = userFalKey || env.FAL_KEY || "";

    if (!falKey) {
      return json({ error: "fal.ai API Key is required" }, { status: 400 });
    }

    if (!imageUrlInput && !imageFile) {
      return json(
        { error: "Either an image URL or an image file is required" },
        { status: 400 },
      );
    }

    let imageUrl: string;

    if (imageFile && imageFile.size > 0) {
      const buffer = Buffer.from(await imageFile.arrayBuffer());
      const base64 = buffer.toString("base64");
      const mimeType = imageFile.type || "image/jpeg";
      imageUrl = `data:${mimeType};base64,${base64}`;
      console.log(`[Enhance] Using uploaded file: ${imageFile.name}`);
    } else {
      imageUrl = imageUrlInput;
      console.log(`[Enhance] Using URL: ${imageUrl}`);
    }

    console.log(`[Enhance] Calling fal.ai phota/enhance...`);
    const falResponse = await fetch("https://fal.run/fal-ai/phota/enhance", {
      method: "POST",
      headers: {
        Authorization: `Key ${falKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_url: imageUrl,
        output_format: outputFormat,
      }),
    });

    if (!falResponse.ok) {
      const errorText = await falResponse.text();
      console.error(`[Enhance] fal.ai error: ${falResponse.status} ${errorText}`);
      throw new Error(`fal.ai API error: ${falResponse.status}`);
    }

    const falData = await falResponse.json();
    const resultImageUrl = falData?.images?.[0]?.url;
    if (!resultImageUrl) throw new Error("No image URL in fal.ai response");

    console.log(`[Enhance] Got result URL: ${resultImageUrl}`);

    const fullOutputDir = path.join(MOUNT_PATH, outputDir);
    await fs.mkdir(fullOutputDir, { recursive: true });

    const imageRes = await fetch(resultImageUrl);
    if (!imageRes.ok)
      throw new Error(`Failed to download enhanced image: ${imageRes.status}`);
    const arrayBuffer = await imageRes.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    const ext = outputFormat === "jpeg" ? "jpg" : outputFormat;
    const filename = await getNextFilename(fullOutputDir, prefix, ext);
    await fs.writeFile(path.join(fullOutputDir, filename), imageBuffer);
    console.log(`[Enhance] Saved: ${filename}`);

    return json({ filename });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[Enhance] Error:`, err);
    return json({ error: message }, { status: 500 });
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
