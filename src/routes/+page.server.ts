import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';

export const load: PageServerLoad = async () => {
    return {
        envKeys: {
            rhubKey: env.RUNNINGHUB_API_KEY || '',
            geminiKey: env.GEMINI_API_KEY || '',
            runpodKey: env.RUNPOD_API_KEY || '',
        }
    };
};
