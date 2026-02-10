# iMontage RunningHub

> AI-powered batch image generation interface using Google Gemini for prompt engineering and RunningHub's FLUX.1-dev LoRA pipeline.

A self-hosted SvelteKit web application that automates high-quality image generation. It uses Google Gemini to craft diverse, scenario-driven prompts from a subject description, then submits them to RunningHub for FLUX.1-dev LoRA-based image synthesis — all through a clean browser UI.

## Features

- **AI Prompt Engineering** — Google Gemini generates unique, detailed FLUX.1-dev prompts from 10 curated photographic scenarios, avoiding repetitive outputs
- **Batch Generation** — Queue up to 50 sequential image generations with a single click
- **LoRA Support** — Point to any custom LoRA model URL for character-consistent output
- **Flexible Aspect Ratios** — 9 presets (1:1, 16:9, 9:16, 3:2, etc.) with automatic 16px-aligned dimension calculation
- **Live Status Tracking** — Real-time polling with per-image status badges (Processing, Success, Failed, Cancelled)
- **Image Preview & Fullscreen** — Inline thumbnails with click-to-enlarge modal viewer
- **Auto File Management** — Sequential filename numbering with configurable prefix and output directory
- **Docker-Ready** — Multi-stage build with volume-mounted output directory

## Architecture

![Architecture Diagram](./docs/diagrams/architecture.svg)

The application runs as a single SvelteKit container with three server-side API routes. The frontend communicates with two external APIs — Google Gemini for prompt generation and RunningHub for image synthesis — while serving generated images from a Docker-mounted volume.

## Data Flow

![Data Flow Diagram](./docs/diagrams/data-flow.svg)

1. User provides subject characteristics, LoRA URL, and API keys
2. A random photographic scenario is selected from 10 curated options
3. Gemini generates a detailed FLUX.1-dev prompt combining the subject and scenario
4. Image dimensions are calculated from the chosen aspect ratio (16px-aligned)
5. The prompt, LoRA, dimensions, and a random seed are submitted to RunningHub
6. The client polls the task status every 5 seconds
7. On success, the image is downloaded and saved to the mounted volume
8. The image and its prompt are displayed in the results feed

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Docker](https://docs.docker.com/get-docker/) & Docker Compose (for containerized deployment)
- A [Google Gemini API key](https://aistudio.google.com/apikey)
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
| **Gemini API Key** | Web UI | Required. Google Gemini API key for prompt generation |
| **RunningHub API Key** | Web UI | Required. RunningHub API key for image synthesis |
| **LoRA URL** | Web UI | URL to a FLUX.1-dev compatible LoRA model |
| **Subject** | Web UI | Text description of the subject characteristics |
| **Aspect Ratio** | Web UI | One of: `1:1`, `16:9`, `9:16`, `3:2`, `2:3`, `4:3`, `3:4`, `4:5`, `5:4` |
| **Number of Prompts** | Web UI | Batch size (1-50) |
| **Output Sub-directory** | Web UI | Subdirectory within the mount volume (default: `generations`) |
| **Filename Prefix** | Web UI | File naming prefix (default: `image`) — files are saved as `{prefix}_001.png` |

### Docker Volumes

| Container Path | Host Path | Purpose |
|---------------|-----------|---------|
| `/mount` | `./outputs` | Generated images are saved here |

## API Reference

### `POST /api/generate`

Generates a prompt via Gemini and submits an image generation job to RunningHub.

**Request Body:**
```json
{
  "loraUrl": "https://...",
  "subject": "Description of the subject",
  "aspectRatio": "1:1",
  "geminiKey": "...",
  "rhubKey": "..."
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

Polls RunningHub for task status and downloads the image on success.

**Request Body:**
```json
{
  "taskId": "abc123",
  "rhubKey": "...",
  "outputDir": "generations",
  "prefix": "image"
}
```

**Response:**
```json
{
  "status": "SUCCESS",
  "filename": "image_001.png"
}
```

Status values: `SUCCESS`, `PROCESSING`, `FAILED`

### `GET /api/images/[...path]`

Serves generated images from the mounted volume. Supports `.png` and `.jpg` files with a path traversal security check.

## Project Structure

```
rhub/
├── src/
│   ├── routes/
│   │   ├── +page.svelte              # Main UI (form, results, modal)
│   │   ├── +layout.svelte            # Root layout
│   │   └── api/
│   │       ├── generate/+server.ts   # Gemini prompt gen + RunningHub submit
│   │       ├── check/+server.ts      # Task polling + image download
│   │       └── images/[...path]/+server.ts  # Static image serving
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

- **Frontend**: [Svelte 5](https://svelte.dev/) with runes (`$state`, `$props`)
- **Framework**: [SvelteKit](https://kit.svelte.dev/) with `adapter-node`
- **AI**: [Google Generative AI SDK](https://ai.google.dev/) (`@google/generative-ai`) — Gemini 3 Pro
- **Image Gen**: [RunningHub API](https://www.runninghub.ai/) — FLUX.1-dev with LoRA
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

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

## License

Private — All rights reserved.
