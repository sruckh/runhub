<script lang="ts">
    import { onMount, untrack } from 'svelte';
    import rhubHero from '../../imgs/RHUB.svg';

    let { data } = $props();

    // untrack: read env-backed defaults once at init without reactive tracking
    const { geminiKey: _gk = '', rhubKey: _rk = '', runpodKey: _rpk = '' } = untrack(() => data.envKeys ?? {});
    const lorasKlein: { name: string; url: string; triggerWords?: string[] }[] = untrack(() => data.lorasKlein ?? []);
    const lorasZimage: { name: string; url: string; triggerWords?: string[] }[] = untrack(() => data.lorasZimage ?? []);

    let loraUrl = $state('');
    let loraKeyword = $state('');
    let subject = $state('');
    let customPrompt = $state('');
    let useCustomPrompt = $state(false);
    let numPrompts = $state(1);
    let outputDir = $state('generations');
    let prefix = $state('image');
    let aspectRatio = $state('1:1');
    let kleinAspectRatio = $state('1:1');
    let geminiKey = $state(_gk);
    let rhubKey = $state(_rk);
    let runpodKey = $state(_rpk);
    let promptProvider = $state('gemini');
    let model = $state('flux-dev'); // 'flux-dev' | 'flux-klein' | 'z-image'

    // Z-Image / FLUX.2-klein extra params
    let zimageSteps = $state(50);
    let guidanceScale = $state(3.5);
    let zimageSeed = $state(-1);
    let loraScale = $state(0.85);
    let shift = $state(3.0);
    let preset = $state('realistic_character');

    // Z-Image new params
    let zimageNegativePrompt = $state('');
    let zimageMaxSequenceLength = $state(512);
    let zimageUseBetaSigmas = $state(true);
    let zimageCfgNormalization = $state(true);
    let zimageCfgTruncation = $state(1.0);
    let zimageVaeTiling = $state<boolean | null>(null); // null = auto

    // Z-Image second pass params
    let secondPassEnabled = $state(false);
    let secondPassUpscale = $state(1.25);
    let secondPassStrength = $state(0.22);
    let secondPassGuidanceScale = $state(1.5);
    let secondPassSteps = $state(10);
    let secondPassMaxSequenceLength = $state(384);
    let secondPassCfgNormalization = $state(true);
    let secondPassCfgTruncation = $state(1.0);
    let secondPassUseBetaSigmas = $state<boolean | null>(null); // null = inherit
    let secondPassVaeTiling = $state(false);
    let secondPassVaeSlicing = $state(true);

    // FLUX.2-klein 2nd pass / upscale params
    let kleinEnable2ndPass = $state(false);
    let kleinSecondPassStrength = $state(0.2);
    let kleinSecondPassSteps = $state(4);
    let kleinEnableUpscale = $state(false);
    let kleinUpscaleFactor = $state(2.0);
    let kleinUpscaleBlend = $state(0.35);
    let kleinMaxSequenceLength = $state(512);
    let kleinShift = $state(1.5);

    // FLUX.2-klein multi-LoRA stack
    interface KleinLora { url: string; keyword: string; scale: number; preset: string; }

    function _defaultLora(_list: { name: string; url: string }[]): KleinLora {
        return { url: '', keyword: '', scale: 0.85, preset: '' };
    }

    let kleinLoras = $state<KleinLora[]>([_defaultLora(lorasKlein)]);

    function addKleinLora() {
        const list = model === 'z-image' ? lorasZimage : lorasKlein;
        kleinLoras = [...kleinLoras, _defaultLora(list)];
    }
    function removeKleinLora(i: number) {
        if (kleinLoras.length > 1) kleinLoras = kleinLoras.filter((_, idx) => idx !== i);
    }

    // Reset LoRA stack when switching between models with different LoRA lists
    let _prevLoraModel = model;
    $effect(() => {
        const m = model;
        if ((m === 'flux-klein' || m === 'z-image') && m !== _prevLoraModel) {
            kleinLoras = [{ url: '', keyword: '', scale: 0.85, preset: '' }];
        }
        _prevLoraModel = m;
    });

    // Sync kleinShift with preset default when preset changes
    let _prevPreset = preset;
    $effect(() => {
        const p = preset;
        if (p !== _prevPreset) {
            kleinShift = getKleinPresetDefaults(p).shift;
            _prevPreset = p;
        }
    });

    // RunningHub ZImage Upscale + Face Detailer params
    let rhubZimageStyle = $state('None');
    let rhubZimagePresetId = $state('ig_portrait');
    let rhubZimageOrientation = $state('portrait');
    let rhubZimageWidth = $state(816);
    let rhubZimageHeight = $state(1024);

    // RunningHub FLUX.2-klein params
    let rhubKleinLora2Url = $state('');
    let rhubKleinLora2Keyword = $state('');
    let rhubKleinLora2Strength = $state(0.85);
    let rhubKleinAspectRatio = $state('1:1');
    let rhubKleinOrientation = $state('portrait');

    // RHUB-Klein aspect ratios (closest to 1K, divisible by 32)
    const rhubKleinAspectRatios = [
        { ratio: '1:1', width: 1024, height: 1024 },
        { ratio: '2:3', width: 672, height: 1024 },
        { ratio: '3:4', width: 768, height: 1024 },
        { ratio: '4:5', width: 832, height: 1024 },
        { ratio: '9:16', width: 576, height: 1024 },
        { ratio: '21:9', width: 448, height: 1024 },
    ];

    // Load persisted settings
    const savedTtDecoder = typeof localStorage !== 'undefined' && localStorage.getItem('useTtDecoder') === 'true';
    let useTtDecoder = $state(savedTtDecoder);
    
    let activeTab = $state('generate'); // 'generate' or 'upscale'
    let loading = $state(false);
    let queue = $state<any[]>([]);
    let isProcessingQueue = $state(false);

    // Upscale states
    let upscaleFiles = $state<File[]>([]);
    let fileInput = $state<HTMLInputElement | null>(null);
    const upscaleFilesMap = new Map<string, File>();

    // Persist setting changes and queue
    $effect(() => {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('useTtDecoder', String(useTtDecoder));
            localStorage.setItem('rhub_queue', JSON.stringify(queue));
        }
    });

    let results = $state<any[]>([]);
    let error = $state('');
    
    // New states
    let isCancelled = $state(false);
    let selectedImage = $state<string | null>(null);
    let toastMessage = $state('');

    // Show toast notification
    function showToast(msg: string) {
        toastMessage = msg;
        setTimeout(() => toastMessage = '', 3000);
    }

    onMount(() => {
        console.log('AI Image Magick interface mounted');
        const savedQueue = localStorage.getItem('rhub_queue');
        if (savedQueue) {
            try {
                queue = JSON.parse(savedQueue);
                // Auto-start processing if queue is not empty
                if (queue.length > 0) processQueue();
            } catch (e) {
                console.error('Failed to parse queue', e);
            }
        }
    });

    const aspectRatios = ['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4'];
    const kleinAspectRatios = [
        { ratio: '21:9', width: 1024, height: 448,  group: 'Landscape' },
        { ratio: '2:1',  width: 1024, height: 512,  group: 'Landscape' },
        { ratio: '16:9', width: 1024, height: 576,  group: 'Landscape' },
        { ratio: '3:2',  width: 1024, height: 672,  group: 'Landscape' },
        { ratio: '4:3',  width: 1024, height: 768,  group: 'Landscape' },
        { ratio: '5:4',  width: 1024, height: 832,  group: 'Landscape' },
        { ratio: '1:1',  width: 1024, height: 1024, group: 'Square'    },
        { ratio: '4:5',  width: 832,  height: 1024, group: 'Portrait'  },
        { ratio: '3:4',  width: 768,  height: 1024, group: 'Portrait'  },
        { ratio: '2:3',  width: 672,  height: 1024, group: 'Portrait'  },
        { ratio: '9:16', width: 576,  height: 1024, group: 'Portrait'  },
        { ratio: '1:2',  width: 512,  height: 1024, group: 'Portrait'  },
    ];
    const kleinPresets = [
        { id: 'realistic_character', label: 'Realistic Character' },
        { id: 'portrait_hd', label: 'Portrait HD' },
        { id: 'cinematic_full', label: 'Cinematic Full' },
        { id: 'fast_preview', label: 'Fast Preview' },
        { id: 'maximum_quality', label: 'Maximum Quality' },
        // Character LoRA optimized presets
        { id: 'character_portrait_best', label: 'Character Portrait (Best)' },
        { id: 'character_portrait_vertical', label: 'Character Portrait (Vertical)' },
        { id: 'character_cinematic', label: 'Character Cinematic' },
        { id: 'manga_style', label: 'Manga / Illustration Style' }
    ];
    const kleinPresetDefaults: Record<string, { steps: number; shift: number; width: number; height: number }> = {
        realistic_character: { steps: 8,  shift: 1.5, width: 1024, height: 1024 },
        portrait_hd:         { steps: 8,  shift: 1.5, width: 1024, height: 1536 },
        cinematic_full:      { steps: 8,  shift: 1.5, width: 1536, height: 1024 },
        fast_preview:        { steps: 4,  shift: 1.5, width: 1024, height: 1024 },
        maximum_quality:     { steps: 16, shift: 1.0, width: 1024, height: 1024 },
        character_portrait_best:     { steps: 12, shift: 2.5, width: 1024, height: 1024 },
        character_portrait_vertical: { steps: 12, shift: 2.0, width: 896,  height: 1152 },
        character_cinematic:         { steps: 8,  shift: 2.5, width: 1344, height: 896  },
        manga_style:                 { steps: 8,  shift: 1.5, width: 1024, height: 1024 }
    };
    function getKleinPresetDefaults(presetId: string) {
        return kleinPresetDefaults[presetId] || kleinPresetDefaults.realistic_character;
    }

    const rhubZimageStyles = [
        'None', 'Phone Photo', 'Casual Photo', 'Vintage Photo', 'Portra Film Photo',
        '70s Memories Photo', 'Flash 90s Photo', 'Production Photo', 'Classic Film Photo',
        'Noir Photo', '80s Dark Fantasy Photo', 'Lomography', 'Spotlight Stage Photo',
        'Unconventional Viewpoint', 'Dramatic Viewpoint', 'Wide Angle / Peephole',
        'Drone Photo', 'Minimalist Photo', 'High-Key Fashion Photo', 'Light and Airy Photo',
        'Teal and Orange Photo', 'Orthochromatic Spirit Photo', 'Synthwave Photo',
        'Quiet Luxury Photo', 'Dark-Side Photo', 'Dramatic Light & Shadow',
        'Pastel Dream Aesthetic', 'Street Documentary Photo', 'Tilt Shift / Toy Photo',
        'Pop Photo'
    ];

    const rhubZimageResPresets = [
        // Social Media
        { id: 'ig_square',   label: 'Instagram Square',         w: 1024, h: 1024, group: 'Social Media' },
        { id: 'ig_portrait', label: 'Instagram Portrait',       w: 816,  h: 1024, group: 'Social Media' },
        { id: 'ig_land',     label: 'Instagram Landscape',      w: 1024, h: 536,  group: 'Social Media' },
        { id: 'stories',     label: 'Stories / Reels / TikTok', w: 576,  h: 1024, group: 'Social Media' },
        { id: 'twitter',     label: 'Twitter/X Post',           w: 1024, h: 576,  group: 'Social Media' },
        { id: 'pinterest',   label: 'Pinterest Pin',            w: 680,  h: 1024, group: 'Social Media' },
        { id: 'youtube',     label: 'YouTube Thumbnail',        w: 1024, h: 576,  group: 'Social Media' },
        { id: 'fb_cover',    label: 'Facebook Cover',           w: 1024, h: 392,  group: 'Social Media' },
        { id: 'linkedin',    label: 'LinkedIn Post',            w: 1024, h: 536,  group: 'Social Media' },
        { id: 'cinematic',   label: 'Widescreen / Cinematic',   w: 1024, h: 440,  group: 'Social Media' },
        // Print
        { id: 'photo_4x6',   label: '4×6 Photo',               w: 680,  h: 1024, group: 'Print' },
        { id: 'photo_5x7',   label: '5×7 Photo',               w: 728,  h: 1024, group: 'Print' },
        { id: 'photo_8x10',  label: '8×10 Photo',              w: 816,  h: 1024, group: 'Print' },
        { id: 'us_letter',   label: 'US Letter (8.5×11)',       w: 792,  h: 1024, group: 'Print' },
        { id: 'a4',          label: 'A4',                       w: 720,  h: 1024, group: 'Print' },
        { id: 'sq_print',    label: 'Square (album / poster)',  w: 1024, h: 1024, group: 'Print' },
        { id: 'panoramic',   label: 'Panoramic / Banner',       w: 1024, h: 512,  group: 'Print' },
        { id: 'portrait_34', label: 'Portrait 3:4',             w: 768,  h: 1024, group: 'Print' },
    ];

    const rhubZimagePresetsSocial = rhubZimageResPresets.filter(p => p.group === 'Social Media');
    const rhubZimagePresetsPrint  = rhubZimageResPresets.filter(p => p.group === 'Print');

    $effect(() => {
        const preset = rhubZimageResPresets.find(p => p.id === rhubZimagePresetId) ?? rhubZimageResPresets[0];
        if (preset.w === preset.h) {
            rhubZimageWidth  = preset.w;
            rhubZimageHeight = preset.h;
        } else if (rhubZimageOrientation === 'landscape') {
            rhubZimageWidth  = Math.max(preset.w, preset.h);
            rhubZimageHeight = Math.min(preset.w, preset.h);
        } else {
            rhubZimageWidth  = Math.min(preset.w, preset.h);
            rhubZimageHeight = Math.max(preset.w, preset.h);
        }
    });

    async function handleSubmit() {
        if (activeTab === 'generate') {
            addToQueue();
        } else {
            addUpscaleToQueue();
        }
    }

    async function addToQueue() {
        const baseTask = {
            type: 'generate',
            model,
            loraUrl,
            loraKeyword: (model === 'flux-klein' || model === 'z-image')
                ? kleinLoras.map(l => l.keyword).map(k => k.trim()).filter(Boolean).join(', ')
                : loraKeyword,
            kleinLoras: (model === 'flux-klein' || model === 'z-image') ? kleinLoras : undefined,
            subject,
            customPrompt,
            useCustomPrompt,
            aspectRatio,
            geminiKey,
            rhubKey,
            runpodKey,
            promptProvider,
            useTtDecoder,
            outputDir,
            prefix,
            steps: zimageSteps,
            guidanceScale,
            seed: zimageSeed,
            loraScale,
            shift,
            preset,
            zimage_negative_prompt: zimageNegativePrompt,
            zimage_max_sequence_length: zimageMaxSequenceLength,
            zimage_use_beta_sigmas: zimageUseBetaSigmas,
            zimage_cfg_normalization: zimageCfgNormalization,
            zimage_cfg_truncation: zimageCfgTruncation,
            zimage_vae_tiling: zimageVaeTiling,
            second_pass_enabled: secondPassEnabled,
            second_pass_upscale: secondPassUpscale,
            second_pass_strength: secondPassStrength,
            second_pass_guidance_scale: secondPassGuidanceScale,
            second_pass_steps: secondPassSteps,
            second_pass_max_sequence_length: secondPassMaxSequenceLength,
            second_pass_cfg_normalization: secondPassCfgNormalization,
            second_pass_cfg_truncation: secondPassCfgTruncation,
            second_pass_use_beta_sigmas: secondPassUseBetaSigmas,
            second_pass_vae_tiling: secondPassVaeTiling,
            second_pass_vae_slicing: secondPassVaeSlicing,
            klein_enable_2nd_pass: kleinEnable2ndPass,
            klein_second_pass_strength: kleinSecondPassStrength,
            klein_second_pass_steps: kleinSecondPassSteps,
            klein_enable_upscale: kleinEnableUpscale,
            klein_upscale_factor: kleinUpscaleFactor,
            klein_upscale_blend: kleinUpscaleBlend,
            klein_max_sequence_length: kleinMaxSequenceLength,
            klein_shift: kleinShift,
            kleinAspectRatio,
            klein_width: (kleinAspectRatios.find(ar => ar.ratio === kleinAspectRatio) ?? { width: 1024, height: 1024 }).width,
            klein_height: (kleinAspectRatios.find(ar => ar.ratio === kleinAspectRatio) ?? { width: 1024, height: 1024 }).height,
            rhub_zimage_style: rhubZimageStyle,
            rhub_zimage_width: rhubZimageWidth,
            rhub_zimage_height: rhubZimageHeight,
            rhub_klein_lora1_url: loraUrl,
            rhub_klein_lora1_keyword: loraKeyword,
            rhub_klein_lora1_strength: loraScale,
            rhub_klein_lora2_url: rhubKleinLora2Url,
            rhub_klein_lora2_keyword: rhubKleinLora2Keyword,
            rhub_klein_lora2_strength: rhubKleinLora2Strength,
            rhub_klein_aspect_ratio: rhubKleinAspectRatio,
            rhub_klein_orientation: rhubKleinOrientation,
            createdAt: new Date().toISOString()
        };

        const newTasks = [];
        for (let i = 0; i < numPrompts; i++) {
            newTasks.push({ 
                ...baseTask, 
                id: Math.random().toString(36).substring(7),
                index: i + 1
            });
        }

        queue = [...queue, ...newTasks];
        showToast(`Added ${numPrompts} task(s) to queue`);
        
        if (!isProcessingQueue) {
            processQueue();
        }
    }

    async function addUpscaleToQueue() {
        if (upscaleFiles.length === 0) {
            error = 'Please select at least one image to upscale';
            return;
        }
        
        const newTasks = [];
        for (const file of upscaleFiles) {
            const id = Math.random().toString(36).substring(7);
            upscaleFilesMap.set(id, file);
            newTasks.push({
                type: 'upscale',
                id,
                rhubKey,
                useTtDecoder,
                outputDir,
                prefix,
                fileName: file.name,
                createdAt: new Date().toISOString()
            });
        }

        queue = [...queue, ...newTasks];
        showToast(`Added ${upscaleFiles.length} upscale task(s) to queue`);
        upscaleFiles = []; // Clear selection after adding
        
        if (!isProcessingQueue) {
            processQueue();
        }
    }

    async function processQueue() {
        if (isProcessingQueue || queue.length === 0) return;
        
        isProcessingQueue = true;
        loading = true;
        isCancelled = false;

        while (queue.length > 0 && !isCancelled) {
            const task = queue[0];
            if (task.type === 'upscale') {
                await startUpscale(task);
            } else {
                await startGeneration(task);
            }
            queue = queue.slice(1);
        }

        isProcessingQueue = false;
        loading = false;
    }

    function handleCancel() {
        isCancelled = true;
        isProcessingQueue = false;
        loading = false;
    }

    function removeFromQueue(id: string) {
        queue = queue.filter(t => t.id !== id);
    }

    function clearQueue() {
        queue = [];
        if (!loading) {
            results = [];
        }
    }

    async function startGeneration(payload: any) {
        const resultId = payload.id;
        const displayPrompt = payload.useCustomPrompt ? payload.customPrompt : payload.subject;
        results = [{ 
            id: resultId, 
            status: 'INITIALIZING', 
            prompt: `Preparing: ${displayPrompt.substring(0, 50)}...`,
            outputDir: payload.outputDir
        }, ...results];

        try {
            const response = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            const data = await response.json();
            if (data.error) throw new Error(data.error);

            updateResult(resultId, { status: 'PROCESSING', prompt: data.prompt });

            if (data.model === 'z-image' || data.model === 'flux-klein') {
                await pollRunpodTask(resultId, data.jobId, payload);
            } else {
                await pollTask(resultId, data.taskId, payload);
            }

        } catch (e: any) {
            updateResult(resultId, { status: 'FAILED', error: e.message });
        }
    }

    async function startUpscale(task: any) {
        const resultId = task.id;
        const file = upscaleFilesMap.get(resultId);
        
        results = [{ 
            id: resultId, 
            status: 'INITIALIZING', 
            prompt: `Upscaling: ${task.fileName || 'Image'}`,
            outputDir: task.outputDir
        }, ...results];

        if (!file) {
            updateResult(resultId, { status: 'FAILED', error: 'File data lost (page refresh?)' });
            return;
        }

        try {
            const formData = new FormData();
            formData.append('image', file);
            formData.append('rhubKey', task.rhubKey);
            formData.append('useTtDecoder', String(task.useTtDecoder));

            const response = await fetch('/api/upscale', {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            if (data.error) throw new Error(data.error);

            const taskId = data.taskId;
            updateResult(resultId, { status: 'PROCESSING', taskId });

            await pollTask(resultId, taskId, task);

        } catch (e: any) {
            updateResult(resultId, { status: 'FAILED', error: e.message });
        }
    }

    async function pollTask(resultId: string, taskId: string, payload: any) {
        const { rhubKey, outputDir, prefix, useTtDecoder, model } = payload;
        // rhub-klein workflow always returns tt-encoded images
        const effectiveTtDecoder = model === 'rhub-klein' ? true : useTtDecoder;

        while (!isCancelled) {
            try {
                const response = await fetch('/api/check', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ taskId, rhubKey, outputDir, prefix, useTtDecoder: effectiveTtDecoder })
                });
                const data = await response.json();

                if (data.status === 'SUCCESS') {
                    updateResult(resultId, { status: 'SUCCESS', filename: data.filename, resultInfo: data.resultInfo, ts: Date.now() });
                    break;
                } else if (data.status === 'FAILED') {
                    updateResult(resultId, { status: 'FAILED', error: data.error });
                    break;
                }
            } catch (e: any) {
                updateResult(resultId, { status: 'FAILED', error: 'Polling error: ' + e.message });
                break;
            }
            await new Promise(r => setTimeout(r, 5000));
        }
        
        if (isCancelled && results.find(r => r.id === resultId)?.status !== 'SUCCESS') {
            updateResult(resultId, { status: 'CANCELLED', error: 'Operation cancelled' });
        }
    }

    async function pollRunpodTask(resultId: string, jobId: string, payload: any) {
        const { runpodKey: taskRunpodKey, outputDir: taskOutputDir, prefix: taskPrefix, model: taskModel } = payload;
        const startTime = Date.now();
        let loadingModelNotified = false;

        while (!isCancelled) {
            // After 30s without a result, notify user that the model/LoRAs are loading
            if (!loadingModelNotified && (Date.now() - startTime) > 30000) {
                updateResult(resultId, { status: 'LOADING_MODEL' });
                loadingModelNotified = true;
            }

            try {
                const response = await fetch('/api/zimage-check', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jobId, runpodKey: taskRunpodKey, outputDir: taskOutputDir, prefix: taskPrefix, model: taskModel })
                });
                const data = await response.json();

                if (data.status === 'SUCCESS') {
                    updateResult(resultId, { status: 'SUCCESS', filename: data.filename, ts: Date.now() });
                    break;
                } else if (data.status === 'FAILED') {
                    updateResult(resultId, { status: 'FAILED', error: data.error });
                    break;
                }
            } catch (e: any) {
                updateResult(resultId, { status: 'FAILED', error: 'Polling error: ' + e.message });
                break;
            }
            await new Promise(r => setTimeout(r, 5000));
        }

        if (isCancelled && results.find(r => r.id === resultId)?.status !== 'SUCCESS') {
            updateResult(resultId, { status: 'CANCELLED', error: 'Operation cancelled' });
        }
    }

    function updateResult(id: string, updates: any) {
        results = results.map(r => r.id === id ? { ...r, ...updates } : r);

        // Show toast for decode result
        if (updates.status === 'SUCCESS' && updates.resultInfo) {
            const { decoded, extension } = updates.resultInfo;
            if (decoded) {
                showToast(`✓ Decoded: ${extension.toUpperCase()} file`);
            } else {
                showToast('ℹ Original image saved (no hidden data)');
            }
        }
    }

    function isImageFilename(filename?: string) {
        if (!filename) return false;
        const fileExt = filename.split('.').pop()?.toLowerCase();
        return ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(fileExt || '');
    }

    function encodePathSegments(pathValue: string) {
        return pathValue
            .split('/')
            .filter(Boolean)
            .map((segment) => encodeURIComponent(segment))
            .join('/');
    }

    function getResultFilePath(res: any) {
        const resultOutputDir = typeof res.outputDir === 'string' && res.outputDir.trim() ? res.outputDir : outputDir;
        const dirPart = encodePathSegments(resultOutputDir);
        const namePart = encodeURIComponent(res.filename || '');
        return [dirPart, namePart].filter(Boolean).join('/');
    }

    function getResultFileUrl(res: any) {
        return `/api/images/${getResultFilePath(res)}?t=${res.ts || ''}`;
    }

    function removeResultCard(id: string) {
        results = results.filter((r) => r.id !== id);
    }

    function openFullScreen(url: string) {
        selectedImage = url;
    }

    async function copyPrompt(prompt: string) {
        if (!prompt) return;
        try {
            await navigator.clipboard.writeText(prompt);
            showToast('Prompt copied');
        } catch (e) {
            showToast('Could not copy prompt');
        }
    }

    async function sendToUpscale(res: any) {
        if (!res.filename || !isImageFilename(res.filename)) {
            showToast('Only image results can be upscaled');
            return;
        }

        try {
            const response = await fetch(getResultFileUrl(res));
            if (!response.ok) throw new Error('Failed to load image');
            const blob = await response.blob();
            const file = new File([blob], res.filename, { type: blob.type || 'image/png' });
            upscaleFiles = [...upscaleFiles, file];
            activeTab = 'upscale';
            showToast('Image added to upscale workflow');
        } catch (e) {
            showToast('Failed to add image to upscale workflow');
        }
    }

    async function deleteResult(res: any) {
        if (!res.filename) {
            removeResultCard(res.id);
            showToast('Card removed');
            return;
        }

        try {
            const response = await fetch(`/api/images/${getResultFilePath(res)}`, { method: 'DELETE' });
            if (!response.ok && response.status !== 404) {
                throw new Error('Delete failed');
            }
            removeResultCard(res.id);
            showToast('Image deleted');
        } catch (e) {
            showToast('Failed to delete image');
        }
    }

    function handleFileSelect(e: Event) {
        const files = (e.target as HTMLInputElement).files;
        if (files) {
            upscaleFiles = [...upscaleFiles, ...Array.from(files)];
        }
    }

    function handleDrop(e: DragEvent) {
        e.preventDefault();
        const files = e.dataTransfer?.files;
        if (files) {
            upscaleFiles = [...upscaleFiles, ...Array.from(files)];
        }
    }

    function removeUpscaleFile(file: File) {
        upscaleFiles = upscaleFiles.filter(f => f !== file);
    }
