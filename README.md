# rhub — RunningHub Precision Control Center

> **Advanced RunningHub & FLUX.1-dev control center. Featuring AI-orchestrated prompt engineering from 300 photogenic locations, sequential batch queuing, and LSB steganography decoding.**

**rhub** is a specialized SvelteKit-based dashboard that transforms simple subject descriptions into high-quality, LoRA-consistent imagery. It solves the "repetition problem" in AI generation by bridging expert prompt engineering (Gemini/Qwen) with the FLUX.1-dev synthesis pipeline.

## Key Features

- **Expert Orchestration** — Google Gemini 3 Flash or RunPod Qwen 30B synthesizes detailed FLUX.1-dev prompts via a 2-step process: location selection + AI composition.
- **Persistent Sequential Queue** — Bypasses RunningHub’s single-task limitation with a robust client-side queue. Captures full form state (LoRA, Output Dir, API keys) per task, survives page refreshes, and processes jobs one-by-one.
- **Custom Prompt Support** — Toggle between AI-engineered prompts or directly supply your own final FLUX prompts. Strictly enforces the bypass with zero LLM intervention when active.
- **300 Curated Locations** — Module-level Fisher-Yates shuffled queue of 300 unique locations (Urban, Arctic, Desert, etc.) ensures zero repetition across large batches.
- **TT-Decoder (LSB Steganography)** — Built-in TypeScript decoder for extracting hidden file data from RunningHub PNGs using LSB steganography.
- **Flexible Dimensions** — 9 aspect ratio presets with automatic 16px-aligned dimension calculation.
- **Modern Tech Stack** — Built with Svelte 5 (Runes), TypeScript, and Node.js; fully containerized for Docker deployment.

## Architecture

![Architecture Diagram](./docs/diagrams/architecture.svg)

The application runs as a single SvelteKit container with server-side API routes. The frontend communicates with external APIs — Google Gemini (or RunPod) for prompt generation and RunningHub for image synthesis — while serving generated images from a Docker-mounted volume.

## Data Flow

![Data Flow Diagram](./docs/diagrams/data-flow.svg)

1. User provides subject characteristics, LoRA URL, and API keys.
2. User adds one or more tasks to the **Persistent Queue** (capturing current parameters).
3. The background processor picks the next task from the queue:
    - If **Custom Prompt** is ON: Uses the user-provided prompt directly.
    - If **AI Engineering** is ON:
        a. A location is randomly selected from 300 curated locations (Fisher-Yates shuffle).
        b. AI generates a scene composition for the location + subject.
        c. AI synthesizes a detailed FLUX.1-dev prompt from the composition.
