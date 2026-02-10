import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

const MOUNT_PATH = '/mount';

export const POST: RequestHandler = async ({ request }) => {
    const { taskId, rhubKey, outputDir, prefix } = await request.json();

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

            const nextFilename = await getNextFilename(fullOutputDir, prefix);
            const imageRes = await fetch(imageUrl);
            const fileStream = createWriteStream(path.join(fullOutputDir, nextFilename));
            await pipeline(imageRes.body as any, fileStream);

            return json({ status: 'SUCCESS', filename: nextFilename });
        } else if (statusData.status === 'FAILED') {
            console.error(`Task ${taskId} failed:`, statusData);
            return json({ status: 'FAILED', error: statusData.errorMessage || 'Unknown error' });
        } else {
            return json({ status: 'PROCESSING' });
        }
    } catch (err) {
        console.error(`Error checking task ${taskId}:`, err);
        return json({ status: 'FAILED', error: err.message });
    }
};

async function getNextFilename(dir: string, prefix: string) {
    const files = await fs.readdir(dir);
    const regex = new RegExp(`^${prefix}_(\\d{3})\\.png$`);
    let maxNum = 0;
    for (const file of files) {
        const match = file.match(regex);
        if (match) {
            const num = parseInt(match[1]);
            if (num > maxNum) maxNum = num;
        }
    }
    return `${prefix}_${(maxNum + 1).toString().padStart(3, '0')}.png`;
}