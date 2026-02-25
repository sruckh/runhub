import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'fs/promises';
import path from 'path';

const MOUNT_PATH = '/mount';
const MOUNT_ROOT = path.resolve(MOUNT_PATH);

function resolveSafePath(rawPath: string) {
    const filePath = path.resolve(MOUNT_ROOT, rawPath || '');
    if (filePath !== MOUNT_ROOT && !filePath.startsWith(`${MOUNT_ROOT}${path.sep}`)) {
        throw error(403, 'Forbidden');
    }
    return filePath;
}

export const GET: RequestHandler = async ({ params }) => {
    const filePath = resolveSafePath(params.path || '');

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

export const DELETE: RequestHandler = async ({ params }) => {
    const filePath = resolveSafePath(params.path || '');

    try {
        await fs.unlink(filePath);
        return new Response(null, { status: 204 });
    } catch (e: any) {
        if (e?.code === 'ENOENT') {
            throw error(404, 'File not found');
        }
        throw error(500, 'Failed to delete file');
    }
};
