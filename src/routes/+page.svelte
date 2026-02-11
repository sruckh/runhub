<script lang="ts">
    import { onMount } from 'svelte';

    let loraUrl = $state('');
    let subject = $state('');
    let numPrompts = $state(1);
    let outputDir = $state('generations');
    let prefix = $state('image');
    let aspectRatio = $state('1:1');
    let geminiKey = $state('');
    let rhubKey = $state('');
    let runpodKey = $state('');
    let promptProvider = $state('gemini');
    let loading = $state(false);
    let results = $state<any[]>([]);
    let error = $state('');
    
    // New states
    let isCancelled = $state(false);
    let selectedImage = $state<string | null>(null);

    onMount(() => {
        console.log('iMontage Interface Mounted');
    });

    const aspectRatios = ['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4'];

    async function handleSubmit() {
        loading = true;
        isCancelled = false;
        error = '';
        
        const payloadBase = {
            loraUrl,
            subject,
            aspectRatio,
            geminiKey,
            rhubKey,
            runpodKey,
            promptProvider
        };

        for (let i = 0; i < numPrompts; i++) {
            if (isCancelled) break;
            await startGeneration(payloadBase, i);
        }
        
        loading = false;
    }

    function handleCancel() {
        isCancelled = true;
    }

    function clearQueue() {
        if (!loading) {
            results = [];
        }
    }

    async function startGeneration(payload: any, index: number) {
        const resultId = Math.random().toString(36).substring(7);
        results = [{ id: resultId, status: 'INITIALIZING', prompt: `Preparing generation ${index + 1}...` }, ...results];

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

            await pollTask(resultId, taskId);

        } catch (e: any) {
            updateResult(resultId, { status: 'FAILED', error: e.message });
        }
    }

    async function pollTask(resultId: string, taskId: string) {
        while (!isCancelled) {
            try {
                const response = await fetch('/api/check', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ taskId, rhubKey, outputDir, prefix })
                });
                const data = await response.json();

                if (data.status === 'SUCCESS') {
                    updateResult(resultId, { status: 'SUCCESS', filename: data.filename });
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
        
        if (isCancelled) {
            updateResult(resultId, { status: 'CANCELLED', error: 'User cancelled operation' });
        }
    }

    function updateResult(id: string, updates: any) {
        results = results.map(r => r.id === id ? { ...r, ...updates } : r);
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
            <div class="field">
                <label for="loraUrl">LoRA URL</label>
                <input type="text" id="loraUrl" bind:value={loraUrl} placeholder="https://..." />
            </div>
            
            <div class="field">
                <label for="subject">Subject Characteristics</label>
                <textarea id="subject" bind:value={subject} placeholder="e.g. 50-year old woman..."></textarea>
            </div>

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
            {#if !loading}
                <button class="btn-primary" onclick={handleSubmit}>Start Generation</button>
                {#if results.length > 0}
                    <button class="btn-secondary" onclick={clearQueue}>Clear Results</button>
                {/if}
            {:else}
                <button class="btn-danger" onclick={handleCancel}>Cancel Batch</button>
            {/if}
        </div>
    </div>

    {#if error}
        <div class="error-box">{error}</div>
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
                                    <button class="img-container" onclick={() => openFullScreen(`/api/images/${outputDir}/${res.filename}`)}>
                                        <img src="/api/images/{outputDir}/{res.filename}" alt="Generated" />
                                        <div class="img-overlay">Click to Enlarge</div>
                                    </button>
                                {:else if res.status === 'FAILED' || res.status === 'CANCELLED'}
                                    <div class="error-placeholder">{res.status}</div>
                                {:else}
                                    <div class="loading-placeholder">Processing...</div>
                                {/if}
                            </div>
                            <div class="prompt-display">
                                <label>Prompt</label>
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
    
    @media (hover: hover) {
        .img-container:hover .img-overlay { opacity: 1; }
    }

    .loading-placeholder, .error-placeholder { width: 100%; aspect-ratio: 1; background: #f1f5f9; display: flex; align-items: center; justify-content: center; border-radius: 8px; font-size: 0.8rem; color: #94a3b8; border: 2px dashed #e2e8f0; }
    .prompt-display { display: flex; flex-direction: column; width: 100%; }
    .prompt-display textarea { width: 100%; height: 100px; background: #f8fafc; border: 1px solid #f1f5f9; font-size: 0.85rem; }
    .error-text { color: #dc2626; font-size: 0.8rem; margin-top: 8px; }

    /* Modal Styles */
    .modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.95); z-index: 1000; display: flex; align-items: center; justify-content: center; }
    .modal-content { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
    .modal-content img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .close-modal { position: absolute; top: 20px; right: 20px; background: rgba(255,255,255,0.2); border: none; color: white; font-size: 1.5rem; cursor: pointer; padding: 10px; line-height: 1; border-radius: 50%; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; }
</style>
