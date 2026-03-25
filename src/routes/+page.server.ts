import type { PageServerLoad } from "./$types";
import { env } from "$env/dynamic/private";
import lorasKlein from "$lib/loras-klein.json";
import lorasZimage from "$lib/loras-zimage.json";

export const load: PageServerLoad = async () => {
  return {
    envKeys: {
      rhubKey: env.RUNNINGHUB_API_KEY || "",
      geminiKey: env.GEMINI_API_KEY || "",
      runpodKey: env.RUNPOD_API_KEY || "",
    },
    lorasKlein: lorasKlein as { name: string; url: string; triggerWords?: string[] }[],
    lorasZimage: lorasZimage as { name: string; url: string; triggerWords?: string[] }[],
  };
};
