import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { uploadAndGetPresignedUrl } from '$lib/s3';
import { env } from '$env/dynamic/private';
import { encodeImage } from '$lib/tt-encoder';

export const POST: RequestHandler = async ({ request }) => {
    try {
        const formData = await request.formData();
        const image = formData.get('image') as File;
        const rhubKey = formData.get('rhubKey') as string;
        const useTtDecoder = formData.get('useTtDecoder') === 'true';
        
        // S3 Config from Environment Variables
        const s3Endpoint = env.S3_ENDPOINT;
        const s3AccessKeyId = env.S3_ACCESS_KEY_ID;
        const s3SecretAccessKey = env.S3_SECRET_ACCESS_KEY;
        const s3Bucket = env.S3_BUCKET;
        const s3Region = env.S3_REGION || 'us-east-1';

        if (!image || !rhubKey) {
            return json({ error: 'Missing required parameters (Image or RunningHub Key)' }, { status: 400 });
        }

        if (!s3Endpoint || !s3AccessKeyId || !s3SecretAccessKey || !s3Bucket) {
            return json({ error: 'S3 configuration is missing in environment variables' }, { status: 500 });
        }

        let buffer = Buffer.from(await image.arrayBuffer());
        let finalFileName = `upscale_${Date.now()}_${image.name}`;

        if (useTtDecoder) {
            console.log(`[Upscale] useTtDecoder is ON. Encoding image...`);
            const extension = image.name.split('.').pop() || 'png';
            buffer = encodeImage(buffer, extension);
            // Change filename to .png since encoder always outputs PNG
            finalFileName = `upscale_${Date.now()}_encoded.png`;
        }

        console.log(`[Upscale] Uploading ${finalFileName} to S3...`);
        const imageUrl = await uploadAndGetPresignedUrl({
            endpoint: s3Endpoint,
            accessKeyId: s3AccessKeyId,
            secretAccessKey: s3SecretAccessKey,
            bucket: s3Bucket,
            region: s3Region
        }, buffer, finalFileName);

        console.log(`[Upscale] Presigned URL generated. Submitting to RunningHub...`);

        const workflowId = useTtDecoder ? '2022423075609907202' : '2022348592370950145';
        const nodeId = useTtDecoder ? '456' : '112';

        const rhubPayload = {
            nodeInfoList: [
                {
                    nodeId: nodeId,
                    fieldName: "value",
                    fieldValue: imageUrl,
                    description: "URL of Image to Upscale"
                }
            ],
            instanceType: "default",
            usePersonalQueue: "false"
        };

        const rhubResponse = await fetch(`https://www.runninghub.ai/openapi/v2/run/ai-app/${workflowId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rhubKey}` },
            body: JSON.stringify(rhubPayload)
        });

        const submitData = await rhubResponse.json();
        if (!submitData.taskId) throw new Error(`RunningHub submission failed: ${JSON.stringify(submitData)}`);

        return json({ taskId: submitData.taskId, imageUrl });

    } catch (err: any) {
        console.error('Upscale init error:', err);
        return json({ error: err.message }, { status: 500 });
    }
};
