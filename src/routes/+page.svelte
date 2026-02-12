<script lang="ts">
    import { onMount } from 'svelte';

    let loraUrl = $state('');
    let subject = $state('');
    let customPrompt = $state('');
    let useCustomPrompt = $state(false);
    let numPrompts = $state(1);
    let outputDir = $state('generations');
    let prefix = $state('image');
    let aspectRatio = $state('1:1');
    let geminiKey = $state('');
    let rhubKey = $state('');
    let runpodKey = $state('');
    let promptProvider = $state('gemini');
    // Load persisted TT-Decoder setting from localStorage
    const savedTtDecoder = typeof localStorage !== 'undefined' && localStorage.getItem('useTtDecoder') === 'true';
    let useTtDecoder = $state(savedTtDecoder);  // TT-Decoder toggle
    let loading = $state(false);
    let queue = $state<any[]>([]);
    let isProcessingQueue = $state(false);

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
        console.log('iMontage Interface Mounted');
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

    async function handleSubmit() {
        // Legacy multi-submit: just adds them to the queue and starts processing
        addToQueue();
    }

    async function addToQueue() {
        const baseTask = {
            loraUrl,
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

    async function processQueue() {
        if (isProcessingQueue || queue.length === 0) return;
        
        isProcessingQueue = true;
        loading = true;
        isCancelled = false;

        while (queue.length > 0 && !isCancelled) {
            const task = queue[0];
            await startGeneration(task);
            // Move from queue to results is handled by startGeneration adding to results
            // We just remove it from the queue here
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
            outputDir: payload.outputDir // Store for rendering
        }, ...results];

        try {
            const response = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            const data = await response.json();
            if (data.error) throw new Error(data.error);

            const taskId = data.taskId;
            updateResult(resultId, { status: 'PROCESSING', prompt: data.prompt, taskId });

            await pollTask(resultId, taskId, payload);

        } catch (e: any) {
            updateResult(resultId, { status: 'FAILED', error: e.message });
        }
    }

    async function pollTask(resultId: string, taskId: string, payload: any) {
        const { rhubKey, outputDir, prefix, useTtDecoder } = payload;
        
        while (!isCancelled) {
            try {
                const response = await fetch('/api/check', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ taskId, rhubKey, outputDir, prefix, useTtDecoder })
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

    function openFullScreen(url: string) {
        selectedImage = url;
    }
</script>

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
    <header>
        <h1>iMontage RunningHub</h1>
        <p>Expert FLUX.1‑dev Prompt Engineering</p>
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

        <section class="lora-settings">
            <h2>Generation Settings</h2>

            <!-- TT-Decoder Toggle -->
            <div class="field toggle-field">
                <label for="useTtDecoder" class="toggle-label">
                    <span class="toggle-text">Enable TT-Decoder</span>
                    <input type="checkbox" id="useTtDecoder" bind:checked={useTtDecoder} class="toggle-checkbox" />
                    <span class="toggle-slider"></span>
                </label>
                <p class="toggle-description">Decode hidden files from returned images (LSB steganography)</p>
            </div>
            <div class="field">
                <label for="loraUrl">LoRA URL</label>
                <input type="text" id="loraUrl" bind:value={loraUrl} placeholder="https://..." />
            </div>
            
            <!-- Custom Prompt Toggle -->
            <div class="field toggle-field">
                <label for="useCustomPrompt" class="toggle-label">
                    <span class="toggle-text">Use Custom Prompt</span>
                    <input type="checkbox" id="useCustomPrompt" bind:checked={useCustomPrompt} class="toggle-checkbox" />
                    <span class="toggle-slider"></span>
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
                <div class="field">
                    <label for="aspectRatio">Aspect Ratio</label>
                    <select id="aspectRatio" bind:value={aspectRatio}>
                        {#each aspectRatios as ar}
                            <option value={ar}>{ar}</option>
                        {/each}
                    </select>
                </div>
            </div>

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
            <button class="btn-primary" onclick={addToQueue}>Add to Queue</button>
            {#if loading}
                <button class="btn-danger" onclick={handleCancel}>Cancel Active</button>
            {/if}
            {#if queue.length > 0 || results.length > 0}
                <button class="btn-secondary" onclick={clearQueue}>Clear All</button>
            {/if}
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
                            <span class="queue-tag">{task.aspectRatio}</span>
                            <span class="queue-prompt">
                                {task.useCustomPrompt ? task.customPrompt : task.subject}
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
                                        <button class="img-container" onclick={() => openFullScreen(`/api/images/${res.outputDir || outputDir}/${res.filename}?t=${res.ts || ''}`)}>
                                            <img src="/api/images/{res.outputDir || outputDir}/{res.filename}?t={res.ts || ''}" alt="Generated" />
                                            <div class="img-overlay">Click to Enlarge</div>
                                        </button>
                                    {:else}
                                        <a class="file-download" href={`/api/images/${res.outputDir || outputDir}/${res.filename}?t=${res.ts || ''}`} download={res.filename}>
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
                                {:else}
                                    <div class="loading-placeholder">Processing...</div>
                                {/if}
                            </div>
                            <div class="prompt-display">
                                <div class="prompt-label">Prompt</div>
                                <textarea readonly value={res.prompt || ''}></textarea>
                                {#if res.error}
                                    <p class="error-text">{res.error}</p>
                                {/if}
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
        background-color: #f8fafc; 
        color: #1e293b; 
        margin: 0; 
        -webkit-tap-highlight-color: transparent;
        overflow-x: hidden;
    }
    .container { 
        max-width: 1000px; 
        margin: 0 auto; 
        padding: 20px 16px; 
        width: 100%;
        overflow-x: hidden;
    }
    
    @media (min-width: 768px) {
        .container { margin: 40px auto; padding: 0 20px; }
    }

    header { text-align: center; margin-bottom: 24px; }
    header h1 { font-size: 1.5rem; margin: 0; }
    header p { font-size: 0.9rem; color: #64748b; margin-top: 4px; }

    @media (min-width: 768px) {
        header { margin-bottom: 40px; }
        header h1 { font-size: 2rem; }
    }

    .card, .results { 
        background: white; 
        padding: 20px; 
        border-radius: 12px; 
        box-shadow: 0 1px 3px rgba(0,0,0,0.1); 
        margin-bottom: 24px; 
        border: 1px solid #e2e8f0; 
        width: 100%;
    }

    @media (min-width: 768px) {
        .card, .results { padding: 32px; }
    }

    h2 { font-size: 1rem; margin: 0 0 16px 0; padding-bottom: 10px; border-bottom: 1px solid #f1f5f9; }
    
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
    .toggle-slider {
        position: relative;
        width: 44px;
        height: 24px;
        background: #cbd5e1;
        border-radius: 99px;
        transition: background 0.2s;
        flex-shrink: 0;
    }
    .toggle-slider::before {
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
    .toggle-checkbox:checked + .toggle-slider { background: #2563eb; }
    .toggle-checkbox:checked + .toggle-slider::before { transform: translateX(20px); }
    .toggle-description { font-size: 0.75rem; color: #64748b; margin-top: -8px; margin-bottom: 12px; }
    input, select, textarea { 
        width: 100%;
        padding: 12px; 
        border: 1px solid #cbd5e1; 
        border-radius: 8px; 
        font-size: 1rem; 
        appearance: none;
        background-color: white;
    }
    
    /* Better touch targets for mobile */
    input[type="number"], select {
        min-height: 48px;
    }

    textarea { height: 100px; resize: vertical; }
    
    .actions { display: flex; flex-direction: column; gap: 12px; margin-top: 20px; }
    
    @media (min-width: 640px) {
        .actions { flex-direction: row; }
    }

    button { 
        width: 100%;
        min-height: 48px;
        padding: 12px; 
        border: none; 
        border-radius: 8px; 
        font-weight: 600; 
        cursor: pointer; 
        transition: transform 0.1s, opacity 0.2s; 
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
</style>
