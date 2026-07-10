import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { uploadAndGetPresignedUrl } from "$lib/s3";
import { env } from "$env/dynamic/private";
import { encodeImage } from "$lib/tt-encoder";
import fs from "fs/promises";
import path from "path";

const MOUNT_PATH = "/mount";

export const POST: RequestHandler = async ({ request }) => {
  try {
    const formData = await request.formData();
    const image = formData.get("image") as File;
    const userRhubKey = formData.get("rhubKey") as string;
    const rhubKey = userRhubKey || env.RUNNINGHUB_API_KEY || "";
    const useTtDecoder = formData.get("useTtDecoder") === "true";
    const upscaleEngine = (formData.get("upscaleEngine") as string) || "runninghub-2k";
    const isFalCrystal = upscaleEngine === "fal-crystal";

    // S3 Config from Environment Variables
    const s3Endpoint = env.S3_ENDPOINT;
    const s3AccessKeyId = env.S3_ACCESS_KEY_ID;
    const s3SecretAccessKey = env.S3_SECRET_ACCESS_KEY;
    const s3Bucket = env.S3_BUCKET;
    const s3Region = env.S3_REGION || "us-east-1";

    if (!image || (!isFalCrystal && !rhubKey)) {
      return json(
        { error: "Missing required parameters (Image or RunningHub Key)" },
        { status: 400 },
      );
    }

    if (!s3Endpoint || !s3AccessKeyId || !s3SecretAccessKey || !s3Bucket) {
      return json(
        { error: "S3 configuration is missing in environment variables" },
        { status: 500 },
      );
    }

    let buffer: Buffer = Buffer.from(await image.arrayBuffer());
    let finalFileName = `upscale_${Date.now()}_${image.name}`;

    if (useTtDecoder && !isFalCrystal) {
      console.log(`[Upscale] useTtDecoder is ON. Encoding image...`);
      const extension = image.name.split(".").pop() || "png";
      buffer = encodeImage(buffer, extension);
      // Change filename to .png since encoder always outputs PNG
      finalFileName = `upscale_${Date.now()}_encoded.png`;
    }

    console.log(`[Upscale] Uploading ${finalFileName} to S3...`);
    const imageUrl = await uploadAndGetPresignedUrl(
      {
        endpoint: s3Endpoint,
        accessKeyId: s3AccessKeyId,
        secretAccessKey: s3SecretAccessKey,
        bucket: s3Bucket,
        region: s3Region,
      },
      buffer,
      finalFileName,
    );

    if (isFalCrystal) {
      const userFalKey = formData.get("falKey") as string;
      const falKey = userFalKey || env.FAL_KEY || "";
      const outputDir = (formData.get("outputDir") as string) || "generations";
      const prefix = (formData.get("prefix") as string) || "image";

      if (!falKey) {
        return json({ error: "fal.ai API Key is required" }, { status: 400 });
      }

      console.log(`[Upscale] Calling fal.ai clarityai/crystal-upscaler...`);
      const falResponse = await fetch("https://fal.run/clarityai/crystal-upscaler", {
        method: "POST",
        headers: {
          Authorization: `Key ${falKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ image_url: imageUrl, output_format: "png" }),
      });

      if (!falResponse.ok) {
        const errorText = await falResponse.text();
        console.error(`[Upscale] fal.ai error: ${falResponse.status} ${errorText}`);
        throw new Error(`fal.ai API error: ${falResponse.status}`);
      }

      const falData = await falResponse.json();
      const resultImageUrl = falData?.images?.[0]?.url;
      if (!resultImageUrl) throw new Error("No image URL in fal.ai response");

      console.log(`[Upscale] Got result URL: ${resultImageUrl}`);

      const fullOutputDir = path.join(MOUNT_PATH, outputDir);
      await fs.mkdir(fullOutputDir, { recursive: true });

      const imageRes = await fetch(resultImageUrl);
      if (!imageRes.ok)
        throw new Error(`Failed to download upscaled image: ${imageRes.status}`);
      const arrayBuffer = await imageRes.arrayBuffer();
      const imageBuffer = Buffer.from(arrayBuffer);

      const filename = await getNextFilename(fullOutputDir, prefix, "png");
      await fs.writeFile(path.join(fullOutputDir, filename), imageBuffer);
      console.log(`[Upscale] Saved: ${filename}`);

      return json({ filename });
    }

    console.log(`[Upscale] Presigned URL generated. Submitting to RunningHub...`);

    const workflow =
      upscaleEngine === "runninghub-api"
        ? {
            appId: "2053348161841836033",
            nodeId: "125",
            description: "URL of Image",
            label: "RunningHub API Upscale",
          }
        : {
            appId: useTtDecoder ? "2022423075609907202" : "2022348592370950145",
            nodeId: useTtDecoder ? "456" : "112",
            description: "URL of Image to Upscale",
            label: "RunningHub 2K Upscale",
          };

    console.log(`[Upscale] Using ${workflow.label} workflow ${workflow.appId}`);

    const rhubPayload = {
      nodeInfoList: [
        {
          nodeId: workflow.nodeId,
          fieldName: "value",
          fieldValue: imageUrl,
          description: workflow.description,
        },
      ],
      instanceType: "default",
      usePersonalQueue: "false",
    };

    const rhubResponse = await fetch(
      `https://www.runninghub.ai/openapi/v2/run/ai-app/${workflow.appId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${rhubKey}` },
        body: JSON.stringify(rhubPayload),
      },
    );

    const submitData = await rhubResponse.json();
    if (!submitData.taskId)
      throw new Error(`RunningHub submission failed: ${JSON.stringify(submitData)}`);

    return json({ taskId: submitData.taskId, imageUrl });
  } catch (err: any) {
    console.error("Upscale init error:", err);
    return json({ error: err.message }, { status: 500 });
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
