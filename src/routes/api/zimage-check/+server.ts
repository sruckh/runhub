import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import fs from 'fs/promises';
import path from 'path';

const MOUNT_PATH = '/mount';
const RUNPOD_ZIMAGE_ENDPOINT_DEFAULT = 'https://api.runpod.ai/v2/j7rrb3raom3lzh';

export const POST: RequestHandler = async ({ request }) => {
    const { jobId, runpodKey: userRunpodKey, outputDir, prefix } = await request.json();

    const runpodKey = userRunpodKey || env.RUNPOD_API_KEY || '';
    if (!runpodKey) {
        return json({ status: 'FAILED', error: 'RunPod API Key is required' });
    }

    const endpointUrl = env.RUNPOD_ZIMAGE_ENDPOINT || RUNPOD_ZIMAGE_ENDPOINT_DEFAULT;

    try {
        console.log(`[Z-Image] Checking job: ${jobId}`);
        const statusRes = await fetch(`${endpointUrl}/status/${jobId}`, {
            headers: { 'Authorization': `Bearer ${runpodKey}` }
        });

        const data = await statusRes.json();
        console.log(`[Z-Image] Job ${jobId} status: ${data.status}`);

        if (data.status === 'COMPLETED') {
            const imageUrl = data.output?.image_url;
            if (!imageUrl) throw new Error('No image_url in RunPod response');

            const fullOutputDir = path.join(MOUNT_PATH, outputDir);
            await fs.mkdir(fullOutputDir, { recursive: true });

            const imageRes = await fetch(imageUrl);
            if (!imageRes.ok) throw new Error(`Failed to download image: ${imageRes.status}`);
            const arrayBuffer = await imageRes.arrayBuffer();
            const imageBuffer = Buffer.from(arrayBuffer);

            const filename = await getNextFilename(fullOutputDir, prefix, 'jpg');
            await fs.writeFile(path.join(fullOutputDir, filename), imageBuffer);
            console.log(`[Z-Image] Saved: ${filename}`);

            return json({ status: 'SUCCESS', filename });

        } else if (['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(data.status)) {
            return json({ status: 'FAILED', error: data.error || `Job ${data.status.toLowerCase()}` });

        } else {
            // IN_QUEUE, IN_PROGRESS
            return json({ status: 'PROCESSING' });
        }

    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[Z-Image] Error checking job ${jobId}:`, err);
        return json({ status: 'FAILED', error: message });
    }
};

async function getNextFilename(dir: string, prefix: string, extension: string): Promise<string> {
    const files = await fs.readdir(dir);
    const regex = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d{3})\\.${extension}$`);
    let maxNum = 0;
    for (const file of files) {
        const match = file.match(regex);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
        }
    }
    return `${prefix}_${String(maxNum + 1).padStart(3, '0')}.${extension}`;
}