4. Image dimensions are calculated from the chosen aspect ratio (16px-aligned).
5. The prompt, LoRA, dimensions, and a random seed are submitted to RunningHub.
6. The client polls the task status every 5 seconds.
7. On success, the image is downloaded; if TT-Decode is enabled, hidden data is extracted.
8. The final file is saved to the task's specific output directory and displayed.
9. The process repeats for the next item in the queue.

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) & Docker Compose
- A [Google Gemini API key](https://aistudio.google.com/apikey) or a [RunPod API key](https://www.runpod.io/)
- A [RunningHub API key](https://www.runninghub.ai/)

### Run with Docker (Recommended)

```bash
# Clone the repository
git clone <repo-url>
cd rhub

# Ensure the shared Docker network exists
docker network create shared_net 2>/dev/null || true

# Build and start
docker compose up -d
```

The interface is available on port **3000** within the `shared_net` Docker network. Use a reverse proxy (e.g., Nginx Proxy Manager) to expose it externally.

### Run Locally (Development)

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Configuration

| Setting | Where | Description |
|---------|-------|-------------|
| **AI Prompt Provider** | Web UI | Choose between Google Gemini or RunPod (Qwen 30B) |
| **Gemini API Key** | Web UI | Google Gemini API key (required when using Gemini provider) |
| **RunPod API Key** | Web UI | RunPod API key (required when using RunPod provider) |
| **RunningHub API Key** | Web UI | Required. RunningHub API key for image synthesis |
| **Enable TT-Decoder** | Web UI | Toggle LSB steganography decoding of returned images (persisted in localStorage) |
| **LoRA URL** | Web UI | URL to a FLUX.1-dev compatible LoRA model |
| **Subject** | Web UI | Text description of the subject characteristics |
| **Aspect Ratio** | Web UI | One of: `1:1`, `16:9`, `9:16`, `3:2`, `2:3`, `4:3`, `3:4`, `4:5`, `5:4` |
| **Number of Prompts** | Web UI | Batch size (1-50) |
| **Output Sub-directory** | Web UI | Subdirectory within the mount volume (default: `generations`) |
| **Filename Prefix** | Web UI | File naming prefix (default: `image`) — files are saved as `{prefix}_001.ext` |

### Docker Volumes

| Container Path | Host Path | Purpose |
|---------------|-----------|---------|
| `/mount` | `./outputs` | Generated images and decoded files are saved here |

## API Reference

### `POST /api/generate`

Selects a random location, generates a prompt via AI (or uses a custom one), and submits an image generation job to RunningHub.

**Request Body:**
```json
{
  "loraUrl": "https://...",
  "subject": "Description of the subject",
  "aspectRatio": "1:1",
  "geminiKey": "...",
  "rhubKey": "...",
  "runpodKey": "...",
  "promptProvider": "gemini",
  "useTtDecoder": false,
  "useCustomPrompt": false,
  "customPrompt": ""
}
```

**Response:**
```json
{
  "taskId": "abc123",
  "prompt": "Generated FLUX.1-dev prompt text..."
}
```

### `POST /api/check`

Polls RunningHub for task status. On success, downloads the image and optionally decodes hidden data via TT-Decoder.

**Request Body:**
```json
{
  "taskId": "abc123",
  "rhubKey": "...",
  "outputDir": "generations",
  "prefix": "image",
  "useTtDecoder": false
}
```

**Response:**
```json
{
  "status": "SUCCESS",
  "filename": "image_001.png",
  "resultInfo": { "decoded": true, "extension": "png" }
}
```

`resultInfo` is only present when `useTtDecoder` is `true`. Status values: `SUCCESS`, `PROCESSING`, `FAILED`.

### `GET /api/images/[...path]`

Serves generated files from the mounted volume with correct MIME types. Supports images, video, PDF, and other common formats. Non-displayable types are served with `Content-Disposition: attachment`. Responses include `Cache-Control: no-store` to prevent stale content.

## Project Structure

```
rhub/
├── src/
│   ├── lib/
│   │   ├── locations.ts              # 300 curated photogenic locations + shuffle queue
│   │   ├── tt-decoder.ts             # LSB steganography decoder (PNG → hidden file)
│   │   └── pngjs.d.ts                # Type declarations for pngjs
│   ├── routes/
│   │   ├── +page.svelte              # Main UI (form, results, modal, toast)
│   │   ├── +layout.svelte            # Root layout
│   │   └── api/
│   │       ├── generate/+server.ts   # AI prompt gen + RunningHub submit
│   │       ├── check/+server.ts      # Task polling + image download + TT-Decode
│   │       ├── prompts/+server.ts    # Standalone prompt generation endpoint
│   │       └── images/[...path]/+server.ts  # File serving with MIME detection
│   ├── app.html                      # HTML shell
│   └── app.d.ts                      # SvelteKit type declarations
├── static/                           # Favicons and web manifest
├── Dockerfile                        # Multi-stage Node.js 20 build
├── docker-compose.yml                # Production deployment config
├── svelte.config.js                  # SvelteKit + adapter-node config
├── vite.config.ts                    # Vite configuration
└── package.json                      # Dependencies and scripts
```

## Tech Stack

- **Frontend**: [Svelte 5](https://svelte.dev/) with runes (`$state`, `$effect`)
- **Framework**: [SvelteKit](https://kit.svelte.dev/) with `adapter-node`
- **AI**: [Google GenAI SDK](https://ai.google.dev/) (`@google/genai`) — Gemini 3 Flash Preview
- **AI (Alt)**: [RunPod](https://www.runpod.io/) — Qwen 30B via serverless endpoint
- **Image Gen**: [RunningHub API](https://www.runninghub.ai/) — FLUX.1-dev with LoRA (dual workflows)
- **Steganography**: [pngjs](https://github.com/lukeapage/pngjs) — PNG parsing for LSB extraction
- **Runtime**: Node.js 20 (multi-stage Docker build)
- **Build**: Vite 6, TypeScript 5

## Scripts

```bash
npm run dev        # Start dev server (hot reload)
npm run build      # Production build
npm run start      # Run production build
npm run preview    # Preview production build locally
npm run check      # TypeScript and Svelte type checking
```

## License

Private — All rights reserved.
