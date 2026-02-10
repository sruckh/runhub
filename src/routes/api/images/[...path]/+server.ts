import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'fs/promises';
import path from 'path';

const MOUNT_PATH = '/mount';

export const GET: RequestHandler = async ({ params }) => {
    const filePath = path.join(MOUNT_PATH, params.path || '');
    
    // Security check: ensure the path is inside MOUNT_PATH
    if (!filePath.startsWith(MOUNT_PATH)) {
        throw error(403, 'Forbidden');
    }

    try {
        const fileContent = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        let contentType = 'application/octet-stream';
        
        if (ext === '.png') contentType = 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';

        return new Response(fileContent, {
            headers: {
                'Content-Type': contentType
            }
        });
    } catch (e) {
        throw error(404, 'File not found');
    }
};
