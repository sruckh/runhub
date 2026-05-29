<script lang="ts">
    import { onMount, untrack } from 'svelte';
    import rhubHero from '../../imgs/RHUB.svg';

    let { data } = $props();

    // untrack: read env-backed defaults once at init without reactive tracking
    const { geminiKey: _gk = '', rhubKey: _rk = '', runpodKey: _rpk = '', falKey: _fk = '' } = untrack(() => data.envKeys ?? {});
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
    let falKey = $state(_fk);
    let promptProvider = $state('gemini');
    let model = $state('flux-dev'); // 'flux-dev' | 'flux-klein' | 'z-image'
    let apiKeysOpen = $state(!(_gk && _rk)); // open only when keys are missing

    // Z-Image / FLUX.2-klein extra params
    let zimageSteps = $state(50);
    let guidanceScale = $state(4.5);
    let zimageSeed = $state(-1);
    let loraScale = $state(0.85);
    let fluxDevSeed = $state(0);
    let fluxDevLoraStrength = $state(1);
    let shift = $state(1.0);
    let preset = $state('realistic_character');

    // Z-Image new params
    let zimageNegativePrompt = $state('');
    let zimageMaxSequenceLength = $state(512);
    let zimageUseBetaSigmas = $state(false);
    let zimageCfgNormalization = $state(true);
    let zimageCfgTruncation = $state(1.0);
    let zimageVaeTiling = $state<boolean | null>(null); // null = auto
    let zimageUpscaleModel = $state('nomos_webphoto');
    let zimageUpscaleEnabled = $state(true);
    let zimageUpscaleFactor = $state(1.5);

    // Z-Image second pass params
    let secondPassEnabled = $state(true);
    let secondPassUpscale = $state(1.25);
    let secondPassStrength = $state(0.42);
    let secondPassGuidanceScale = $state(4.5);
    let secondPassSteps = $state(28);
    let secondPassMaxSequenceLength = $state(512);
    let secondPassCfgNormalization = $state(true);
    let secondPassCfgTruncation = $state(1.0);
    let secondPassUseBetaSigmas = $state<boolean | null>(null); // null = inherit
    let secondPassSeed = $state<number | null>(null); // null = inherit from base pass
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
    let _prevLoraModel = untrack(() => model);
    $effect(() => {
        const m = model;
        if ((m === 'flux-klein' || m === 'z-image') && m !== _prevLoraModel) {
            kleinLoras = [{ url: '', keyword: '', scale: 0.85, preset: '' }];
        }
        _prevLoraModel = m;
    });

    // Sync kleinShift with preset default when preset changes
    let _prevPreset = untrack(() => preset);
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
    let rhubKleinWorkflow = $state('standard');
    let rhubKleinAspectRatio = $state('1:1');
    let rhubKleinOrientation = $state('portrait');

    const rhubKleinWorkflows = [
        { id: 'standard', label: 'Standard' },
        { id: 'upscale', label: 'Upscale' },
    ];

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
    const savedUpscaleEngine = typeof localStorage !== 'undefined' ? localStorage.getItem('upscaleEngine') : null;
    let upscaleEngine = $state(savedUpscaleEngine || 'runninghub-2k');
    
    let activeTab = $state('generate'); // 'generate' | 'upscale' | 'enhance' | 'video'
    let loading = $state(false);
    let queue = $state<any[]>([]);
    let isProcessingQueue = $state(false);

    // Upscale states
    let upscaleFiles = $state<File[]>([]);

    let fileInput = $state<HTMLInputElement | null>(null);
    const upscaleFilesMap = new Map<string, File>();

    // Enhance states
    let enhanceEngine = $state('fal'); // 'fal' | 'runninghub'
    let enhanceImageUrl = $state('');
    let enhanceFile = $state<File | null>(null);
    let enhanceOutputFormat = $state('jpeg');
    let enhanceFileInput = $state<HTMLInputElement | null>(null);
    const enhanceFileMap = new Map<string, File>();

    // Create Video states
    let videoPrompt = $state('');
    let videoImageUrls = $state<string[]>(['']);
    let videoVideoUrls = $state<string[]>(['']);
    let videoAudioUrls = $state<string[]>(['']);
    let videoResolution = $state('720p');
    let videoDuration = $state('auto');
    let videoAspectRatio = $state('auto');
    let videoGenerateAudio = $state(true);
    let videoSeed = $state(-1);
    let videoEndUserId = $state('');
    let videoFileInput = $state<HTMLInputElement | null>(null);
    let videoUploadIndex = $state(0);
    let videoVideoFileInput = $state<HTMLInputElement | null>(null);
    let videoVideoUploadIndex = $state(0);
    let videoAudioFileInput = $state<HTMLInputElement | null>(null);
    let videoAudioUploadIndex = $state(0);
    const maxVideoImageBytes = 30 * 1024 * 1024;
    const maxVideoAudioBytes = 15 * 1024 * 1024;
    const maxVideoVideoBytes = 50 * 1024 * 1024;
    const validVideoResolutions = new Set(['480p', '720p', '1080p']);
    const validVideoDurations = new Set(['auto', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15']);
    const validVideoAspectRatios = new Set(['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);
    const validVideoImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    const validVideoAudioTypes = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav']);
    const validVideoVideoTypes = new Set(['video/mp4', 'video/quicktime']);

    // Persist setting changes and queue
    $effect(() => {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('useTtDecoder', String(useTtDecoder));
            localStorage.setItem('upscaleEngine', upscaleEngine);
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
                if (queue.length > 0) processQueue();
            } catch (e) {
                console.error('Failed to parse queue', e);
            }
        }
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && selectedImage) selectedImage = null;
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
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

    const zimageUpscaleModels = [
        {
            id: 'nomos_webphoto',
            label: 'NomosWebPhoto (RealPLKSR)',
            hint: 'Default. Natural realistic-photo detail; best general choice for people.'
        },
        {
            id: 'nomos_webphoto_esrgan',
            label: 'NomosWebPhoto (ESRGAN)',
            hint: 'Same realistic target with a slightly different detail character.'
        },
        {
            id: 'purephoto',
            label: 'PurePhoto (RealPLKSR)',
            hint: 'Legacy sharper model; can over-process faces.'
        }
    ];

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
        } else if (activeTab === 'upscale') {
            addUpscaleToQueue();
        } else if (activeTab === 'video') {
            addVideoToQueue();
        } else {
            addEnhanceToQueue();
        }
    }

    async function addToQueue() {
        if (model === 'rhub-klein' && !loraUrl.trim()) {
            error = 'Character LoRA URL is required for FLUX.2-klein (RH)';
            return;
        }

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
            flux_dev_seed: fluxDevSeed,
            flux_dev_lora_strength: fluxDevLoraStrength,
            shift,
            preset,
            zimage_negative_prompt: zimageNegativePrompt,
            zimage_max_sequence_length: zimageMaxSequenceLength,
            zimage_use_beta_sigmas: zimageUseBetaSigmas,
            zimage_cfg_normalization: zimageCfgNormalization,
            zimage_cfg_truncation: zimageCfgTruncation,
            zimage_vae_tiling: zimageVaeTiling,
            upscale_model: zimageUpscaleModel,
            upscale_enabled: zimageUpscaleEnabled,
            upscale_factor: zimageUpscaleFactor,
            second_pass_enabled: secondPassEnabled,
            second_pass_upscale: secondPassUpscale,
            second_pass_strength: secondPassStrength,
            second_pass_guidance_scale: secondPassGuidanceScale,
            second_pass_steps: secondPassSteps,
            second_pass_seed: secondPassSeed,
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
            rhub_klein_workflow: rhubKleinWorkflow,
            rhub_klein_lora1_url: loraUrl.trim(),
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
                upscaleEngine,
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

    async function addEnhanceToQueue() {
        if (!enhanceFile && !enhanceImageUrl.trim()) {
            error = 'Please upload an image or enter an image URL to enhance';
            return;
        }

        const id = Math.random().toString(36).substring(7);
        if (enhanceFile) {
            enhanceFileMap.set(id, enhanceFile);
        }

        const task = {
            type: 'enhance',
            id,
            engine: enhanceEngine,
            falKey,
            rhubKey,
            imageUrl: enhanceFile ? '' : enhanceImageUrl.trim(),
            outputFormat: enhanceOutputFormat,
            outputDir,
            prefix,
            fileName: enhanceFile?.name || '',
            createdAt: new Date().toISOString()
        };

        queue = [...queue, task];
        showToast('Added enhance task to queue');
        enhanceFile = null;
        enhanceImageUrl = '';

        if (!isProcessingQueue) {
            processQueue();
        }
    }

    async function startEnhance(task: any) {
        const resultId = task.id;
        const label = task.fileName || task.imageUrl || 'Image';

        results = [{
            id: resultId,
            status: 'INITIALIZING',
            prompt: `Enhancing: ${label}`,
            outputDir: task.outputDir
        }, ...results];

        const file = enhanceFileMap.get(resultId);

        try {
            const formData = new FormData();
            formData.append('engine', task.engine || 'fal');
            formData.append('falKey', task.falKey);
            formData.append('rhubKey', task.rhubKey);
            formData.append('outputFormat', task.outputFormat);
            formData.append('outputDir', task.outputDir);
            formData.append('prefix', task.prefix);
            if (file) {
                formData.append('image', file);
            } else {
                formData.append('imageUrl', task.imageUrl);
            }

            updateResult(resultId, { status: 'PROCESSING' });
            const response = await fetch('/api/enhance', { method: 'POST', body: formData });
            const data = await response.json();
            if (data.error) throw new Error(data.error);

            if (data.taskId) {
                // RunningHub async path — hand off to the existing pollTask machinery
                updateResult(resultId, { status: 'PROCESSING', taskId: data.taskId });
                await pollTask(resultId, data.taskId, {
                    rhubKey: task.rhubKey,
                    outputDir: task.outputDir,
                    prefix: task.prefix,
                    useTtDecoder: false
                });
            } else {
                // fal.ai synchronous path
                updateResult(resultId, { status: 'SUCCESS', filename: data.filename, ts: Date.now() });
            }
        } catch (e: any) {
            updateResult(resultId, { status: 'FAILED', error: e.message });
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
            } else if (task.type === 'enhance') {
                await startEnhance(task);
            } else if (task.type === 'video') {
                await startVideo(task);
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
            formData.append('upscaleEngine', task.upscaleEngine || 'runninghub-2k');

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

    async function sendToEnhance(res: any) {
        if (!res.filename || !isImageFilename(res.filename)) {
            showToast('Only image results can be enhanced');
            return;
        }

        try {
            const relativeUrl = getResultFileUrl(res);
            const response = await fetch(relativeUrl);
            if (!response.ok) throw new Error('Failed to load image');
            const blob = await response.blob();
            // Set file for fal.ai engine and absolute URL for RunningHub engine
            enhanceFile = new File([blob], res.filename, { type: blob.type || 'image/jpeg' });
            enhanceImageUrl = window.location.origin + relativeUrl;
            activeTab = 'enhance';
            showToast('Image sent to Enhance tab');
        } catch (e) {
            showToast('Failed to send image to Enhance tab');
        }
    }

    function addVideoImageUrl() {
        if (videoImageUrls.length < 9) videoImageUrls = [...videoImageUrls, ''];
    }
    function removeVideoImageUrl(i: number) {
        if (videoImageUrls.length > 1) videoImageUrls = videoImageUrls.filter((_, idx) => idx !== i);
        else videoImageUrls = [''];
    }
    function clearVideoImageUrl(i: number) {
        videoImageUrls = videoImageUrls.map((u, idx) => idx === i ? '' : u);
    }
    function openVideoFileUpload(index: number) {
        videoUploadIndex = index;
        videoFileInput?.click();
    }
    async function fileToDataUri(file: File, fallbackType: string) {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        return `data:${file.type || fallbackType};base64,${base64}`;
    }
    function dataUriByteLength(value: string) {
        const match = value.match(/^data:[^;,]+;base64,([A-Za-z0-9+/=]+)$/);
        if (!match) return 0;
        const padding = match[1].endsWith('==') ? 2 : match[1].endsWith('=') ? 1 : 0;
        return Math.floor((match[1].length * 3) / 4) - padding;
    }
    async function handleVideoFileSelect(e: Event) {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        if (!validVideoImageTypes.has(file.type)) {
            error = 'Reference images must be JPEG, PNG, or WebP';
            (e.target as HTMLInputElement).value = '';
            return;
        }
        if (file.size > maxVideoImageBytes) {
            error = 'Reference images must be 30 MB or smaller';
            (e.target as HTMLInputElement).value = '';
            return;
        }
        const dataUri = await fileToDataUri(file, 'image/jpeg');
        videoImageUrls = videoImageUrls.map((u, idx) => idx === videoUploadIndex ? dataUri : u);
        (e.target as HTMLInputElement).value = '';
    }

    function addVideoVideoUrl() {
        if (videoVideoUrls.length < 3) videoVideoUrls = [...videoVideoUrls, ''];
    }
    function removeVideoVideoUrl(i: number) {
        if (videoVideoUrls.length > 1) videoVideoUrls = videoVideoUrls.filter((_, idx) => idx !== i);
        else videoVideoUrls = [''];
    }
    function clearVideoVideoUrl(i: number) {
        videoVideoUrls = videoVideoUrls.map((u, idx) => idx === i ? '' : u);
    }
    function openVideoVideoUpload(index: number) {
        videoVideoUploadIndex = index;
        videoVideoFileInput?.click();
    }
    async function handleVideoVideoFileSelect(e: Event) {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        if (!validVideoVideoTypes.has(file.type)) {
            error = 'Reference videos must be MP4 or MOV';
            (e.target as HTMLInputElement).value = '';
            return;
        }
        if (file.size > maxVideoVideoBytes) {
            error = 'Reference video uploads must be 50 MB or smaller';
            (e.target as HTMLInputElement).value = '';
            return;
        }
        const otherUploadedBytes = videoVideoUrls.reduce((total, url, idx) => {
            if (idx === videoVideoUploadIndex) return total;
            return total + dataUriByteLength(url);
        }, 0);
        if (otherUploadedBytes + file.size > maxVideoVideoBytes) {
            error = 'Reference video uploads must be 50 MB or smaller in total';
            (e.target as HTMLInputElement).value = '';
            return;
        }
        const dataUri = await fileToDataUri(file, 'video/mp4');
        videoVideoUrls = videoVideoUrls.map((u, idx) => idx === videoVideoUploadIndex ? dataUri : u);
        (e.target as HTMLInputElement).value = '';
    }

    function addVideoAudioUrl() {
        if (videoAudioUrls.length < 3) videoAudioUrls = [...videoAudioUrls, ''];
    }
    function removeVideoAudioUrl(i: number) {
        if (videoAudioUrls.length > 1) videoAudioUrls = videoAudioUrls.filter((_, idx) => idx !== i);
        else videoAudioUrls = [''];
    }
    function clearVideoAudioUrl(i: number) {
        videoAudioUrls = videoAudioUrls.map((u, idx) => idx === i ? '' : u);
    }
    function openVideoAudioUpload(index: number) {
        videoAudioUploadIndex = index;
        videoAudioFileInput?.click();
    }
    async function handleVideoAudioFileSelect(e: Event) {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        if (!validVideoAudioTypes.has(file.type)) {
            error = 'Reference audio must be MP3 or WAV';
            (e.target as HTMLInputElement).value = '';
            return;
        }
        if (file.size > maxVideoAudioBytes) {
            error = 'Reference audio must be 15 MB or smaller';
            (e.target as HTMLInputElement).value = '';
            return;
        }
        const dataUri = await fileToDataUri(file, 'audio/mpeg');
        videoAudioUrls = videoAudioUrls.map((u, idx) => idx === videoAudioUploadIndex ? dataUri : u);
        (e.target as HTMLInputElement).value = '';
    }

    async function addVideoToQueue() {
        if (!videoPrompt.trim()) {
            error = 'Please enter a prompt for video generation';
            return;
        }

        const imageUrls = videoImageUrls.map(u => u.trim()).filter(Boolean);
        const videoUrls = videoVideoUrls.map(u => u.trim()).filter(Boolean);
        const audioUrls = videoGenerateAudio ? videoAudioUrls.map(u => u.trim()).filter(Boolean) : [];
        const videoValidationError = validateVideoInputs(imageUrls, videoUrls, audioUrls);
        if (videoValidationError) {
            error = videoValidationError;
            return;
        }

        const id = Math.random().toString(36).substring(7);
        const task = {
            type: 'video',
            id,
            falKey,
            prompt: videoPrompt.trim(),
            image_urls: imageUrls,
            video_urls: videoUrls,
            audio_urls: audioUrls,
            resolution: videoResolution,
            duration: videoDuration,
            aspect_ratio: videoAspectRatio,
            generate_audio: videoGenerateAudio,
            seed: videoSeed,
            end_user_id: videoEndUserId.trim(),
            outputDir,
            prefix,
            createdAt: new Date().toISOString()
        };

        queue = [...queue, task];
        showToast('Added video generation to queue');

        if (!isProcessingQueue) {
            processQueue();
        }
    }

    function validateVideoInputs(imageUrls: string[], videoUrls: string[], audioUrls: string[]) {
        if (!validVideoResolutions.has(videoResolution)) return 'Resolution must be 480p, 720p, or 1080p';
        if (!validVideoDurations.has(videoDuration)) return 'Duration must be auto or 4-15 seconds';
        if (!validVideoAspectRatios.has(videoAspectRatio)) return 'Aspect ratio is not supported by Seedance 2.0';
        if (imageUrls.length > 9) return 'Seedance supports at most 9 reference images';
        if (videoUrls.length > 3) return 'Seedance supports at most 3 reference videos';
        if (audioUrls.length > 3) return 'Seedance supports at most 3 reference audio files';
        if (imageUrls.length + videoUrls.length + audioUrls.length > 12) return 'Seedance supports at most 12 total reference files';
        if (audioUrls.length > 0 && imageUrls.length === 0 && videoUrls.length === 0) return 'Reference audio requires at least one reference image or video';

        for (const url of imageUrls) {
            const message = validateVideoReference(url, validVideoImageTypes, maxVideoImageBytes, 'Reference images');
            if (message) return message;
        }

        let uploadedVideoBytes = 0;
        for (const url of videoUrls) {
            const message = validateVideoReference(url, validVideoVideoTypes, maxVideoVideoBytes, 'Reference videos');
            if (message) return message;
            uploadedVideoBytes += dataUriByteLength(url);
        }
        if (uploadedVideoBytes > maxVideoVideoBytes) return 'Reference video uploads must be 50 MB or smaller in total';

        for (const url of audioUrls) {
            const message = validateVideoReference(url, validVideoAudioTypes, maxVideoAudioBytes, 'Reference audio');
            if (message) return message;
        }

        return '';
    }

    function validateVideoReference(value: string, allowedTypes: Set<string>, maxBytes: number, label: string) {
        if (value.startsWith('data:')) {
            const match = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
            if (!match) return `${label} uploads must be base64 data URIs`;
            const mimeType = match[1].toLowerCase();
            const padding = match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0;
            const bytes = Math.floor((match[2].length * 3) / 4) - padding;
            if (!allowedTypes.has(mimeType)) return `${label} contain an unsupported file type`;
            if (bytes > maxBytes) return `${label} must be ${Math.floor(maxBytes / 1024 / 1024)} MB or smaller`;
            return '';
        }

        try {
            const url = new URL(value);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                return `${label} must be public http(s) URLs or uploaded files`;
            }
        } catch {
            return `${label} contains an invalid URL`;
        }

        return '';
    }

    async function startVideo(task: any) {
        const resultId = task.id;

        results = [{
            id: resultId,
            status: 'INITIALIZING',
            prompt: `Video: ${task.prompt.substring(0, 80)}`,
            outputDir: task.outputDir
        }, ...results];

        try {
            const response = await fetch('/api/video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(task)
            });

            const data = await response.json();
            if (data.error) throw new Error(data.error);

            updateResult(resultId, { status: 'PROCESSING', prompt: task.prompt });
            await pollFalVideoTask(resultId, data.requestId, data.statusUrl, data.responseUrl, task);
        } catch (e: any) {
            updateResult(resultId, { status: 'FAILED', error: e.message });
        }
    }

    async function pollFalVideoTask(resultId: string, requestId: string, statusUrl: string, responseUrl: string, task: any) {
        const startTime = Date.now();
        let loadingNotified = false;

        while (!isCancelled) {
            if (!loadingNotified && (Date.now() - startTime) > 30000) {
                updateResult(resultId, { status: 'LOADING_MODEL' });
                loadingNotified = true;
            }

            try {
                const response = await fetch('/api/video-check', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        requestId,
                        statusUrl,
                        responseUrl,
                        falKey: task.falKey,
                        outputDir: task.outputDir,
                        prefix: task.prefix
                    })
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

    async function sendToVideo(res: any) {
        if (!res.filename || !isImageFilename(res.filename)) {
            showToast('Only image results can be used as video reference');
            return;
        }

        try {
            const response = await fetch(getResultFileUrl(res));
            if (!response.ok) throw new Error('Failed to load image');
            const blob = await response.blob();
            const buffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary);
            const dataUri = `data:${blob.type || 'image/jpeg'};base64,${base64}`;

            const emptyIdx = videoImageUrls.findIndex(u => !u.trim());
            if (emptyIdx >= 0) {
                videoImageUrls = videoImageUrls.map((u, i) => i === emptyIdx ? dataUri : u);
            } else if (videoImageUrls.length < 9) {
                videoImageUrls = [...videoImageUrls, dataUri];
            } else {
                showToast('Maximum 9 reference images reached');
                return;
            }
            activeTab = 'video';
            showToast('Image added as video reference');
        } catch (e) {
            showToast('Failed to send image to video tab');
        }
    }

    function isVideoFilename(filename?: string) {
        if (!filename) return false;
        return filename.split('.').pop()?.toLowerCase() === 'mp4';
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

    function handleEnhanceFileSelect(e: Event) {
        const files = (e.target as HTMLInputElement).files;
        if (files && files[0]) {
            enhanceFile = files[0];
            enhanceImageUrl = '';
        }
    }

    function handleEnhanceDrop(e: DragEvent) {
        e.preventDefault();
        const files = e.dataTransfer?.files;
        if (files && files[0]) {
            enhanceFile = files[0];
            enhanceImageUrl = '';
        }
    }
</script>

<svelte:head>
    <title>AI Image Magick (Bring your own LoRA)</title>
    <meta
        name="description"
        content="AI Image Magick lets you generate and upscale images across RunningHub and RunPod workflows with your own LoRA stack."
    />
</svelte:head>

<svg class="icon-sprite" aria-hidden="true" focusable="false">
    <symbol id="icon-generate" viewBox="0 0 24 24">
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
        <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
    </symbol>
    <symbol id="icon-upscale" viewBox="0 0 24 24">
        <path d="M7 17L17 7" />
        <path d="M10 7h7v7" />
        <path d="M5 11V5h6" />
        <path d="M13 19h6v-6" />
    </symbol>
    <symbol id="icon-enhance" viewBox="0 0 24 24">
        <path d="M4 20L20 4" />
        <path d="M15 4l5 5" />
        <path d="M5 6l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z" />
    </symbol>
    <symbol id="icon-video" viewBox="0 0 24 24">
        <path d="M4 6h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4z" />
        <path d="M17 10l4-2v8l-4-2" />
    </symbol>
    <symbol id="icon-upload" viewBox="0 0 24 24">
        <path d="M12 16V4" />
        <path d="M7 9l5-5 5 5" />
        <path d="M5 16v3h14v-3" />
    </symbol>
    <symbol id="icon-file" viewBox="0 0 24 24">
        <path d="M7 3h7l5 5v13H7z" />
        <path d="M14 3v5h5" />
    </symbol>
    <symbol id="icon-audio" viewBox="0 0 24 24">
        <path d="M9 18V6l10-2v12" />
        <path d="M9 18a3 3 0 1 1-2-2.8" />
        <path d="M19 16a3 3 0 1 1-2-2.8" />
    </symbol>
</svg>

<!-- Modal for Full Screen Image -->
{#if selectedImage}
    <div
        class="modal"
        onclick={() => selectedImage = null}
        onkeydown={(e) => e.key === 'Escape' && (selectedImage = null)}
        role="dialog"
        aria-modal="true"
        aria-label="Image preview"
        tabindex="0"
    >
        <div class="modal-content" onclick={(e) => e.stopPropagation()} role="presentation">
            <img src={selectedImage} alt="Full screen preview" />
            <button class="close-modal" onclick={() => selectedImage = null} aria-label="Close preview">&times;</button>
        </div>
    </div>
{/if}

<main class="container">
    <header class="hero-banner">
        <div class="hero-copy">
            <h1>AI Image Magick</h1>
            <span class="hero-kicker">Bring Your Own LoRA</span>
        </div>
        <div class="hero-mark">
            <img src={rhubHero} alt="RHUB logo" />
        </div>
    </header>

    <div class="card">
        <section class="api-keys">
            <button class="api-keys-toggle" onclick={() => apiKeysOpen = !apiKeysOpen} aria-expanded={apiKeysOpen}>
                <span class="api-keys-title">
                    <span>API Configuration</span>
                    {#if !apiKeysOpen}
                        <span class="api-keys-summary">
                            {[rhubKey && 'RunningHub', geminiKey && 'Gemini', runpodKey && 'RunPod'].filter(Boolean).join(' · ') || 'No keys set'}
                        </span>
                    {/if}
                </span>
                <span class="api-keys-chevron" class:open={apiKeysOpen}>▾</span>
            </button>
            {#if apiKeysOpen}
                <div class="api-keys-body">
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
                </div>
            {/if}
        </section>

        <div class="tabs-container">
            <div class="tabs">
                <button class="tab-btn {activeTab === 'generate' ? 'active' : ''}" onclick={() => activeTab = 'generate'}>
                    <svg class="ui-icon tab-icon" aria-hidden="true"><use href="#icon-generate" /></svg> Generate
                </button>
                <button class="tab-btn {activeTab === 'upscale' ? 'active' : ''}" onclick={() => activeTab = 'upscale'}>
                    <svg class="ui-icon tab-icon" aria-hidden="true"><use href="#icon-upscale" /></svg> Upscale
                </button>
                <button class="tab-btn {activeTab === 'enhance' ? 'active' : ''}" onclick={() => activeTab = 'enhance'}>
                    <svg class="ui-icon tab-icon" aria-hidden="true"><use href="#icon-enhance" /></svg> Enhance
                </button>
                <button class="tab-btn {activeTab === 'video' ? 'active' : ''}" onclick={() => activeTab = 'video'}>
                    <svg class="ui-icon tab-icon" aria-hidden="true"><use href="#icon-video" /></svg> Create Video
                </button>
                <div class="tab-slider tab-slider-4" style="transform: translateX({activeTab === 'generate' ? '0' : activeTab === 'upscale' ? '100%' : activeTab === 'enhance' ? '200%' : '300%'})"></div>
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
                        <optgroup label="RunPod Serverless">
                            <option value="flux-klein">FLUX.2-klein (fast)</option>
                            <option value="z-image">Z-Image (quality)</option>
                        </optgroup>
                        <optgroup label="RunningHub">
                            <option value="rhub-klein">FLUX.2-klein (quality)</option>
                            <option value="flux-dev">FLUX.1-dev</option>
                            <option value="rhub-zimage">ZImage Upscale</option>
                        </optgroup>
                    </select>
                </div>

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
                            {#if model === 'flux-dev'}
                                <label for="fluxDevLoraStrength">LoRA Strength</label>
                                <input type="number" id="fluxDevLoraStrength" bind:value={fluxDevLoraStrength} min="0" max="2" step="0.05" />
                            {:else}
                                <label for="loraScaleLegacy">LoRA Scale</label>
                                <input type="number" id="loraScaleLegacy" bind:value={loraScale} min="0" max="2" step="0.05" />
                            {/if}
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

                {#if model === 'flux-dev'}
                    <div class="field">
                        <label for="fluxDevSeed">Seed</label>
                        <input type="number" id="fluxDevSeed" bind:value={fluxDevSeed} />
                    </div>
                    <div class="field toggle-field">
                        <label for="useTtDecoderGenerate" class="toggle-label">
                            <span class="toggle-text">Enable TT-Decoder</span>
                            <input type="checkbox" id="useTtDecoderGenerate" bind:checked={useTtDecoder} class="toggle-checkbox" />
                            <span class="toggle-slider-ui"></span>
                        </label>
                        <p class="toggle-description">Use TT-encoded workflow — result image will be decoded before saving</p>
                    </div>
                {/if}

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
                            <span class="field-label">Orientation</span>
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
                        <h4>Character LoRA</h4>
                        <div class="field">
                            <label for="rhubKleinWorkflow">Workflow</label>
                            <select id="rhubKleinWorkflow" bind:value={rhubKleinWorkflow}>
                                {#each rhubKleinWorkflows as workflow}
                                    <option value={workflow.id}>{workflow.label}</option>
                                {/each}
                            </select>
                        </div>
                        <div class="field">
                            <label for="rhubKleinLoraUrl">LoRA URL</label>
                            <input
                                type="url"
                                id="rhubKleinLoraUrl"
                                bind:value={loraUrl}
                                placeholder="https://huggingface.co/.../model.safetensors"
                            />
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
                            <span class="field-label">Orientation</span>
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
                                <input type="number" id="zimageSteps" bind:value={zimageSteps} min="10" max="100" />
                                <p class="field-hint">50 is the current Base sweet spot. Use fewer steps only for faster previews.</p>
                            </div>
                            <div class="field">
                                <label for="guidanceScale">Guidance Scale</label>
                                <input type="number" id="guidanceScale" bind:value={guidanceScale} min="1" max="10" step="0.1" />
                            </div>
                            <div class="field">
                                <label for="shift">Scheduler Shift</label>
                                <input type="number" id="shift" bind:value={shift} min="0.5" max="10" step="0.1" />
                                <p class="field-hint">1.0 matches the Z-Image scheduler default and preserves detail refinement. Raise only for specialized LoRAs.</p>
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
                    </div>

                    {#if model === 'flux-klein'}
                        <details class="advanced-panel">
                            <summary>Advanced parameters</summary>
                            <div class="grid" style="margin-top: 8px;">
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
                            </div>
                        </details>
                    {/if}

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
                        <details class="advanced-panel">
                            <summary>Scheduler options</summary>
                            <div class="grid" style="margin-top: 8px;">
                                <div class="field toggle-field">
                                    <label for="zimageCfgNormalization" class="toggle-label">
                                        <span class="toggle-text">CFG Normalization</span>
                                        <input type="checkbox" id="zimageCfgNormalization" bind:checked={zimageCfgNormalization} class="toggle-checkbox" />
                                        <span class="toggle-slider-ui"></span>
                                    </label>
                                    <p class="toggle-description">Enabled by default for the current Z-Image photorealism tuning</p>
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
                        </details>

                        <div class="field" style="margin-top: 12px;">
                            <label for="zimageUpscaleModel">Detail Upscaler</label>
                            <select id="zimageUpscaleModel" bind:value={zimageUpscaleModel}>
                                {#each zimageUpscaleModels as upscaler}
                                    <option value={upscaler.id}>{upscaler.label}</option>
                                {/each}
                            </select>
                            <p class="field-hint">
                                {zimageUpscaleModels.find((upscaler) => upscaler.id === zimageUpscaleModel)?.hint}
                            </p>
                        </div>

                        <div class="field toggle-field" style="margin-top: 12px;">
                            <label for="zimageUpscaleEnabled" class="toggle-label">
                                <span class="toggle-text">Single-Pass Detail Upscale</span>
                                <input type="checkbox" id="zimageUpscaleEnabled" bind:checked={zimageUpscaleEnabled} class="toggle-checkbox" disabled={secondPassEnabled} />
                                <span class="toggle-slider-ui"></span>
                            </label>
                            <p class="toggle-description">
                                Pure super-resolution with no diffusion repaint. Skipped automatically when img2img hires-fix is enabled.
                            </p>
                        </div>

                        {#if zimageUpscaleEnabled && !secondPassEnabled}
                            <div class="grid second-pass-params">
                                <div class="field">
                                    <label for="zimageUpscaleFactor">Detail Upscale Factor</label>
                                    <input type="number" id="zimageUpscaleFactor" bind:value={zimageUpscaleFactor} min="1" max="4" step="0.05" />
                                    <p class="field-hint">1.5 returns 1536x1536 from a 1024x1024 generation.</p>
                                </div>
                            </div>
                        {/if}

                        <!-- Second Pass Options -->
                        <div class="field toggle-field" style="margin-top: 12px;">
                            <label for="secondPassEnabled" class="toggle-label">
                                <span class="toggle-text">Enable img2img Hires-Fix</span>
                                <input type="checkbox" id="secondPassEnabled" bind:checked={secondPassEnabled} class="toggle-checkbox" />
                                <span class="toggle-slider-ui"></span>
                            </label>
                            <p class="toggle-description">Default ON. Upscales with the selected detail model, then lightly re-diffuses to clean super-resolution artifacts. Replaces single-pass detail upscale.</p>
                        </div>

                        {#if secondPassEnabled}
                            <details class="advanced-panel" open>
                            <summary>Refinement parameters</summary>
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
                                    <label for="secondPassSeed">Pass 2 Seed (null = inherit)</label>
                                    <input type="number" id="secondPassSeed"
                                        value={secondPassSeed === null ? '' : secondPassSeed}
                                        placeholder="Inherit from base pass"
                                        oninput={(e) => {
                                            const v = (e.target as HTMLInputElement).value;
                                            secondPassSeed = v === '' ? null : Number(v);
                                        }}
                                        min="0" />
                                    <p class="field-hint">Leave blank to reuse the base pass seed.</p>
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
                            </details>
                        {/if}
                    {/if}
                {/if}
            {:else if activeTab === 'upscale'}
                <div class="settings-header">
                    <h2>Upscale Settings</h2>
                    <span class="settings-badge">{upscaleEngine === 'runninghub-api' ? 'RunningHub API' : '2K Resolution'}</span>
                </div>
                <div class="field">
                    <label for="upscaleEngine">Upscale Engine</label>
                    <select id="upscaleEngine" bind:value={upscaleEngine}>
                        <option value="runninghub-2k">RunningHub — 2K Upscale</option>
                        <option value="runninghub-api">RunningHub — API Upscale</option>
                    </select>
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
                        <svg class="ui-icon drop-icon" aria-hidden="true"><use href="#icon-upload" /></svg>
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
            {:else if activeTab === 'enhance'}
                <div class="settings-header">
                    <h2>Enhance Settings</h2>
                    <span class="settings-badge">{enhanceEngine === 'fal' ? 'fal.ai Phota' : enhanceEngine === 'runninghub' ? 'RunningHub Enhance' : enhanceEngine === 'runninghub-detail' ? 'RunningHub Enhance+Detail' : 'RunningHub HD Detailer'}</span>
                </div>

                <div class="field">
                    <label for="enhanceEngine">Enhance Engine</label>
                    <select id="enhanceEngine" bind:value={enhanceEngine}>
                        <option value="fal">fal.ai Phota — identity-preserving</option>
                        <option value="runninghub">RunningHub — enhance</option>
                        <option value="runninghub-detail">RunningHub — enhance + detail</option>
                        <option value="runninghub-hd-detail">RunningHub — HD Detailer</option>
                    </select>
                </div>

                {#if enhanceEngine === 'fal'}
                <div class="field">
                    <label for="falKey">fal.ai API Key</label>
                    <input type="password" id="falKey" bind:value={falKey} placeholder="Enter fal.ai Key" />
                </div>

                <div class="field">
                    <label for="enhanceOutputFormat">Output Format</label>
                    <select id="enhanceOutputFormat" bind:value={enhanceOutputFormat}>
                        <option value="jpeg">JPEG</option>
                        <option value="png">PNG</option>
                        <option value="webp">WebP</option>
                    </select>
                </div>
                {/if}

                <div class="field">
                    <label for="enhanceImageUrl">{enhanceEngine !== 'fal' ? 'Image URL (public)' : 'Image URL'}</label>
                    <input
                        type="text"
                        id="enhanceImageUrl"
                        bind:value={enhanceImageUrl}
                        placeholder="https://..."
                        oninput={() => { if (enhanceImageUrl.trim()) enhanceFile = null; }}
                    />
                </div>

                <div class="field">
                    <label for="enhanceFileUploadInput">Or Upload Image</label>
                    <div
                        class="drop-zone"
                        onclick={() => enhanceFileInput?.click()}
                        onkeydown={(e) => e.key === 'Enter' && enhanceFileInput?.click()}
                        role="button"
                        tabindex="0"
                        ondragover={(e) => { e.preventDefault(); e.currentTarget.classList.add('dragover'); }}
                        ondragleave={(e) => { e.currentTarget.classList.remove('dragover'); }}
                        ondrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('dragover'); handleEnhanceDrop(e); }}
                    >
                        <svg class="ui-icon drop-icon" aria-hidden="true"><use href="#icon-upload" /></svg>
                        <span class="drop-text">Click to upload or drag & drop</span>
                        <input id="enhanceFileUploadInput" type="file" accept="image/*" bind:this={enhanceFileInput} onchange={handleEnhanceFileSelect} hidden />
                    </div>

                    {#if enhanceFile}
                        <div class="file-list">
                            <div class="file-item">
                                <span class="file-name">{enhanceFile.name}</span>
                                <button class="remove-file" onclick={() => enhanceFile = null}>&times;</button>
                            </div>
                        </div>
                    {/if}
                </div>
            {:else if activeTab === 'video'}
                <div class="settings-header">
                    <h2>Create Video</h2>
                    <span class="settings-badge">Seedance 2.0 — fal.ai</span>
                </div>

                <div class="field">
                    <label for="videoFalKey">fal.ai API Key</label>
                    <input type="password" id="videoFalKey" bind:value={falKey} placeholder="Enter fal.ai Key" />
                </div>

                <div class="field">
                    <label for="videoPrompt">Prompt <span class="required-marker">*</span></label>
                    <textarea
                        id="videoPrompt"
                        bind:value={videoPrompt}
                        rows="3"
                        placeholder="Describe the video. Reference files in the prompt as @Image1, @Video1, @Audio1, etc."
                    ></textarea>
                </div>

                <!-- Reference Images -->
                <div class="multi-lora-section">
                    <div class="multi-lora-header">
                        <span class="multi-lora-label">Reference Images (optional, up to 9)</span>
                        {#if videoImageUrls.length < 9}
                            <button type="button" class="add-lora-btn" onclick={addVideoImageUrl}>+ Add Image</button>
                        {/if}
                    </div>
                    <input type="file" accept="image/jpeg,image/png,image/webp" bind:this={videoFileInput} onchange={handleVideoFileSelect} hidden />
                    {#each videoImageUrls as _imgUrl, i}
                        <div class="video-ref-slot">
                            <label class="video-ref-label" for="videoImg_{i}">
                                Image {i + 1}
                                {#if videoImageUrls[i].startsWith('data:')}
                                    <span class="badge-embedded">uploaded</span>
                                {/if}
                            </label>
                            {#if videoImageUrls[i].startsWith('data:')}
                                <div class="video-ref-embedded">
                                    <img class="embedded-thumb" src={videoImageUrls[i]} alt="Image {i + 1}" />
                                    <div class="video-ref-embedded-actions">
                                        <button type="button" class="add-lora-btn" onclick={() => openVideoFileUpload(i)}><svg class="ui-icon btn-icon" aria-hidden="true"><use href="#icon-upload" /></svg> Replace</button>
                                        <button type="button" class="add-lora-btn" onclick={() => clearVideoImageUrl(i)}>✕ Clear</button>
                                        {#if videoImageUrls.length > 1}
                                            <button type="button" class="add-lora-btn" onclick={() => removeVideoImageUrl(i)}>− Remove slot</button>
                                        {/if}
                                    </div>
                                </div>
                            {:else}
                                <div class="video-ref-row">
                                    <input type="text" id="videoImg_{i}" bind:value={videoImageUrls[i]} placeholder="Paste URL or upload from disk (JPEG, PNG, WebP)" style="flex: 1; min-width: 0;" />
                                    <button type="button" class="upload-btn-inline" title="Upload from disk" aria-label="Upload image from disk" onclick={() => openVideoFileUpload(i)}><svg class="ui-icon btn-icon" aria-hidden="true"><use href="#icon-upload" /></svg></button>
                                    {#if videoImageUrls.length > 1}
                                        <button type="button" class="upload-btn-inline" title="Remove" onclick={() => removeVideoImageUrl(i)}>×</button>
                                    {/if}
                                </div>
                            {/if}
                        </div>
                    {/each}
                </div>

                <!-- Reference Videos -->
                <div class="multi-lora-section">
                    <div class="multi-lora-header">
                        <span class="multi-lora-label">Reference Videos (optional, up to 3)</span>
                        {#if videoVideoUrls.length < 3}
                            <button type="button" class="add-lora-btn" onclick={addVideoVideoUrl}>+ Add Video</button>
                        {/if}
                    </div>
                    <p class="toggle-description" style="margin: 0 0 10px">MP4 or MOV clips to guide motion and timing. Combined duration should be 2-15 seconds and uploads must stay under 50 MB total.</p>
                    <input type="file" accept="video/mp4,video/quicktime,.mov" bind:this={videoVideoFileInput} onchange={handleVideoVideoFileSelect} hidden />
                    {#each videoVideoUrls as _vidUrl, i}
                        <div class="video-ref-slot">
                            <label class="video-ref-label" for="videoRef_{i}">
                                Video {i + 1}
                                {#if videoVideoUrls[i].startsWith('data:')}
                                    <span class="badge-embedded">uploaded</span>
                                {/if}
                            </label>
                            {#if videoVideoUrls[i].startsWith('data:')}
                                <div class="video-ref-embedded">
                                    <video class="embedded-video-thumb" src={videoVideoUrls[i]} muted playsinline></video>
                                    <div class="video-ref-embedded-actions">
                                        <button type="button" class="add-lora-btn" onclick={() => openVideoVideoUpload(i)}><svg class="ui-icon btn-icon" aria-hidden="true"><use href="#icon-upload" /></svg> Replace</button>
                                        <button type="button" class="add-lora-btn" onclick={() => clearVideoVideoUrl(i)}>✕ Clear</button>
                                        {#if videoVideoUrls.length > 1}
                                            <button type="button" class="add-lora-btn" onclick={() => removeVideoVideoUrl(i)}>− Remove slot</button>
                                        {/if}
                                    </div>
                                </div>
                            {:else}
                                <div class="video-ref-row">
                                    <input type="text" id="videoRef_{i}" bind:value={videoVideoUrls[i]} placeholder="Paste URL or upload from disk (MP4, MOV)" style="flex: 1; min-width: 0;" />
                                    <button type="button" class="upload-btn-inline" title="Upload from disk" aria-label="Upload video from disk" onclick={() => openVideoVideoUpload(i)}><svg class="ui-icon btn-icon" aria-hidden="true"><use href="#icon-upload" /></svg></button>
                                    {#if videoVideoUrls.length > 1}
                                        <button type="button" class="upload-btn-inline" title="Remove" onclick={() => removeVideoVideoUrl(i)}>×</button>
                                    {/if}
                                </div>
                            {/if}
                        </div>
                    {/each}
                </div>

                <div class="grid">
                    <div class="field">
                        <label for="videoResolution">Resolution</label>
                        <select id="videoResolution" bind:value={videoResolution}>
                            <option value="480p">480p — Faster</option>
                            <option value="720p">720p — Balanced</option>
                            <option value="1080p">1080p — Highest quality</option>
                        </select>
                    </div>
                    <div class="field">
                        <label for="videoDuration">Duration</label>
                        <select id="videoDuration" bind:value={videoDuration}>
                            <option value="auto">Auto (model decides)</option>
                            {#each Array.from({length: 12}, (_, i) => i + 4) as sec}
                                <option value={String(sec)}>{sec}s</option>
                            {/each}
                        </select>
                    </div>
                    <div class="field">
                        <label for="videoAspectRatio">Aspect Ratio</label>
                        <select id="videoAspectRatio" bind:value={videoAspectRatio}>
                            <option value="auto">Auto</option>
                            <option value="21:9">21:9 — Ultrawide</option>
                            <option value="16:9">16:9 — Landscape</option>
                            <option value="4:3">4:3</option>
                            <option value="1:1">1:1 — Square</option>
                            <option value="3:4">3:4</option>
                            <option value="9:16">9:16 — Portrait</option>
                        </select>
                    </div>
                    <div class="field">
                        <label for="videoSeed">Seed (-1 = random)</label>
                        <input type="number" id="videoSeed" bind:value={videoSeed} min="-1" step="1" />
                    </div>
                    <div class="field">
                        <label for="videoEndUserId">End User ID</label>
                        <input type="text" id="videoEndUserId" bind:value={videoEndUserId} placeholder="Optional fal.ai end user identifier" />
                    </div>
                </div>

                <!-- Generate Audio toggle -->
                <div class="field toggle-field">
                    <label for="videoGenerateAudio" class="toggle-label">
                        <span class="toggle-text">Generate Audio</span>
                        <input type="checkbox" id="videoGenerateAudio" bind:checked={videoGenerateAudio} class="toggle-checkbox" />
                        <span class="toggle-slider-ui"></span>
                    </label>
                    <p class="toggle-description">Synchronized sound effects, ambient audio &amp; lip-sync in output</p>
                </div>

                <!-- Reference Audio (visible when generate_audio is on) -->
                {#if videoGenerateAudio}
                <div class="multi-lora-section">
                    <div class="multi-lora-header">
                        <span class="multi-lora-label">Reference Audio (optional, up to 3)</span>
                        {#if videoAudioUrls.length < 3}
                            <button type="button" class="add-lora-btn" onclick={addVideoAudioUrl}>+ Add Audio</button>
                        {/if}
                    </div>
                    <p class="toggle-description" style="margin: 0 0 10px">MP3 or WAV files to guide audio style. Refer in prompt as @Audio1, @Audio2, etc.</p>
                    <input type="file" accept="audio/mpeg,audio/wav" bind:this={videoAudioFileInput} onchange={handleVideoAudioFileSelect} hidden />
                    {#each videoAudioUrls as _aUrl, i}
                        <div class="video-ref-slot">
                            <label class="video-ref-label" for="videoAudio_{i}">
                                Audio {i + 1}
                                {#if videoAudioUrls[i].startsWith('data:')}
                                    <span class="badge-embedded">uploaded</span>
                                {/if}
                            </label>
                            {#if videoAudioUrls[i].startsWith('data:')}
                                <div class="video-ref-embedded">
                                    <svg class="ui-icon embedded-audio-icon" aria-hidden="true"><use href="#icon-audio" /></svg>
                                    <div class="video-ref-embedded-actions">
                                        <button type="button" class="add-lora-btn" onclick={() => openVideoAudioUpload(i)}><svg class="ui-icon btn-icon" aria-hidden="true"><use href="#icon-upload" /></svg> Replace</button>
                                        <button type="button" class="add-lora-btn" onclick={() => clearVideoAudioUrl(i)}>✕ Clear</button>
                                        {#if videoAudioUrls.length > 1}
                                            <button type="button" class="add-lora-btn" onclick={() => removeVideoAudioUrl(i)}>− Remove slot</button>
                                        {/if}
                                    </div>
                                </div>
                            {:else}
                                <div class="video-ref-row">
                                    <input type="text" id="videoAudio_{i}" bind:value={videoAudioUrls[i]} placeholder="Paste URL or upload from disk (MP3, WAV)" style="flex: 1; min-width: 0;" />
                                    <button type="button" class="upload-btn-inline" title="Upload from disk" aria-label="Upload audio from disk" onclick={() => openVideoAudioUpload(i)}><svg class="ui-icon btn-icon" aria-hidden="true"><use href="#icon-upload" /></svg></button>
                                    {#if videoAudioUrls.length > 1}
                                        <button type="button" class="upload-btn-inline" title="Remove" onclick={() => removeVideoAudioUrl(i)}>×</button>
                                    {/if}
                                </div>
                            {/if}
                        </div>
                    {/each}
                </div>
                {/if}
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
                {activeTab === 'enhance' ? 'Add Enhance to Queue' : activeTab === 'upscale' ? 'Add Upscale to Queue' : activeTab === 'video' ? 'Add Video to Queue' : (model === 'flux-dev' ? 'Add Generation to Queue' : model === 'rhub-zimage' ? 'Add ZImage Upscale to Queue' : model === 'rhub-klein' ? 'Add FLUX.2-klein to Queue' : `Add ${model === 'flux-klein' ? 'FLUX.2-klein' : 'Z-Image'} to Queue`)}
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
                                {#if task.type === 'enhance'}Enhance{:else if task.type === 'video'}Video{:else if task.type === 'upscale'}{task.upscaleEngine === 'runninghub-api' ? 'Upscale (API)' : 'Upscale 2K'}{:else if task.model === 'flux-klein'}Klein · {task.kleinAspectRatio ?? task.aspectRatio}{:else if task.model === 'z-image'}Z-Image · {task.aspectRatio}{:else if task.model === 'rhub-zimage'}ZImage · {task.rhub_zimage_width}×{task.rhub_zimage_height}{:else if task.model === 'rhub-klein'}Klein (RH {task.rhub_klein_workflow === 'upscale' ? 'Upscale' : 'Standard'}) · {task.rhub_klein_aspect_ratio} {task.rhub_klein_orientation === 'landscape' ? 'Landscape' : 'Portrait'}{:else}FLUX.1-dev · {task.aspectRatio}{/if}
                            </span>
                            <span class="queue-prompt">
                                {#if task.type === 'enhance'}
                                    {task.fileName || task.imageUrl || 'Image'}
                                {:else if task.type === 'video'}
                                    {task.prompt}
                                {:else if task.type === 'upscale'}
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

    {#if results.length === 0 && !loading}
        <section class="results results-empty">
            <p class="empty-state-text">Generated images will appear here</p>
        </section>
    {/if}

    {#if results.length > 0}
        <section class="results">
            <h2>Live Results {#if loading}<span class="loader-dots">...</span>{/if}</h2>
            <div class="results-list">
                {#each results as res (res.id)}
                    {@const hasFile = Boolean(res.filename)}
                    {@const isImageResult = hasFile && isImageFilename(res.filename)}
                    {@const isVideoResult = hasFile && isVideoFilename(res.filename)}
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
                                    {:else if fileExt === 'mp4'}
                                        <!-- svelte-ignore a11y_media_has_caption -->
                                        <video class="video-preview" src={fileUrl} controls></video>
                                    {:else}
                                        <a class="file-download" href={fileUrl} download={res.filename}>
                                            <svg class="ui-icon file-icon" aria-hidden="true"><use href="#icon-file" /></svg>
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
                                    {#if isImageResult}
                                        <button class="result-action-btn" onclick={() => openFullScreen(fileUrl)}>Full Screen</button>
                                    {/if}
                                    {#if hasFile}
                                        <a class="result-action-btn" href={fileUrl} download={res.filename}>{isVideoResult ? 'Save Video' : 'Save Image'}</a>
                                    {/if}
                                    {#if res.prompt}
                                        <button class="result-action-btn" onclick={() => copyPrompt(res.prompt || '')}>Copy Prompt</button>
                                    {/if}
                                    {#if isImageResult}
                                        <button class="result-action-btn" onclick={() => sendToUpscale(res)}>Send to Upscale</button>
                                        <button class="result-action-btn" onclick={() => sendToEnhance(res)}>Send to Enhance</button>
                                        <button class="result-action-btn" onclick={() => sendToVideo(res)}>Send to Video</button>
                                    {/if}
                                    <button class="result-action-btn danger" onclick={() => deleteResult(res)}>Delete</button>
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
    :global(:root) {
        --color-bg: #f7faff;
        --color-bg-accent: #ecf4ff;
        --color-surface: #fbfdff;
        --color-surface-container: #f3f7fc;
        --color-surface-raised: #fbfdff;
        --color-on-primary: #fbfdff;
        --color-outline: #d8e1ec;
        --color-outline-strong: #b8c5d6;
        --color-text: #172033;
        --color-text-muted: #5c6b80;
        --color-text-subtle: #7d8ca0;
        --color-primary: #2563eb;
        --color-primary-hover: #1d4ed8;
        --color-primary-soft: #e9f1ff;
        --color-primary-outline: #b8d2ff;
        --color-danger: #dc2626;
        --color-danger-soft: #fee8e8;
        --color-success: #15803d;
        --color-success-soft: #dcfce7;
        --color-warning: #92400e;
        --color-warning-soft: #fef3c7;
        --radius-xs: 6px;
        --radius-sm: 8px;
        --radius-md: 12px;
        --radius-lg: 16px;
        --elevation-1: 0 1px 2px rgba(15, 23, 42, 0.08), 0 1px 3px rgba(15, 23, 42, 0.06);
        --elevation-2: 0 10px 28px rgba(15, 23, 42, 0.09);
        --elevation-3: 0 18px 48px rgba(15, 23, 42, 0.12);
        --focus-ring: 0 0 0 3px rgba(37, 99, 235, 0.18);
        --state-layer: rgba(37, 99, 235, 0.08);
        --transition-fast: 150ms cubic-bezier(0.22, 1, 0.36, 1);
        --transition-base: 220ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    :global(*) {
        box-sizing: border-box;
    }
    :global(body) {
        font-family: 'Inter', system-ui, sans-serif;
        background:
            radial-gradient(circle at top left, rgba(96, 165, 250, 0.18), transparent 28%),
            radial-gradient(circle at top right, rgba(15, 118, 110, 0.14), transparent 24%),
            linear-gradient(180deg, var(--color-bg-accent) 0%, var(--color-bg) 32%, var(--color-bg) 100%);
        color: var(--color-text);
        margin: 0;
        -webkit-tap-highlight-color: transparent;
        overflow-x: hidden;
    }
    .icon-sprite {
        position: absolute;
        width: 0;
        height: 0;
        overflow: hidden;
    }
    .ui-icon {
        width: 1em;
        height: 1em;
        display: inline-block;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
        flex-shrink: 0;
    }
    .btn-icon {
        font-size: 1rem;
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
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 20px;
        padding: 14px 20px;
        border-radius: 16px;
        overflow: hidden;
        background:
            radial-gradient(circle at 15% 50%, rgba(96, 165, 250, 0.2), transparent 40%),
            linear-gradient(135deg, rgba(11, 18, 32, 0.9) 0%, #0f172a 100%);
        border: 1px solid rgba(148, 163, 184, 0.2);
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
    }
    .hero-copy {
        display: flex;
        align-items: baseline;
        gap: 12px;
        flex-wrap: wrap;
    }
    .hero-kicker {
        padding: 3px 10px;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.14);
        border: 1px solid rgba(191, 219, 254, 0.28);
        color: #93c5fd;
        font-size: 0.7rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        white-space: nowrap;
    }
    .hero-banner h1 {
        margin: 0;
        color: #f8fafc;
        font-size: 1.35rem;
        font-weight: 700;
        line-height: 1.2;
        white-space: nowrap;
    }
    .hero-mark {
        flex-shrink: 0;
        display: flex;
        align-items: center;
    }
    .hero-mark img {
        display: block;
        width: 48px;
        height: 48px;
        object-fit: contain;
        filter: drop-shadow(0 4px 8px rgba(15, 23, 42, 0.4));
        opacity: 0.9;
    }

    .card, .results {
        background: var(--color-surface-raised);
        padding: 20px;
        border-radius: var(--radius-lg);
        box-shadow: var(--elevation-2);
        margin-bottom: 24px;
        border: 1px solid var(--color-outline);
        width: 100%;
    }

    @media (min-width: 768px) {
        .card, .results { padding: 32px; }
    }

    /* Collapsible API keys */
    .api-keys-toggle {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
        text-align: left;
        margin-bottom: 0;
        min-height: auto;
    }
    .api-keys-title {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 1.125rem;
        font-weight: 700;
        color: var(--color-text);
    }
    .api-keys-summary {
        font-size: 0.78rem;
        font-weight: 500;
        color: var(--color-text-muted);
    }
    .api-keys-chevron {
        font-size: 1.1rem;
        color: var(--color-text-subtle);
        transition: transform var(--transition-base);
        flex-shrink: 0;
    }
    .api-keys-chevron.open { transform: rotate(180deg); }
    .api-keys-body { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--color-outline); }
    .api-keys { margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid var(--color-outline); }

    /* Empty results state */
    .results-empty {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 80px;
        background: var(--color-surface-container);
        border-style: dashed;
    }
    .empty-state-text {
        margin: 0;
        font-size: 0.875rem;
        color: var(--color-text-subtle);
    }

    /* Advanced panel (progressive disclosure) */
    .advanced-panel {
        margin-top: 12px;
        border: 1px solid var(--color-outline);
        border-radius: var(--radius-sm);
        padding: 0;
        overflow: hidden;
    }
    .advanced-panel > summary {
        cursor: pointer;
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--color-text-muted);
        padding: 8px 12px;
        list-style: none;
        user-select: none;
        background: var(--color-surface-container);
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .advanced-panel > summary::before {
        content: '▸';
        font-size: 0.65rem;
        transition: transform 0.15s ease;
    }
    .advanced-panel[open] > summary::before { transform: rotate(90deg); }
    .advanced-panel > summary::-webkit-details-marker { display: none; }
    .advanced-panel > *:not(summary) { padding: 12px; }

    h2 { font-size: 1.125rem; font-weight: 700; color: var(--color-text); margin: 0 0 16px 0; padding-bottom: 10px; border-bottom: 1px solid var(--color-outline); }
    
    .settings-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--color-outline);
    }
    .settings-header h2 { margin: 0; border: none; padding: 0; }
    .settings-badge {
        font-size: 0.7rem;
        background: var(--color-primary-soft);
        color: var(--color-primary);
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
    label,
    .field-label { font-size: 0.75rem; font-weight: 600; color: var(--color-text-muted); margin-bottom: 4px; }

    /* Modern Tabs Styles */
    .tabs-container {
        margin-bottom: 32px;
    }
    .tabs {
        display: flex;
        background: var(--color-surface-container);
        padding: 4px;
        border-radius: var(--radius-md);
        position: relative;
        border: 1px solid var(--color-outline);
        box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.05);
    }
    .tab-btn {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 40px;
        padding: 8px 16px;
        border-radius: var(--radius-sm);
        border: none;
        background: transparent;
        color: var(--color-text-muted);
        font-weight: 600;
        font-size: 0.9rem;
        cursor: pointer;
        transition: color var(--transition-fast), background var(--transition-fast);
        z-index: 2;
    }
    .tab-btn.active {
        color: var(--color-primary);
    }
    .tab-btn:not(.active):hover {
        color: var(--color-text);
        background: rgba(37, 99, 235, 0.05);
    }
    .tab-slider {
        position: absolute;
        top: 4px;
        left: 4px;
        width: calc(50% - 4px);
        height: calc(100% - 8px);
        background: var(--color-surface-raised);
        border-radius: var(--radius-sm);
        box-shadow: var(--elevation-1);
        transition: transform var(--transition-base);
        z-index: 1;
    }
    .tab-slider-3 {
        width: calc(33.333% - 2.667px);
    }
    .tab-slider-4 {
        width: calc(25% - 3px);
    }
    .tab-icon { font-size: 1rem; }

    @media (max-width: 520px) {
        .tab-btn { padding: 10px 4px; font-size: 0; gap: 0; }
        .tab-icon { display: inline; font-size: 1.25rem; }
    }

    /* Drop Zone Styles */
    .drop-zone {
        border: 2px dashed var(--color-outline-strong);
        border-radius: var(--radius-md);
        padding: 40px 20px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: var(--color-surface-container);
        cursor: pointer;
        transition: border-color var(--transition-fast), background var(--transition-fast), box-shadow var(--transition-fast);
        text-align: center;
    }
    .drop-zone:hover, .drop-zone.dragover {
        border-color: var(--color-primary);
        background: var(--color-primary-soft);
        box-shadow: var(--focus-ring);
    }
    .drop-icon { font-size: 2.5rem; margin-bottom: 12px; color: var(--color-primary); }
    .drop-text { font-size: 0.95rem; color: var(--color-text-muted); font-weight: 500; }

    /* Video tab — reference slot layout */
    .video-ref-slot {
        margin-bottom: 10px;
    }
    .video-ref-label {
        display: block;
        font-size: 0.8rem;
        font-weight: 600;
        color: var(--color-text-muted);
        margin-bottom: 4px;
    }
    .video-ref-row {
        display: flex;
        gap: 6px;
        align-items: center;
    }
    .video-ref-embedded {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 10px;
        background: var(--color-surface-container);
        border: 1px solid var(--color-outline);
        border-radius: var(--radius-sm);
    }
    .video-ref-embedded-actions {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
    }
    .embedded-audio-icon {
        font-size: 1.5rem;
        color: var(--color-primary);
        flex-shrink: 0;
    }
    .upload-btn-inline {
        width: auto;
        min-height: unset;
        flex-shrink: 0;
        background: var(--color-surface-container);
        border: 1px solid var(--color-outline);
        border-radius: var(--radius-xs);
        padding: 6px 10px;
        font-weight: normal;
        cursor: pointer;
        font-size: 1rem;
        line-height: 1;
        transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
    }
    .upload-btn-inline:hover {
        background: var(--color-primary-soft);
        border-color: var(--color-primary-outline);
        color: var(--color-primary);
    }

    /* Video tab */
    .video-preview {
        width: 100%;
        border-radius: 8px;
        max-height: 360px;
        background: #06080d;
        display: block;
    }
    .embedded-image-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 0;
    }
    .embedded-thumb {
        width: 64px;
        height: 64px;
        object-fit: cover;
        border-radius: 6px;
        border: 1px solid var(--color-outline);
        flex-shrink: 0;
    }
    .embedded-video-thumb {
        width: 96px;
        height: 54px;
        object-fit: cover;
        border-radius: 6px;
        border: 1px solid var(--color-outline);
        background: #0f172a;
        flex-shrink: 0;
    }
    .badge-embedded {
        display: inline-block;
        background: var(--color-primary-soft);
        color: var(--color-primary-hover);
        font-size: 0.65rem;
        font-weight: 600;
        padding: 1px 6px;
        border-radius: 4px;
        margin-left: 6px;
        vertical-align: middle;
    }
    .field-hint {
        font-size: 0.78rem;
        color: var(--color-text-muted);
    }

    .file-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 16px;
    }
    .file-item {
        background: var(--color-surface-container);
        padding: 6px 12px;
        border-radius: var(--radius-sm);
        font-size: 0.85rem;
        display: flex;
        align-items: center;
        gap: 10px;
        max-width: 240px;
        border: 1px solid var(--color-outline);
    }
    .file-name {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-weight: 500;
    }
    .remove-file {
        background: var(--color-surface-container);
        border: none;
        color: var(--color-text-muted);
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
    .remove-file:hover { background: var(--color-danger-soft); color: var(--color-danger); }

    /* Toggle Switch Styles */
    .toggle-field { margin-bottom: 16px; }
    .toggle-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
        padding: 12px;
        background: var(--color-surface-container);
        border-radius: var(--radius-sm);
        border: 1px solid var(--color-outline);
    }
    .toggle-text { font-weight: 600; color: var(--color-text); }
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
        background: var(--color-outline-strong);
        border-radius: 99px;
        transition: background var(--transition-fast);
        flex-shrink: 0;
    }
    .toggle-slider-ui::before {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 20px;
        height: 20px;
        background: var(--color-surface-raised);
        border-radius: 50%;
        transition: transform var(--transition-fast);
        box-shadow: 0 1px 2px rgba(0,0,0,0.1);
    }
    .toggle-checkbox:checked + .toggle-slider-ui { background: var(--color-primary); }
    .toggle-checkbox:checked + .toggle-slider-ui::before { transform: translateX(20px); }
    .toggle-description { font-size: 0.75rem; color: var(--color-text-muted); margin-top: 4px; margin-bottom: 12px; }
    
    input, select, textarea {
        width: 100%;
        padding: 12px;
        border: 1px solid var(--color-outline-strong);
        border-radius: var(--radius-sm);
        font-size: 1rem;
        appearance: none;
        background-color: var(--color-surface-raised);
        color: var(--color-text);
        transition: border-color var(--transition-fast), box-shadow var(--transition-fast), background var(--transition-fast);
    }
    input:hover, select:hover, textarea:hover {
        border-color: var(--color-primary-outline);
    }
    input:focus, select:focus, textarea:focus {
        border-color: var(--color-primary);
        outline: none;
        box-shadow: var(--focus-ring);
    }

    select {
        background-color: var(--color-surface-container);
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 12px center;
        padding-right: 40px;
        cursor: pointer;
    }

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
        background: var(--color-surface-container);
        color: var(--color-text-muted);
        border: 1px solid var(--color-outline);
        font-size: 0.875rem;
        font-weight: 500;
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
        width: auto;
        padding: 8px 12px;
    }
    .orient-btn.active {
        background: var(--color-primary);
        color: var(--color-on-primary);
        border-color: var(--color-primary);
    }
    .orient-btn:hover:not(.active) { background: var(--color-primary-soft); border-color: var(--color-primary-outline); color: var(--color-primary); }
    .orient-square {
        font-size: 0.875rem;
        color: var(--color-text-muted);
        font-style: italic;
    }
    .dim-preview {
        font-size: 0.8rem;
        font-weight: 700;
        color: var(--color-primary);
        background: var(--color-primary-soft);
        border: 1px solid var(--color-primary-outline);
        padding: 4px 10px;
        border-radius: var(--radius-xs);
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
        background: var(--color-primary);
        color: var(--color-on-primary);
        box-shadow: var(--elevation-1);
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
        border-radius: var(--radius-sm); 
        font-weight: 600; 
        cursor: pointer; 
        transition: transform var(--transition-fast), opacity var(--transition-fast), background var(--transition-fast), box-shadow var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast); 
        font-size: 1rem;
    }
    button:active { transform: scale(0.98); }
    button:hover { opacity: 0.9; }
    button:focus-visible,
    a:focus-visible,
    .drop-zone:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
    }
    button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
        transform: none;
    }
    .required-marker { color: var(--color-danger); }
    .btn-primary { background: var(--color-primary); color: var(--color-on-primary); }
    .btn-primary:hover, .main-action:hover { background: var(--color-primary-hover); opacity: 1; }
    .btn-secondary { background: var(--color-surface-container); color: var(--color-text-muted); border: 1px solid var(--color-outline); }
    .btn-danger { background: var(--color-danger); color: var(--color-on-primary); }

    .status-badge { font-size: 0.65rem; padding: 4px 8px; border-radius: 99px; font-weight: 700; text-transform: uppercase; margin-right: 8px; }
    .initializing { background: var(--color-warning-soft); color: var(--color-warning); }
    .processing { background: var(--color-primary-soft); color: #1e40af; }
    .loading_model { background: #ede9fe; color: #5b21b6; }
    .success { background: var(--color-success-soft); color: var(--color-success); }
    .failed, .cancelled { background: var(--color-danger-soft); color: #991b1b; }

    .result-item { padding: 16px 0; border-bottom: 1px solid var(--color-outline); width: 100%; }
    .result-header { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
    .filename { font-size: 0.8rem; color: var(--color-text-muted); word-break: break-all; }

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
    .img-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(6, 8, 13, 0.48); color: var(--color-on-primary); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity var(--transition-fast); font-size: 0.8rem; }

    /* File Download Card Styles */
    .file-download { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; background: var(--color-surface-container); border: 2px dashed var(--color-outline-strong); border-radius: var(--radius-sm); text-decoration: none; color: inherit; width: 100%; min-height: 150px; }
    .file-icon { font-size: 2.5rem; margin-bottom: 8px; color: var(--color-primary); }
    .file-info { display: flex; flex-direction: column; align-items: center; gap: 4px; margin-bottom: 12px; text-align: center; }
    .file-name { font-size: 0.75rem; font-weight: 600; color: var(--color-text); word-break: break-all; }
    .file-type { font-size: 0.65rem; padding: 2px 8px; background: var(--color-surface-container); border-radius: 99px; font-weight: 600; color: var(--color-text-muted); }
    .download-btn { padding: 8px 16px; background: var(--color-primary); color: var(--color-on-primary); border: none; border-radius: var(--radius-xs); font-size: 0.75rem; font-weight: 600; cursor: pointer; }
    .download-btn:hover { background: var(--color-primary-hover); }
    
    @media (hover: hover) {
        .img-container:hover .img-overlay { opacity: 1; }
    }

    .loading-placeholder, .error-placeholder { width: 100%; aspect-ratio: 1; background: var(--color-surface-container); display: flex; align-items: center; justify-content: center; border-radius: var(--radius-sm); font-size: 0.8rem; color: var(--color-text-subtle); border: 2px dashed var(--color-outline); }
    .prompt-display { display: flex; flex-direction: column; width: 100%; }
    .prompt-label { font-size: 0.75rem; font-weight: 600; color: var(--color-text-muted); margin-bottom: 4px; }
    .prompt-display textarea { width: 100%; height: 100px; background: var(--color-surface-container); border: 1px solid var(--color-outline); font-size: 0.85rem; }
    .error-text { color: var(--color-danger); font-size: 0.8rem; margin-top: 8px; }
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
        border-radius: var(--radius-sm);
        border: 1px solid var(--color-outline);
        background: var(--color-surface-raised);
        color: var(--color-text);
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
        background: var(--color-danger-soft);
        border-color: #fecaca;
        color: #b91c1c;
    }

    /* Queue Styles */
    .queue-section { background: var(--color-primary-soft); border-color: var(--color-primary-outline); }
    .queue-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
    .queue-item { 
        display: flex; 
        align-items: center; 
        justify-content: space-between; 
        padding: 10px 14px; 
        background: var(--color-surface-raised); 
        border: 1px solid var(--color-outline); 
        border-radius: var(--radius-sm); 
        gap: 12px;
    }
    .queue-info { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
    .queue-tag { 
        font-size: 0.65rem; 
        font-weight: 700; 
        background: var(--color-surface-container); 
        color: var(--color-text-muted); 
        padding: 2px 6px; 
        border-radius: 4px; 
        white-space: nowrap;
    }
    .queue-prompt { 
        font-size: 0.85rem; 
        color: var(--color-text); 
        white-space: nowrap; 
        overflow: hidden; 
        text-overflow: ellipsis; 
        flex: 1;
    }
    .queue-remove { 
        background: var(--color-danger-soft); 
        color: var(--color-danger); 
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
    .modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(6, 8, 13, 0.95); z-index: 1000; display: flex; align-items: center; justify-content: center; }
    .modal-content { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
    .modal-content img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .close-modal { position: absolute; top: 20px; right: 20px; background: rgba(251, 253, 255, 0.2); border: none; color: var(--color-on-primary); font-size: 1.5rem; cursor: pointer; padding: 10px; line-height: 1; border-radius: 50%; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; }

    /* Toast Notification Styles */
    .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: var(--color-text); color: var(--color-on-primary); padding: 12px 20px; border-radius: var(--radius-sm); box-shadow: var(--elevation-2); z-index: 9999; animation: slideUp var(--transition-base); max-width: 400px; text-align: center; }
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
        color: var(--color-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    .add-lora-btn {
        width: auto;
        min-height: 34px;
        padding: 6px 14px;
        font-size: 0.8rem;
        background: var(--color-primary-soft);
        color: var(--color-primary);
        border: 1px solid var(--color-primary-outline);
        border-radius: var(--radius-xs);
        font-weight: 600;
    }
    .add-lora-btn:hover { background: #dbeafe; opacity: 1; }
    .lora-entry {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        padding: 12px;
        background: var(--color-surface-container);
        border: 1px solid var(--color-outline);
        border-radius: var(--radius-sm);
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
        background: var(--color-danger-soft);
        color: var(--color-danger);
        border-radius: var(--radius-xs);
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
        color: var(--color-text-muted);
    }
    .field-hint {
        margin-top: 6px;
        font-size: 0.78rem;
        color: var(--color-text-muted);
        line-height: 1.35;
    }

    @media (max-width: 600px) {
        .lora-entry-fields { grid-template-columns: 1fr; }
        .lora-scale-inline input { max-width: 100%; }
    }
</style>