</script>

<svelte:head>
    <title>AI Image Magick (Bring your own LoRA)</title>
    <meta
        name="description"
        content="AI Image Magick lets you generate and upscale images across RunningHub and RunPod workflows with your own LoRA stack."
    />
</svelte:head>

<!-- Modal for Full Screen Image -->
{#if selectedImage}
    <div class="modal" onclick={() => selectedImage = null} role="presentation">
        <div class="modal-content" onclick={(e) => e.stopPropagation()} role="presentation">
            <img src={selectedImage} alt="Full screen preview" />
            <button class="close-modal" onclick={() => selectedImage = null}>&times;</button>
        </div>
    </div>
{/if}

<main class="container">
    <header class="hero-banner">
        <div class="hero-copy">
            <span class="hero-kicker">Bring Your Own LoRA</span>
            <h1>AI Image Magick (Bring your own LoRA)</h1>
            <p>
                Prompt, generate, refine, and upscale in one workspace with RunningHub and RunPod-backed image pipelines.
            </p>
        </div>
        <div class="hero-mark">
            <div class="hero-mark-frame">
                <img src={rhubHero} alt="RHUB logo artwork" />
            </div>
        </div>
    </header>

    <div class="card">
        <section class="api-keys">
            <h2>API Configuration</h2>
            <div class="grid">
                <div class="field">
                    <label for="promptProvider">AI Prompt Provider</label>
                    <select id="promptProvider" bind:value={promptProvider}>
                        <option value="gemini">Google Gemini</option>
                        <option value="runpod">RunPod (Qwen 30B)</option>
                    </select>
                </div>
                <div class="field">
                    <label for="rhubKey">RunningHub API Key</label>
                    <input type="password" id="rhubKey" bind:value={rhubKey} placeholder="Enter RunningHub Key" />
                </div>
            </div>
            <div class="grid" style="margin-top: 12px;">
                <div class="field">
                    <label for="geminiKey">Gemini API Key</label>
                    <input type="password" id="geminiKey" bind:value={geminiKey} placeholder="Enter Gemini Key" />
                </div>
                <div class="field">
                    <label for="runpodKey">RunPod API Key</label>
                    <input type="password" id="runpodKey" bind:value={runpodKey} placeholder="Enter RunPod Key" />
                </div>
            </div>
        </section>

        <div class="tabs-container">
            <div class="tabs">
                <button class="tab-btn {activeTab === 'generate' ? 'active' : ''}" onclick={() => activeTab = 'generate'}>
                    <span class="tab-icon">✨</span> Generate
                </button>
                <button class="tab-btn {activeTab === 'upscale' ? 'active' : ''}" onclick={() => activeTab = 'upscale'}>
                    <span class="tab-icon">🚀</span> Upscale
                </button>
                <div class="tab-slider" style="transform: translateX({activeTab === 'generate' ? '0' : '100%'})"></div>
            </div>
        </div>

        <section class="lora-settings">
            {#if activeTab === 'generate'}
                <div class="settings-header">
                    <h2>Generation Settings</h2>
                    <span class="settings-badge">
                        {#if model === 'flux-dev'}FLUX.1-dev{:else if model === 'flux-klein'}FLUX.2-klein{:else if model === 'rhub-zimage'}ZImage Upscale{:else if model === 'rhub-klein'}FLUX.2-klein (RH){:else}Z-Image{/if}
                    </span>
                </div>

                <!-- Model Selector -->
                <div class="field">
                    <label for="genModel">Generation Model</label>
                    <select id="genModel" bind:value={model}>
                        <option value="flux-dev">FLUX.1-dev — RunningHub</option>
                        <option value="flux-klein">FLUX.2-klein — RunPod Serverless</option>
                        <option value="z-image">Z-Image — RunPod Serverless</option>
                        <option value="rhub-zimage">ZImage Upscale — RunningHub</option>
                        <option value="rhub-klein">FLUX.2-klein — RunningHub</option>
                    </select>
                </div>

                <!-- TT-Decoder Toggle (FLUX.1-dev only) -->
                {#if model === 'flux-dev'}
                <div class="field toggle-field">
                    <label for="useTtDecoder" class="toggle-label">
                        <span class="toggle-text">Enable TT-Decoder</span>
                        <input type="checkbox" id="useTtDecoder" bind:checked={useTtDecoder} class="toggle-checkbox" />
                        <span class="toggle-slider-ui"></span>
                    </label>
                    <p class="toggle-description">Decode hidden files from returned images (LSB steganography)</p>
                </div>
                {/if}

                {#if model === 'flux-klein' || model === 'z-image'}
                    <div class="multi-lora-section">
                        <div class="multi-lora-header">
                            <span class="multi-lora-label">LoRA Stack</span>
                            <button type="button" class="add-lora-btn" onclick={addKleinLora}>+ Add LoRA</button>
                        </div>
                        {#each kleinLoras as lora, i}
                            {@const loraList = model === 'z-image' ? lorasZimage : lorasKlein}
                            <div class="lora-entry">
                                <div class="lora-entry-fields">
                                    {#if loraList.length > 0}
                                        <div class="field">
                                            <label for="kleinLoraPreset_{i}">LoRA Style {kleinLoras.length > 1 ? i + 1 : ''}</label>
                                            <select id="kleinLoraPreset_{i}" bind:value={lora.preset} onchange={() => {
                                                if (lora.preset) {
                                                    const found = loraList.find(l => l.name === lora.preset);
                                                    lora.url = found?.url ?? lora.url;
                                                    lora.keyword = found?.triggerWords?.join(', ') ?? lora.keyword;
                                                }
                                            }}>
                                                <option value="">— select a style —</option>
                                                {#each loraList as opt}
                                                    <option value={opt.name}>{opt.name}</option>
                                                {/each}
                                            </select>
                                        </div>
                                    {/if}
                                    <div class="field">
                                        <label for="kleinLoraUrl_{i}">LoRA URL {kleinLoras.length > 1 ? i + 1 : ''}</label>
                                        <input type="text" id="kleinLoraUrl_{i}" bind:value={lora.url} placeholder="https://..." />
                                    </div>
                                    <div class="field">
                                        <label for="kleinLoraKeyword_{i}">Trigger Word</label>
                                        <input type="text" id="kleinLoraKeyword_{i}" bind:value={lora.keyword} placeholder="e.g. TOK" />
                                    </div>
                                    <div class="field lora-scale-inline">
                                        <label for="kleinLoraScale_{i}">Scale</label>
                                        <input type="number" id="kleinLoraScale_{i}" bind:value={lora.scale} min="0" max="2" step="0.05" />
                                    </div>
                                </div>
                                {#if kleinLoras.length > 1}
                                    <button type="button" class="remove-lora-btn" onclick={() => removeKleinLora(i)}>×</button>
                                {/if}
                            </div>
                        {/each}
                    </div>
                {:else if model !== 'rhub-klein'}
                    <div class="grid">
                        <div class="field">
                            <label for="loraUrl">LoRA URL</label>
                            <input type="text" id="loraUrl" bind:value={loraUrl} placeholder="https://..." />
                        </div>
                        <div class="field">
                            <label for="loraKeyword">LoRA Trigger Word</label>
                            <input type="text" id="loraKeyword" bind:value={loraKeyword} placeholder="e.g. K1mScum" />
                        </div>
                        <div class="field">
                            <label for="loraScaleLegacy">LoRA Scale</label>
                            <input type="number" id="loraScaleLegacy" bind:value={loraScale} min="0" max="2" step="0.05" />
                        </div>
                    </div>
                {/if}

                <!-- Custom Prompt Toggle -->
                <div class="field toggle-field">
                    <label for="useCustomPrompt" class="toggle-label">
                        <span class="toggle-text">Use Custom Prompt</span>
                        <input type="checkbox" id="useCustomPrompt" bind:checked={useCustomPrompt} class="toggle-checkbox" />
                        <span class="toggle-slider-ui"></span>
                    </label>
                    <p class="toggle-description">Directly supply the final FLUX prompt (bypasses AI engineering)</p>
                </div>

                {#if useCustomPrompt}
                    <div class="field">
                        <label for="customPrompt">Custom FLUX Prompt</label>
                        <textarea id="customPrompt" bind:value={customPrompt} placeholder="Enter your full FLUX prompt here..."></textarea>
                    </div>
                {:else}
                    <div class="field">
                        <label for="subject">Subject Characteristics</label>
                        <textarea id="subject" bind:value={subject} placeholder="e.g. 50-year old woman..."></textarea>
                    </div>
                {/if}

                <div class="grid">
                    <div class="field">
                        <label for="numPrompts">Number of Prompts</label>
                        <input type="number" id="numPrompts" bind:value={numPrompts} min="1" max="50" />
                    </div>
                    {#if model === 'flux-dev' || model === 'z-image'}
                    <div class="field">
                        <label for="aspectRatio">Aspect Ratio</label>
                        <select id="aspectRatio" bind:value={aspectRatio}>
                            {#each aspectRatios as ar}
                                <option value={ar}>{ar}</option>
                            {/each}
                        </select>
                    </div>
                    {/if}
                </div>

                {#if model === 'rhub-zimage'}
                    <div class="field">
                        <label for="rhubZimageStyle">Image Style</label>
                        <select id="rhubZimageStyle" bind:value={rhubZimageStyle}>
                            {#each rhubZimageStyles as style}
                                <option value={style}>{style}</option>
                            {/each}
                        </select>
                    </div>
                    <div class="grid">
                        <div class="field">
                            <label for="rhubZimagePreset">Resolution Preset</label>
                            <select id="rhubZimagePreset" bind:value={rhubZimagePresetId}>
                                <option disabled>── Social Media ──</option>
                                {#each rhubZimagePresetsSocial as p}
                                    <option value={p.id}>{p.label}</option>
                                {/each}
                                <option disabled>── Print ──</option>
                                {#each rhubZimagePresetsPrint as p}
                                    <option value={p.id}>{p.label}</option>
                                {/each}
                            </select>
                        </div>
                        <div class="field">
                            <label>Orientation</label>
                            <div class="orient-row">
                                {#if rhubZimageWidth !== rhubZimageHeight}
                                    <button type="button" class="orient-btn {rhubZimageOrientation === 'portrait' ? 'active' : ''}" onclick={() => rhubZimageOrientation = 'portrait'}>Portrait</button>
                                    <button type="button" class="orient-btn {rhubZimageOrientation === 'landscape' ? 'active' : ''}" onclick={() => rhubZimageOrientation = 'landscape'}>Landscape</button>
                                {:else}
                                    <span class="orient-square">Square (1:1)</span>
                                {/if}
                                <span class="dim-preview">{rhubZimageWidth} × {rhubZimageHeight}</span>
                            </div>
                        </div>
                    </div>
                    <div class="field">
                        <label for="zimageSeed">Seed (−1 = random)</label>
                        <input type="number" id="zimageSeed" bind:value={zimageSeed} min="-1" />
                    </div>
                {/if}

                {#if model === 'rhub-klein'}
                    <div class="lora-section">
                        <h4>LoRA Selection</h4>
                        <div class="grid">
                            <div class="field">
                                <label for="rhubKleinLoraName">Select LoRA</label>
                                <select id="rhubKleinLoraName" bind:value={loraUrl}>
                                    <option value="K1mScum-flux.2-klein_000003000.safetensors">K1mScum-FK9B</option>
                                </select>
                            </div>
                            <div class="field">
                                <label for="rhubKleinLoraStrength">LoRA Scale</label>
                                <input type="number" id="rhubKleinLoraStrength" bind:value={loraScale} min="0" max="2" step="0.05" />
                            </div>
                        </div>
                    </div>
                    <div class="grid">
                        <div class="field">
                            <label for="rhubKleinAspectRatio">Aspect Ratio</label>
                            <select id="rhubKleinAspectRatio" bind:value={rhubKleinAspectRatio}>
                                {#each rhubKleinAspectRatios as ar}
                                    <option value={ar.ratio}>{ar.ratio}</option>
                                {/each}
                            </select>
                        </div>
                        <div class="field">
                            <label>Orientation</label>
                            <div class="orient-row">
                                <button type="button" class="orient-btn {rhubKleinOrientation === 'portrait' ? 'active' : ''}" onclick={() => rhubKleinOrientation = 'portrait'}>Portrait</button>
                                <button type="button" class="orient-btn {rhubKleinOrientation === 'landscape' ? 'active' : ''}" onclick={() => rhubKleinOrientation = 'landscape'}>Landscape</button>
                            </div>
                        </div>
                    </div>
                    <div class="field">
                        <label for="zimageSeedRhubKlein">Seed (−1 = random)</label>
                        <input type="number" id="zimageSeedRhubKlein" bind:value={zimageSeed} min="-1" />
                    </div>
                {/if}

                {#if model === 'z-image' || model === 'flux-klein'}
                    {#if model === 'flux-klein'}
                        <div class="field">
                            <label for="kleinPreset">Quality Preset</label>
                            <select id="kleinPreset" bind:value={preset}>
                                {#each kleinPresets as kp}
                                    <option value={kp.id}>{kp.label}</option>
                                {/each}
                            </select>
                        </div>
                        <div class="preset-meta">
                            Preset defaults: {getKleinPresetDefaults(preset).steps} steps, shift {getKleinPresetDefaults(preset).shift} — distilled model, guidance clamped to 1.0. Image dimensions set by Aspect Ratio below.
                        </div>
                    {/if}
                    <div class="grid">
                        {#if model === 'z-image'}
                            <div class="field">
                                <label for="zimageSteps">Inference Steps</label>
                                <input type="number" id="zimageSteps" bind:value={zimageSteps} min="10" max="50" />
                            </div>
                            <div class="field">
                                <label for="guidanceScale">Guidance Scale</label>
                                <input type="number" id="guidanceScale" bind:value={guidanceScale} min="1" max="10" step="0.1" />
                            </div>
                            <div class="field">
                                <label for="shift">Scheduler Shift</label>
                                <input type="number" id="shift" bind:value={shift} min="0.5" max="10" step="0.1" />
                                <p class="field-hint">3.0–3.5 for photorealism. Higher (5–7) favours composition; lower (1–2) favours detail.</p>
                            </div>
                            <div class="field">
                                <label for="zimageMaxSequenceLength">Prompt Length Limit (tokens)</label>
                                <input type="number" id="zimageMaxSequenceLength" bind:value={zimageMaxSequenceLength} min="64" max="512" step="64" />
                                <p class="field-hint">Max tokens read from the prompt. 512 for long detailed prompts.</p>
                            </div>
                            <div class="field">
                                <label for="zimageCfgTruncation">CFG Truncation</label>
                                <input type="number" id="zimageCfgTruncation" bind:value={zimageCfgTruncation} min="0.1" max="1.0" step="0.05" />
                                <p class="field-hint">1.0 recommended. Lower (e.g. 0.7) to reduce over-saturation.</p>
                            </div>
                            <div class="field">
                                <label for="zimageVaeTiling">VAE Tiling</label>
                                <select id="zimageVaeTiling" value={zimageVaeTiling === null ? 'auto' : String(zimageVaeTiling)} onchange={(e) => {
                                    const val = (e.target as HTMLSelectElement).value;
                                    zimageVaeTiling = val === 'auto' ? null : val === 'true';
                                }}>
                                    <option value="auto">Auto (Area &gt; 1M)</option>
                                    <option value="true">Force Enabled</option>
                                    <option value="false">Force Disabled</option>
                                </select>
                            </div>
                        {/if}
                        {#if model === 'flux-klein'}
                        <div class="field">
                            <label for="kleinAspectRatio">Aspect Ratio</label>
                            <select id="kleinAspectRatio" bind:value={kleinAspectRatio}>
                                <optgroup label="Landscape">
                                    {#each kleinAspectRatios.filter(ar => ar.group === 'Landscape') as ar}
                                        <option value={ar.ratio}>{ar.ratio} — {ar.width}×{ar.height}</option>
                                    {/each}
                                </optgroup>
                                <optgroup label="Square">
                                    {#each kleinAspectRatios.filter(ar => ar.group === 'Square') as ar}
                                        <option value={ar.ratio}>{ar.ratio} — {ar.width}×{ar.height}</option>
                                    {/each}
                                </optgroup>
                                <optgroup label="Portrait">
                                    {#each kleinAspectRatios.filter(ar => ar.group === 'Portrait') as ar}
                                        <option value={ar.ratio}>{ar.ratio} — {ar.width}×{ar.height}</option>
                                    {/each}
                                </optgroup>
                            </select>
                        </div>
                        {/if}
                        <div class="field">
                            <label for="zimageSeed">Seed (−1 = random)</label>
                            <input type="number" id="zimageSeed" bind:value={zimageSeed} min="-1" />
                        </div>
                        {#if model === 'flux-klein'}
                            <div class="field">
                                <label for="kleinShift">Shift</label>
                                <input type="number" id="kleinShift" bind:value={kleinShift} min="0.5" max="5" step="0.5" />
                                <p class="field-hint">1.5 for general photorealism. 2.5 for character LoRAs (better identity preservation). Overrides the preset default.</p>
                            </div>
                            <div class="field">
                                <label for="kleinMaxSequenceLength">Prompt Length Limit (tokens)</label>
                                <input type="number" id="kleinMaxSequenceLength" bind:value={kleinMaxSequenceLength} min="1" max="512" step="1" />
                                <p class="field-hint">Maximum prompt tokens read by the model. Extra tokens are truncated.</p>
                            </div>
                        {/if}
                    </div>

                    {#if model === 'flux-klein'}
                        <!-- Detail Refinement (2nd Pass) -->
                        <div class="field toggle-field" style="margin-top: 12px;">
                            <label for="kleinEnable2ndPass" class="toggle-label">
                                <span class="toggle-text">Enable Detail Refinement</span>
                                <input type="checkbox" id="kleinEnable2ndPass" bind:checked={kleinEnable2ndPass} class="toggle-checkbox" />
                                <span class="toggle-slider-ui"></span>
                            </label>
                            <p class="toggle-description">Runs a second inference pass to sharpen fine details and textures</p>
                        </div>

                        {#if kleinEnable2ndPass}
                            <div class="grid second-pass-params">
                                <div class="field">
                                    <label for="kleinSecondPassStrength">Refinement Strength</label>
                                    <input type="number" id="kleinSecondPassStrength" bind:value={kleinSecondPassStrength} min="0.01" max="1" step="0.01" />
                                </div>
                                <div class="field">
                                    <label for="kleinSecondPassSteps">Refinement Steps</label>
                                    <input type="number" id="kleinSecondPassSteps" bind:value={kleinSecondPassSteps} min="1" max="8" />
                                    <p class="field-hint">Server clamps to 1–8. Guidance is forced to 1.0 (distilled model).</p>
                                </div>
                            </div>
                        {/if}

                        <!-- Upscaling -->
                        <div class="field toggle-field" style="margin-top: 8px;">
                            <label for="kleinEnableUpscale" class="toggle-label">
                                <span class="toggle-text">Enable Upscaling</span>
                                <input type="checkbox" id="kleinEnableUpscale" bind:checked={kleinEnableUpscale} class="toggle-checkbox" />
                                <span class="toggle-slider-ui"></span>
                            </label>
                            <p class="toggle-description">SR upscale runs before Detail Refinement — second pass refines the upscaled image</p>
                        </div>

                        {#if kleinEnableUpscale}
                            <div class="grid second-pass-params">
                                <div class="field">
                                    <label for="kleinUpscaleFactor">Upscale Factor</label>
                                    <input type="number" id="kleinUpscaleFactor" bind:value={kleinUpscaleFactor} min="0.25" max="4" step="0.25" />
                                </div>
                                <div class="field">
                                    <label for="kleinUpscaleBlend">Upscale Blend</label>
                                    <input type="number" id="kleinUpscaleBlend" bind:value={kleinUpscaleBlend} min="0" max="1" step="0.05" />
                                </div>
                            </div>
                        {/if}
                    {/if}

                    {#if model === 'z-image'}
                        <div class="field" style="margin-top: 12px;">
                            <label for="zimageNegativePrompt">Negative Prompt</label>
                            <input type="text" id="zimageNegativePrompt" bind:value={zimageNegativePrompt} placeholder="Leave blank for photorealism default" />
                            <p class="field-hint">Leave blank to use the built-in photorealism negative. Pass an empty string (&quot;&quot;) to disable.</p>
                        </div>
                        <div class="grid" style="margin-top: 4px;">
                            <div class="field toggle-field">
                                <label for="zimageCfgNormalization" class="toggle-label">
                                    <span class="toggle-text">CFG Normalization</span>
                                    <input type="checkbox" id="zimageCfgNormalization" bind:checked={zimageCfgNormalization} class="toggle-checkbox" />
                                    <span class="toggle-slider-ui"></span>
                                </label>
                                <p class="toggle-description">Enabled by default for photorealism</p>
                            </div>
                            <div class="field toggle-field">
                                <label for="zimageUseBetaSigmas" class="toggle-label">
                                    <span class="toggle-text">Beta Sigmas</span>
                                    <input type="checkbox" id="zimageUseBetaSigmas" bind:checked={zimageUseBetaSigmas} class="toggle-checkbox" />
                                    <span class="toggle-slider-ui"></span>
                                </label>
                                <p class="toggle-description">FlowMatch beta-sigma scheduling</p>
                            </div>
                        </div>

                        <!-- Second Pass Options -->
                        <div class="field toggle-field" style="margin-top: 12px;">
                            <label for="secondPassEnabled" class="toggle-label">
                                <span class="toggle-text">Enable High-Res Refinement</span>
                                <input type="checkbox" id="secondPassEnabled" bind:checked={secondPassEnabled} class="toggle-checkbox" />
                                <span class="toggle-slider-ui"></span>
                            </label>
                            <p class="toggle-description">Runs a second pass for extra detail and upscaling</p>
                        </div>

                        {#if secondPassEnabled}
                            <div class="grid second-pass-params">
                                <div class="field">
                                    <label for="secondPassUpscale">Upscale Factor</label>
                                    <input type="number" id="secondPassUpscale" bind:value={secondPassUpscale} min="1" max="2" step="0.05" />
                                    <p class="field-hint">1.25 recommended on 24 GB cards with LoRA. Use 1.5 only with more VRAM headroom.</p>
                                </div>
                                <div class="field">
                                    <label for="secondPassSteps">Pass 2 Steps</label>
                                    <input type="number" id="secondPassSteps" bind:value={secondPassSteps} min="1" max="30" />
                                </div>
                                <div class="field">
                                    <label for="secondPassStrength">Denoising Strength</label>
                                    <input type="number" id="secondPassStrength" bind:value={secondPassStrength} min="0.01" max="1" step="0.01" />
                                </div>
                                <div class="field">
                                    <label for="secondPassGuidanceScale">Pass 2 Guidance</label>
                                    <input type="number" id="secondPassGuidanceScale" bind:value={secondPassGuidanceScale} min="1" max="8" step="0.1" />
                                </div>
                                <div class="field">
                                    <label for="secondPassMaxSequenceLength">Pass 2 Prompt Limit</label>
                                    <input type="number" id="secondPassMaxSequenceLength" bind:value={secondPassMaxSequenceLength} min="64" max="512" step="64" />
                                </div>
                                <div class="field">
                                    <label for="secondPassCfgTruncation">Pass 2 CFG Truncation</label>
                                    <input type="number" id="secondPassCfgTruncation" bind:value={secondPassCfgTruncation} min="0.1" max="1.0" step="0.05" />
                                </div>
                                <div class="field">
                                    <label for="secondPassUseBetaSigmas">Pass 2 Beta Sigmas</label>
                                    <select id="secondPassUseBetaSigmas" value={secondPassUseBetaSigmas === null ? 'inherit' : String(secondPassUseBetaSigmas)} onchange={(e) => {
                                        const val = (e.target as HTMLSelectElement).value;
                                        secondPassUseBetaSigmas = val === 'inherit' ? null : val === 'true';
                                    }}>
                                        <option value="inherit">Inherit from Pass 1</option>
                                        <option value="true">Force Enabled</option>
                                        <option value="false">Force Disabled</option>
                                    </select>
                                </div>
                                <div class="field toggle-field" style="padding-top: 24px;">
                                    <label for="secondPassCfgNormalization" class="toggle-label">
                                        <span class="toggle-text">Pass 2 CFG Normalization</span>
                                        <input type="checkbox" id="secondPassCfgNormalization" bind:checked={secondPassCfgNormalization} class="toggle-checkbox" />
                                        <span class="toggle-slider-ui"></span>
                                    </label>
                                </div>
                                <div class="field toggle-field" style="padding-top: 24px;">
                                    <label for="secondPassVaeTiling" class="toggle-label">
                                        <span class="toggle-text">Pass 2 VAE Tiling</span>
                                        <input type="checkbox" id="secondPassVaeTiling" bind:checked={secondPassVaeTiling} class="toggle-checkbox" />
                                        <span class="toggle-slider-ui"></span>
                                    </label>
                                </div>
                                <div class="field toggle-field" style="padding-top: 24px;">
                                    <label for="secondPassVaeSlicing" class="toggle-label">
                                        <span class="toggle-text">Pass 2 VAE Slicing</span>
                                        <input type="checkbox" id="secondPassVaeSlicing" bind:checked={secondPassVaeSlicing} class="toggle-checkbox" />
                                        <span class="toggle-slider-ui"></span>
                                    </label>
                                </div>
                            </div>
                        {/if}
                    {/if}
                {/if}
            {:else}
                <div class="settings-header">
                    <h2>Upscale Settings</h2>
                    <span class="settings-badge">2K Resolution</span>
                </div>
                <div class="field toggle-field">
                    <label for="useTtDecoderUpscale" class="toggle-label">
                        <span class="toggle-text">Enable TT-Decoder</span>
                        <input type="checkbox" id="useTtDecoderUpscale" bind:checked={useTtDecoder} class="toggle-checkbox" />
                        <span class="toggle-slider-ui"></span>
                    </label>
                    <p class="toggle-description">Decode hidden files from upscaled images</p>
                </div>

                <div class="field">
                    <label for="fileUploadInput">Upload Images</label>
                    <div
                        class="drop-zone"
                        onclick={() => fileInput?.click()}
                        onkeydown={(e) => e.key === 'Enter' && fileInput?.click()}
                        role="button"
                        tabindex="0"
                        ondragover={(e) => { e.preventDefault(); e.currentTarget.classList.add('dragover'); }}
                        ondragleave={(e) => { e.currentTarget.classList.remove('dragover'); }}
                        ondrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('dragover'); handleDrop(e); }}
                    >
                        <span class="drop-icon">📤</span>
                        <span class="drop-text">Click to upload or drag & drop</span>
                        <input id="fileUploadInput" type="file" multiple accept="image/*" bind:this={fileInput} onchange={handleFileSelect} hidden />
                    </div>
                    
                    {#if upscaleFiles.length > 0}
                        <div class="file-list">
                            {#each upscaleFiles as file}
                                <div class="file-item">
                                    <span class="file-name">{file.name}</span>
                                    <button class="remove-file" onclick={() => removeUpscaleFile(file)}>&times;</button>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
            {/if}

            <div class="grid">
                <div class="field">
                    <label for="outputDir">Output Sub-directory</label>
                    <input type="text" id="outputDir" bind:value={outputDir} />
                </div>
                <div class="field">
                    <label for="prefix">Filename Prefix</label>
                    <input type="text" id="prefix" bind:value={prefix} />
                </div>
            </div>
        </section>

        <div class="actions">
            <button class="btn-primary main-action" onclick={handleSubmit}>
                {activeTab === 'generate' ? (model === 'flux-dev' ? 'Add Generation to Queue' : model === 'rhub-zimage' ? 'Add ZImage Upscale to Queue' : model === 'rhub-klein' ? 'Add FLUX.2-klein to Queue' : `Add ${model === 'flux-klein' ? 'FLUX.2-klein' : 'Z-Image'} to Queue`) : 'Add Upscale to Queue'}
            </button>
            <div class="action-grid">
                {#if loading}
                    <button class="btn-danger" onclick={handleCancel}>Cancel Active</button>
                {/if}
                {#if queue.length > 0 || results.length > 0}
                    <button class="btn-secondary" onclick={clearQueue}>Clear All</button>
                {/if}
            </div>
        </div>
    </div>

    {#if error}
        <div class="error-box">{error}</div>
    {/if}

    <!-- Toast Notification -->
    {#if toastMessage}
        <div class="toast">{toastMessage}</div>
    {/if}

    {#if queue.length > 0}
        <section class="results queue-section">
            <h2>Pending Queue ({queue.length})</h2>
            <div class="queue-list">
                {#each queue as task (task.id)}
                    <div class="queue-item">
                        <div class="queue-info">
                            <span class="queue-tag">
                                {#if task.type === 'upscale'}UPSCALE{:else if task.model === 'flux-klein'}KLEIN {task.kleinAspectRatio ?? task.aspectRatio}{:else if task.model === 'z-image'}Z-IMG {task.aspectRatio}{:else if task.model === 'rhub-zimage'}ZIM-RH {task.rhub_zimage_width}×{task.rhub_zimage_height}{:else if task.model === 'rhub-klein'}KLEIN-RH {task.rhub_klein_aspect_ratio}{task.rhub_klein_orientation === 'landscape' ? 'L' : 'P'}{:else}{task.aspectRatio}{/if}
                            </span>
                            <span class="queue-prompt">
                                {#if task.type === 'upscale'}
                                    {task.fileName}
                                {:else}
                                    {task.useCustomPrompt ? task.customPrompt : task.subject}
                                {/if}
                            </span>
                        </div>
                        <button class="queue-remove" onclick={() => removeFromQueue(task.id)} title="Remove from queue">
                            &times;
                        </button>
                    </div>
                {/each}
            </div>
        </section>
    {/if}

    {#if results.length > 0}
        <section class="results">
            <h2>Live Results {#if loading}<span class="loader-dots">...</span>{/if}</h2>
            <div class="results-list">
                {#each results as res (res.id)}
                    {@const hasFile = Boolean(res.filename)}
                    {@const isImageResult = hasFile && isImageFilename(res.filename)}
                    {@const fileUrl = hasFile ? getResultFileUrl(res) : ''}
                    <div class="result-item">
                        <div class="result-header">
                            <span class="status-badge {res.status.toLowerCase()}">{res.status}</span>
                            {#if res.filename}
                                <span class="filename">{res.filename}</span>
                            {/if}
                        </div>
                        
                        <div class="result-content">
                            <div class="image-preview">
                                {#if res.status === 'SUCCESS'}
                                    {@const fileExt = res.filename?.split('.').pop()?.toLowerCase()}
                                    {#if ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(fileExt)}
                                        <button class="img-container" onclick={() => openFullScreen(fileUrl)}>
                                            <img src={fileUrl} alt="Generated" />
                                            <div class="img-overlay">Click to Enlarge</div>
                                        </button>
                                    {:else}
                                        <a class="file-download" href={fileUrl} download={res.filename}>
                                            <div class="file-icon">📄</div>
                                            <div class="file-info">
                                                <span class="file-name">{res.filename}</span>
                                                <span class="file-type">{fileExt?.toUpperCase() || 'FILE'}</span>
                                            </div>
                                            <button class="download-btn">Download</button>
                                        </a>
                                    {/if}
                                {:else if res.status === 'FAILED' || res.status === 'CANCELLED'}
                                    <div class="error-placeholder">{res.status}</div>
                                {:else if res.status === 'LOADING_MODEL'}
                                    <div class="loading-placeholder">Loading Model / LoRAs...<br><small>First request with a new LoRA set takes 15–20s extra</small></div>
                                {:else}
                                    <div class="loading-placeholder">Processing...</div>
                                {/if}
                            </div>
                            <div class="prompt-display">
                                <div class="prompt-label">Prompt / Info</div>
                                <textarea readonly value={res.prompt || ''}></textarea>
                                {#if res.error}
                                    <p class="error-text">{res.error}</p>
                                {/if}
                                <div class="result-actions">
                                    <button
                                        class="result-action-btn"
                                        onclick={() => openFullScreen(fileUrl)}
                                        disabled={!isImageResult}
                                    >
                                        Full Screen
                                    </button>
                                    {#if hasFile}
                                        <a class="result-action-btn" href={fileUrl} download={res.filename}>Save Image</a>
                                    {:else}
                                        <span class="result-action-btn disabled-link">Save Image</span>
                                    {/if}
                                    <button
                                        class="result-action-btn"
                                        onclick={() => copyPrompt(res.prompt || '')}
                                        disabled={!res.prompt}
                                    >
                                        Copy Prompt
                                    </button>
                                    <button
                                        class="result-action-btn"
                                        onclick={() => sendToUpscale(res)}
                                        disabled={!isImageResult}
                                    >
                                        Send to Upscale
                                    </button>
                                    <button
                                        class="result-action-btn danger"
                                        onclick={() => deleteResult(res)}
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                {/each}
            </div>
        </section>
    {/if}
</main>

<style>
    :global(*) {
        box-sizing: border-box;
    }
    :global(body) {
        font-family: 'Inter', system-ui, sans-serif;
        background:
            radial-gradient(circle at top left, rgba(96, 165, 250, 0.18), transparent 28%),
            radial-gradient(circle at top right, rgba(15, 118, 110, 0.14), transparent 24%),
            linear-gradient(180deg, #ecf3ff 0%, #f8fafc 32%, #f8fafc 100%);
        color: #1e293b;
        margin: 0;
        -webkit-tap-highlight-color: transparent;
        overflow-x: hidden;
    }
    .container {
        max-width: 1180px;
        margin: 0 auto;
        padding: 20px 16px;
        width: 100%;
        overflow-x: hidden;
    }
    
    @media (min-width: 768px) {
        .container { margin: 40px auto; padding: 0 20px; }
    }

    .hero-banner {
        position: relative;
        display: grid;
        grid-template-columns: 1fr;
        gap: 24px;
        align-items: center;
        margin-bottom: 24px;
        padding: 28px 24px;
        border-radius: 28px;
        overflow: hidden;
        background:
            radial-gradient(circle at 15% 20%, rgba(96, 165, 250, 0.24), transparent 22%),
            radial-gradient(circle at 80% 25%, rgba(45, 212, 191, 0.18), transparent 20%),
            linear-gradient(135deg, rgba(11, 18, 32, 0.86) 0%, #162338 50%, #0f172a 100%);
        border: 1px solid rgba(148, 163, 184, 0.25);
        box-shadow:
            0 30px 60px rgba(15, 23, 42, 0.22),
            inset 0 1px 0 rgba(255, 255, 255, 0.06);
    }
    .hero-banner::after {
        content: '';
        position: absolute;
        inset: auto -10% -32% auto;
        width: 280px;
        height: 280px;
        background: radial-gradient(circle, rgba(96, 165, 250, 0.35) 0%, transparent 70%);
        pointer-events: none;
    }
    .hero-copy {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        gap: 14px;
    }
    .hero-kicker {
        width: fit-content;
        padding: 7px 12px;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.14);
        border: 1px solid rgba(191, 219, 254, 0.28);
        color: #bfdbfe;
        font-size: 0.74rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
    }
    .hero-banner h1 {
        margin: 0;
        color: #f8fafc;
        font-size: clamp(2rem, 5vw, 3.6rem);
        line-height: 1.02;
        max-width: 12ch;
    }
    .hero-banner p {
        margin: 0;
        max-width: 52ch;
        color: #e2e8f0;
        font-size: 1rem;
        line-height: 1.6;
    }
    .hero-mark {
        position: relative;
        z-index: 1;
        display: flex;
        justify-content: center;
    }
    .hero-mark-frame {
        width: min(100%, 440px);
        padding: 18px;
        border-radius: 24px;
        background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.04)),
            rgba(15, 23, 42, 0.38);
        border: 1px solid rgba(191, 219, 254, 0.2);
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.28);
        backdrop-filter: blur(8px);
    }
    .hero-mark-frame img {
        display: block;
        width: 100%;
        height: auto;
        object-fit: contain;
        filter: drop-shadow(0 20px 32px rgba(15, 23, 42, 0.45));
    }

    @media (min-width: 900px) {
        .hero-banner {
            grid-template-columns: minmax(0, 1.25fr) minmax(300px, 0.9fr);
            gap: 32px;
            margin-bottom: 40px;
            padding: 40px;
        }
    }

    .card, .results {
        background: white;
        padding: 20px;
        border-radius: 18px;
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.08);
        margin-bottom: 24px;
        border: 1px solid rgba(203, 213, 225, 0.9);
        width: 100%;
    }

    @media (min-width: 768px) {
        .card, .results { padding: 32px; }
    }

    h2 { font-size: 1rem; margin: 0 0 16px 0; padding-bottom: 10px; border-bottom: 1px solid #f1f5f9; }
    
    .settings-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
        padding-bottom: 10px;
        border-bottom: 1px solid #f1f5f9;
    }
    .settings-header h2 { margin: 0; border: none; padding: 0; }
    .settings-badge {
        font-size: 0.7rem;
        background: #eff6ff;
        color: #2563eb;
        padding: 2px 10px;
        border-radius: 99px;
        font-weight: 700;
        text-transform: uppercase;
    }

    .grid { 
        display: grid; 
        grid-template-columns: 1fr; 
        gap: 12px; 
        width: 100%;
    }

    @media (min-width: 640px) {
        .grid { grid-template-columns: 1fr 1fr; gap: 20px; }
    }

    .field { margin-bottom: 12px; display: flex; flex-direction: column; width: 100%; }
    label { font-size: 0.75rem; font-weight: 600; color: #64748b; margin-bottom: 4px; }

    /* Modern Tabs Styles */
    .tabs-container {
        margin-bottom: 32px;
    }
    .tabs {
        display: flex;
        background: #f1f5f9;
        padding: 4px;
        border-radius: 12px;
        position: relative;
        box-shadow: inset 0 2px 4px rgba(0,0,0,0.05);
    }
    .tab-btn {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 40px;
        padding: 8px 16px;
        border-radius: 8px;
        border: none;
        background: transparent;
        color: #64748b;
        font-weight: 600;
        font-size: 0.9rem;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        z-index: 2;
    }
    .tab-btn.active {
        color: #2563eb;
    }
    .tab-btn:not(.active):hover {
        color: #1e293b;
    }
    .tab-slider {
        position: absolute;
        top: 4px;
        left: 4px;
        width: calc(50% - 4px);
        height: calc(100% - 8px);
        background: white;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        z-index: 1;
    }
    .tab-icon { font-size: 1rem; }

    /* Drop Zone Styles */
    .drop-zone {
        border: 2px dashed #cbd5e1;
        border-radius: 12px;
        padding: 40px 20px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: #f8fafc;
        cursor: pointer;
        transition: all 0.2s;
        text-align: center;
    }
    .drop-zone:hover, .drop-zone.dragover {
        border-color: #2563eb;
        background: #eff6ff;
    }
    .drop-icon { font-size: 2.5rem; margin-bottom: 12px; }
    .drop-text { font-size: 0.95rem; color: #475569; font-weight: 500; }

    .file-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 16px;
    }
    .file-item {
        background: #e2e8f0;
        padding: 6px 12px;
        border-radius: 8px;
        font-size: 0.85rem;
        display: flex;
        align-items: center;
        gap: 10px;
        max-width: 240px;
        border: 1px solid #cbd5e1;
    }
    .file-name {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-weight: 500;
    }
    .remove-file {
        background: #f1f5f9;
        border: none;
        color: #64748b;
        cursor: pointer;
        font-size: 1.2rem;
        padding: 0;
        min-height: 24px;
        width: 24px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
    }
    .remove-file:hover { background: #fee2e2; color: #dc2626; }

    /* Toggle Switch Styles */
    .toggle-field { margin-bottom: 16px; }
    .toggle-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
        padding: 12px;
        background: #f8fafc;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
    }
    .toggle-text { font-weight: 600; color: #1e293b; }
    .toggle-checkbox {
        position: absolute;
        opacity: 0;
        width: 0;
        height: 0;
    }
    .toggle-slider-ui {
        position: relative;
        width: 44px;
        height: 24px;
        background: #cbd5e1;
        border-radius: 99px;
        transition: background 0.2s;
        flex-shrink: 0;
    }
    .toggle-slider-ui::before {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 20px;
        height: 20px;
        background: white;
        border-radius: 50%;
        transition: transform 0.2s;
        box-shadow: 0 1px 2px rgba(0,0,0,0.1);
    }
    .toggle-checkbox:checked + .toggle-slider-ui { background: #2563eb; }
    .toggle-checkbox:checked + .toggle-slider-ui::before { transform: translateX(20px); }
    .toggle-description { font-size: 0.75rem; color: #64748b; margin-top: 4px; margin-bottom: 12px; }
    
    input, select, textarea {
        width: 100%;
        padding: 12px;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        font-size: 1rem;
        appearance: none;
        background-color: white;
    }

    select {
        background-color: #f8fafc;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 12px center;
        padding-right: 40px;
        border-color: #94a3b8;
        cursor: pointer;
    }
    select:focus { border-color: #2563eb; outline: none; box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }

    /* Orientation toggle */
    .orient-row {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
        min-height: 48px;
    }
    .orient-btn {
        flex: 1;
        min-height: 40px;
        background: #f1f5f9;
        color: #475569;
        border: 1px solid #e2e8f0;
        font-size: 0.875rem;
        font-weight: 500;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.15s;
        width: auto;
        padding: 8px 12px;
    }
    .orient-btn.active {
        background: #2563eb;
        color: white;
        border-color: #2563eb;
    }
    .orient-btn:hover:not(.active) { background: #e2e8f0; }
    .orient-square {
        font-size: 0.875rem;
        color: #64748b;
        font-style: italic;
    }
    .dim-preview {
        font-size: 0.8rem;
        font-weight: 700;
        color: #2563eb;
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        padding: 4px 10px;
        border-radius: 6px;
        font-family: 'Courier New', monospace;
        white-space: nowrap;
    }

    /* Better touch targets for mobile */
    input[type="number"], select {
        min-height: 48px;
    }

    textarea { height: 100px; resize: vertical; }
    
    .actions { display: flex; flex-direction: column; gap: 12px; margin-top: 24px; }
    
    .main-action {
        font-size: 1.1rem;
        padding: 16px;
        background: #2563eb;
        color: white;
        box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2), 0 2px 4px -1px rgba(37, 99, 235, 0.1);
    }
    .action-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
    }

    button { 
        width: 100%;
        min-height: 48px;
        padding: 12px; 
        border: none; 
        border-radius: 8px; 
        font-weight: 600; 
        cursor: pointer; 
        transition: transform 0.1s, opacity 0.2s, background 0.2s; 
        font-size: 1rem;
    }
    button:active { transform: scale(0.98); }
    button:hover { opacity: 0.9; }
    .btn-primary { background: #2563eb; color: white; }
    .btn-secondary { background: #e2e8f0; color: #475569; }
    .btn-danger { background: #dc2626; color: white; }

    .status-badge { font-size: 0.65rem; padding: 4px 8px; border-radius: 99px; font-weight: 700; text-transform: uppercase; margin-right: 8px; }
    .initializing { background: #fef3c7; color: #92400e; }
    .processing { background: #dbeafe; color: #1e40af; }
    .loading_model { background: #ede9fe; color: #5b21b6; }
    .success { background: #dcfce7; color: #166534; }
    .failed, .cancelled { background: #fee2e2; color: #991b1b; }

    .result-item { padding: 16px 0; border-bottom: 1px solid #f1f5f9; width: 100%; }
    .result-header { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
    .filename { font-size: 0.8rem; color: #64748b; word-break: break-all; }

    .result-content { 
        display: flex;
        flex-direction: column;
        gap: 16px; 
        margin-top: 12px; 
        width: 100%;
    }

    @media (min-width: 768px) {
        .result-content { display: grid; grid-template-columns: 200px 1fr; gap: 24px; }
    }
    
    .img-container { position: relative; padding: 0; border: none; background: none; width: 100%; border-radius: 8px; overflow: hidden; }
    .img-container img { width: 100%; display: block; }
    .img-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); color: white; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s; font-size: 0.8rem; }

    /* File Download Card Styles */
    .file-download { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; background: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 8px; text-decoration: none; color: inherit; width: 100%; min-height: 150px; }
    .file-icon { font-size: 2.5rem; margin-bottom: 8px; }
    .file-info { display: flex; flex-direction: column; align-items: center; gap: 4px; margin-bottom: 12px; text-align: center; }
    .file-name { font-size: 0.75rem; font-weight: 600; color: #1e293b; word-break: break-all; }
    .file-type { font-size: 0.65rem; padding: 2px 8px; background: #e2e8f0; border-radius: 99px; font-weight: 600; color: #64748b; }
    .download-btn { padding: 8px 16px; background: #2563eb; color: white; border: none; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; }
    .download-btn:hover { background: #1d4ed8; }
    
    @media (hover: hover) {
        .img-container:hover .img-overlay { opacity: 1; }
    }

    .loading-placeholder, .error-placeholder { width: 100%; aspect-ratio: 1; background: #f1f5f9; display: flex; align-items: center; justify-content: center; border-radius: 8px; font-size: 0.8rem; color: #94a3b8; border: 2px dashed #e2e8f0; }
    .prompt-display { display: flex; flex-direction: column; width: 100%; }
    .prompt-label { font-size: 0.75rem; font-weight: 600; color: #64748b; margin-bottom: 4px; }
    .prompt-display textarea { width: 100%; height: 100px; background: #f8fafc; border: 1px solid #f1f5f9; font-size: 0.85rem; }
    .error-text { color: #dc2626; font-size: 0.8rem; margin-top: 8px; }
    .result-actions {
        margin-top: 10px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    .result-action-btn {
        width: auto;
        min-height: 36px;
        padding: 8px 12px;
        border-radius: 8px;
        border: 1px solid #cbd5e1;
        background: white;
        color: #334155;
        font-size: 0.8rem;
        font-weight: 600;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }
    .result-action-btn:disabled,
    .result-action-btn.disabled-link {
        opacity: 0.5;
        cursor: not-allowed;
        pointer-events: none;
    }
    .result-action-btn.danger {
        background: #fee2e2;
        border-color: #fecaca;
        color: #b91c1c;
    }

    /* Queue Styles */
    .queue-section { border-left: 4px solid #2563eb; }
    .queue-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
    .queue-item { 
        display: flex; 
        align-items: center; 
        justify-content: space-between; 
        padding: 10px 14px; 
        background: #f8fafc; 
        border: 1px solid #e2e8f0; 
        border-radius: 8px; 
        gap: 12px;
    }
    .queue-info { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
    .queue-tag { 
        font-size: 0.65rem; 
        font-weight: 700; 
        background: #e2e8f0; 
        color: #475569; 
        padding: 2px 6px; 
        border-radius: 4px; 
        white-space: nowrap;
    }
    .queue-prompt { 
        font-size: 0.85rem; 
        color: #1e293b; 
        white-space: nowrap; 
        overflow: hidden; 
        text-overflow: ellipsis; 
        flex: 1;
    }
    .queue-remove { 
        background: #fee2e2; 
        color: #dc2626; 
        border: none; 
        width: 28px; 
        height: 28px; 
        border-radius: 50%; 
        display: flex; 
        align-items: center; 
        justify-content: center; 
        cursor: pointer; 
        font-size: 1.2rem; 
        padding: 0;
        flex-shrink: 0;
        transition: background 0.2s;
    }
    .queue-remove:hover { background: #fecaca; }

    .loader-dots { margin-left: 8px; }

    /* Modal Styles */
    .modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.95); z-index: 1000; display: flex; align-items: center; justify-content: center; }
    .modal-content { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
    .modal-content img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .close-modal { position: absolute; top: 20px; right: 20px; background: rgba(255,255,255,0.2); border: none; color: white; font-size: 1.5rem; cursor: pointer; padding: 10px; line-height: 1; border-radius: 50%; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; }

    /* Toast Notification Styles */
    .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #1e293b; color: white; padding: 12px 20px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 9999; animation: slideUp 0.3s ease-out; max-width: 400px; text-align: center; }
    @keyframes slideUp {
        from { transform: translateX(-50%) translateY(20px); opacity: 0; }
        to { transform: translateX(-50%) translateY(0); opacity: 1; }
    }

    /* Multi-LoRA Stack (FLUX.2-klein) */
    .multi-lora-section {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .multi-lora-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }
    .multi-lora-label {
        font-size: 0.8rem;
        font-weight: 600;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    .add-lora-btn {
        width: auto;
        min-height: 34px;
        padding: 6px 14px;
        font-size: 0.8rem;
        background: #eff6ff;
        color: #2563eb;
        border: 1px solid #bfdbfe;
        border-radius: 6px;
        font-weight: 600;
    }
    .add-lora-btn:hover { background: #dbeafe; opacity: 1; }
    .lora-entry {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        padding: 12px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
    }
    .lora-entry-fields {
        flex: 1;
        display: grid;
        grid-template-columns: 1fr 1fr auto;
        gap: 10px;
        align-items: end;
    }
    .lora-scale-inline input { max-width: 90px; }
    .remove-lora-btn {
        width: 32px;
        min-height: 32px;
        height: 32px;
        padding: 0;
        flex-shrink: 0;
        background: #fee2e2;
        color: #dc2626;
        border-radius: 6px;
        font-size: 1.2rem;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .remove-lora-btn:hover { background: #fecaca; opacity: 1; }
    .preset-meta {
        margin-top: -2px;
        margin-bottom: 4px;
        font-size: 0.85rem;
        color: #64748b;
    }
    .field-hint {
        margin-top: 6px;
        font-size: 0.78rem;
        color: #64748b;
        line-height: 1.35;
    }

    @media (max-width: 600px) {
        .lora-entry-fields { grid-template-columns: 1fr; }
        .lora-scale-inline input { max-width: 100%; }
    }
</style>
