import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { readdirSync } from "fs";
import { join } from "path";
import triggerConfig from "$lib/character-lora-triggers.json";

const LORA_BASE_PATH = "/data/loras/Character";
const LORA_BASE_URL = "https://filez.gemneye.xyz/LoRA/Character";

// Map UI model IDs to filesystem subdirectory names
const MODEL_TO_SUBDIR: Record<string, string> = {
  "flux-klein": "flux.2-klein-9b",
  "rhub-klein": "flux.2-klein-9b",
  "z-image": "zImage",
  "rhub-zimage": "zImage",
  "rhub-krea2-kim": "Krea2",
  "fal-ideogram4": "IdeoGram4",
  "rhub-ideogram4": "IdeoGram4",
};

// Config is keyed by subdir -> LoRA name -> trigger words.
type TriggerConfig = Record<string, Record<string, string[]>>;
const TRIGGERS = triggerConfig as unknown as TriggerConfig;

interface CharacterLora {
  name: string;
  url: string;
  triggerWords: string[];
}

function listLoras(subdir: string): CharacterLora[] {
  const dir = join(LORA_BASE_PATH, subdir);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".safetensors"));
  } catch {
    return [];
  }

  return files.map((filename) => {
    const name = filename.replace(/\.safetensors$/, "");
    // Trigger words are ONLY returned when explicitly configured. Unknown
    // LoRAs get an empty array so the UI shows an empty trigger field.
    const triggerWords = TRIGGERS[subdir]?.[name] ?? [];
    return {
      name,
      url: `${LORA_BASE_URL}/${subdir}/${filename}`,
      triggerWords,
    };
  });
}

export const GET: RequestHandler = async ({ url }) => {
  const model = url.searchParams.get("model") || "";

  // If a specific model is requested, return only its LoRAs
  if (model) {
    const subdir = MODEL_TO_SUBDIR[model];
    if (!subdir) {
      return json({ loras: [] });
    }
    return json({ loras: listLoras(subdir) });
  }

  // No model filter — return all LoRAs grouped by subdir
  const allLoras: CharacterLora[] = [];
  for (const subdir of Object.values(MODEL_TO_SUBDIR)) {
    allLoras.push(...listLoras(subdir));
  }

  // Deduplicate by URL (same LoRA may appear under a shared subdir)
  const seen = new Set<string>();
  const unique = allLoras.filter((l) => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });

  return json({ loras: unique });
};
