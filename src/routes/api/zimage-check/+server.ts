import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import fs from 'fs/promises';
import path from 'path';

const MOUNT_PATH = '/mount';
const RUNPOD_ZIMAGE_ENDPOINT_DEFAULT = 'https://api.runpod.ai/v2/j7rrb3raom3lzh';
const RUNPOD_FLUX_KLEIN_ENDPOINT_DEFAULT = 'https://api.runpod.ai/v2/639jlguymlblim';

export const POST: RequestHandler = async ({ request }) => {
    const { jobId, runpodKey: userRunpodKey, outputDir, prefix, model } = await request.json();

    const runpodKey = userRunpodKey || env.RUNPOD_API_KEY || '';
    if (!runpodKey) {
        return json({ status: 'FAILED', error: 'RunPod API Key is required' });
    }

    let endpointUrl = '';
    if (model === 'flux-klein') {
        endpointUrl = env.RUNPOD_FLUX_KLEIN_ENDPOINT || RUNPOD_FLUX_KLEIN_ENDPOINT_DEFAULT;
    } else {
        endpointUrl = env.RUNPOD_ZIMAGE_ENDPOINT || RUNPOD_ZIMAGE_ENDPOINT_DEFAULT;
    }

    try {
        console.log(`[RunPod Check] Checking ${model || 'z-image'} job: ${jobId}`);
        const statusRes = await fetch(`${endpointUrl}/status/${jobId}`, {
            headers: { 'Authorization': `Bearer ${runpodKey}` }
        });

        const data = await statusRes.json();
        console.log(`[RunPod Check] Job ${jobId} status: ${data.status}`);

        if (data.status === 'COMPLETED') {
            // flux-klein returns image_urls (array), z-image returns image_url (string)
            const imageUrl = model === 'flux-klein' ? data.output?.image_urls?.[0] : data.output?.image_url;
            
            if (!imageUrl) throw new Error('No image URL in RunPod response');

            const fullOutputDir = path.join(MOUNT_PATH, outputDir);
            await fs.mkdir(fullOutputDir, { recursive: true });

            const imageRes = await fetch(imageUrl);
            if (!imageRes.ok) throw new Error(`Failed to download image: ${imageRes.status}`);
            const arrayBuffer = await imageRes.arrayBuffer();
            const imageBuffer = Buffer.from(arrayBuffer);

            // flux-klein results are usually jpeg from S3
            const ext = imageUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'jpg';
            const filename = await getNextFilename(fullOutputDir, prefix, ext);
            await fs.writeFile(path.join(fullOutputDir, filename), imageBuffer);
            console.log(`[RunPod Check] Saved: ${filename}`);

            return json({ status: 'SUCCESS', filename });

        } else if (['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(data.status)) {
            return json({ status: 'FAILED', error: data.error || `Job ${data.status.toLowerCase()}` });

        } else {
            // IN_QUEUE, IN_PROGRESS
            return json({ status: 'PROCESSING' });
        }

    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[RunPod Check] Error checking job ${jobId}:`, err);
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
