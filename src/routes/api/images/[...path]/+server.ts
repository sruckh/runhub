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

        // Image types
        if (ext === '.png') contentType = 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
        if (ext === '.webp') contentType = 'image/webp';
        if (ext === '.gif') contentType = 'image/gif';
        if (ext === '.svg') contentType = 'image/svg+xml';

        // Video types (common decoded outputs)
        if (ext === '.mp4') contentType = 'video/mp4';
        if (ext === '.webm') contentType = 'video/webm';
        if (ext === '.mov') contentType = 'video/quicktime';

        // Other common types
        if (ext === '.pdf') contentType = 'application/pdf';
        if (ext === '.txt') contentType = 'text/plain';
        if (ext === '.json') contentType = 'application/json';
        if (ext === '.zip') contentType = 'application/zip';

        const headers: Record<string, string> = {
            'Content-Type': contentType,
            'Cache-Control': 'no-store'
        };

        // Non-displayable types get a download disposition
        if (!contentType.startsWith('image/') && !contentType.startsWith('text/')) {
            const filename = path.basename(filePath);
            headers['Content-Disposition'] = `attachment; filename="${filename}"`;
        }

        return new Response(fileContent, { headers });
    } catch (e) {
        throw error(404, 'File not found');
    }
};
