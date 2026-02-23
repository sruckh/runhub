import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import fs from 'fs/promises';
import path from 'path';
import { decodeImage } from '$lib/tt-decoder';

const MOUNT_PATH = '/mount';

export const POST: RequestHandler = async ({ request }) => {
    const { taskId, rhubKey: userRhubKey, outputDir, prefix, useTtDecoder = false } = await request.json();
    const rhubKey = userRhubKey || env.RUNNINGHUB_API_KEY || '';

    try {
        console.log(`Checking status for TaskID: ${taskId}`);
        const statusRes = await fetch('https://www.runninghub.ai/openapi/v2/query', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${rhubKey}`
            },
            body: JSON.stringify({ taskId })
        });

        const statusData = await statusRes.json();
        console.log(`Task ${taskId} status: ${statusData.status}`);

        if (statusData.status === 'SUCCESS') {
            const imageUrl = statusData.results[0].url;
            const fullOutputDir = path.join(MOUNT_PATH, outputDir);
            await fs.mkdir(fullOutputDir, { recursive: true });

            // Fetch image
            const imageRes = await fetch(imageUrl);
            const arrayBuffer = await imageRes.arrayBuffer();
            const imageBuffer = Buffer.from(arrayBuffer);

            let finalFilename: string;
            let finalData: Buffer;
            let decodeSuccess = false;
            let decodedExtension = '';

            if (useTtDecoder) {
                console.log('[TT-Decoder] Attempting decode...');
                const decoded = decodeImage(imageBuffer);

                if (decoded.data && decoded.extension) {
                    console.log(`[TT-Decoder] Decoded ${decoded.data.length} bytes as .${decoded.extension}`);
                    finalData = Buffer.from(decoded.data);
                    decodedExtension = decoded.extension;
                    decodeSuccess = true;
                    finalFilename = await getNextFilename(fullOutputDir, prefix, decoded.extension);
                } else {
                    console.log('[TT-Decoder] No hidden data found, saving original');
                    finalData = imageBuffer;
                    finalFilename = await getNextFilename(fullOutputDir, prefix, 'png');
                }
            } else {
                finalData = imageBuffer;
                finalFilename = await getNextFilename(fullOutputDir, prefix, 'png');
            }

            const filePath = path.join(fullOutputDir, finalFilename);
            await fs.writeFile(filePath, finalData);

            // Only include decode result info when decoder was enabled
            const resultInfo = useTtDecoder
                ? { decoded: decodeSuccess, extension: decodeSuccess ? decodedExtension : 'png' }
                : undefined;

            return json({ status: 'SUCCESS', filename: finalFilename, resultInfo });
        } else if (statusData.status === 'FAILED') {
            console.error(`Task ${taskId} failed:`, statusData);
            return json({ status: 'FAILED', error: statusData.errorMessage || 'Unknown error' });
        } else {
            return json({ status: 'PROCESSING' });
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error(`Error checking task ${taskId}:`, err);
        return json({ status: 'FAILED', error: message });
    }
};

async function getNextFilename(dir: string, prefix: string, extension: string = 'png'): Promise<string> {
    const files = await fs.readdir(dir);
    const regex = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d{3})\\.${extension.replace('.', '\\.')}$`);
    let maxNum = 0;
    for (const file of files) {
        const match = file.match(regex);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
        }
    }
    const numStr = String(maxNum + 1).padStart(3, '0');
    return `${prefix}_${numStr}.${extension}`;
}
