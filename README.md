# rhub — RunningHub Precision Control Center

> **Advanced RunningHub & FLUX.1-dev control center. Featuring AI-orchestrated prompt engineering from 300 photogenic locations, sequential batch queuing, image upscaling with LSB steganography support, and real-time polling.**

**rhub** is a specialized SvelteKit-based dashboard that transforms simple subject descriptions into high-quality, LoRA-consistent imagery. It solves the "repetition problem" in AI generation by bridging expert prompt engineering (Gemini/Qwen) with the FLUX.1-dev synthesis pipeline.

## Key Features

- **Expert Orchestration** — Google Gemini 3 Flash or RunPod Qwen 30B synthesizes detailed FLUX.1-dev prompts via a 2-step process: location selection + AI composition.
- **Image Upscaling** — Batch upscale images to 2K resolution using specialized RunningHub workflows. Handles intermediary storage via S3 (e.g., Backblaze B2) with automatic presigned URL generation.
- **LSB Steganography (TT-Decoder/Encoder)** — Built-in TypeScript support for both extracting hidden data from generated images and **embedding data into carrier images** for secure upscale processing.
- **Persistent Sequential Queue** — Bypasses RunningHub’s single-task limitation with a robust client-side queue. Captures full form state (LoRA, Output Dir, API keys) per task, survives page refreshes, and processes jobs one-by-one.
- **Modern Tabbed UI** — Segmented control interface with smooth sliding indicators for seamless switching between Generation and Upscaling modes.
- **300 Curated Locations** — Module-level Fisher-Yates shuffled queue of 300 unique locations ensures zero repetition across large batches.
- **Flexible Dimensions** — 9 aspect ratio presets with automatic 16px-aligned dimension calculation.
- **Containerized Deployment** — Fully Dockerized with environment-based configuration for secrets and server limits.

## Architecture

![Architecture Diagram](./docs/diagrams/architecture.svg)

The application runs as a single SvelteKit container. API routes handle server-side logic including AI prompt synthesis, S3 uploads, and RunningHub interaction. Images are served directly from a Docker-mounted volume to prevent caching issues and ensure persistence.

## Data Flow

![Data Flow Diagram](./docs/diagrams/data-flow.svg)

### Generation Flow
1. User provides subject characteristics, LoRA URL, and API keys.
2. Tasks are added to the **Persistent Queue**.
3. Background processor picks the next task:
    - AI selects a location and generates a vivid composition.
    - AI synthesizes the final detailed FLUX.1-dev prompt.
4. Dimensions are calculated and the task is submitted to RunningHub.
5. The client polls status, downloads the result, and optionally decodes hidden data.

### Upscale Flow
1. User uploads images via the **Upscale** tab.
2. Background processor picks the next upscale task:
    - If **TT-Decoder** toggle is ON: The image is encoded into a new carrier PNG using **TT-Encoder**.
    - The image (original or encoded) is uploaded to S3 storage.
    - A temporary presigned URL is generated and sent to the RunningHub 2K Upscale workflow.
3. The client polls status and downloads the upscaled success result.

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) & Docker Compose
- A [Google Gemini API key](https://aistudio.google.com/apikey) or a [RunPod API key](https://www.runpod.io/)
- A [RunningHub API key](https://www.runninghub.ai/)
- **S3-compatible Storage** (Required for Upscaling) — e.g., [Backblaze B2](https://www.backblaze.com/cloud-storage).

### Run with Docker (Recommended)

```bash
# Clone the repository
git clone <repo-url>
cd rhub

# Configure environment variables
cp .env.example .env
# Edit .env with your S3 credentials and body limits

# Ensure the shared Docker network exists
docker network create shared_net 2>/dev/null || true

# Build and start
docker compose up -d
```

## Configuration

| Setting | Where | Description |
|---------|-------|-------------|
| **AI Prompt Provider** | Web UI | Choose between Google Gemini or RunPod (Qwen 30B) |
| **RunningHub API Key** | Web UI | Required. RunningHub API key for image synthesis |
| **Enable TT-Decoder** | Web UI | Toggle LSB steganography decoding/encoding (persisted in localStorage) |
| **S3_ENDPOINT** | `.env` | S3 API endpoint (e.g. `s3.us-west-004.backblazeb2.com`) |
| **S3_BUCKET** | `.env` | Name of the bucket for intermediary image storage |
| **S3_ACCESS_KEY_ID** | `.env` | S3 access key ID |
| **S3_SECRET_ACCESS_KEY** | `.env` | S3 secret access key |
| **BODY_SIZE_LIMIT** | `.env` | Maximum upload size in bytes (e.g., `52428800` for 50MB) |

## API Reference

### `POST /api/generate`
Submits an image generation job to RunningHub. Handles AI prompt engineering.

### `POST /api/upscale`
Handles multipart form uploads. Encodes images if requested, uploads to S3, and submits to specialized RunningHub upscaling workflows (`2022423075609907202` for encoded, `2022348592370950145` for direct).

### `POST /api/check`
Polls status and handles post-processing (download + TT-Decode).

## Project Structure

```
rhub/
├── src/
│   ├── lib/
│   │   ├── tt-decoder.ts             # LSB Steganography extraction
│   │   ├── tt-encoder.ts             # LSB Steganography embedding
│   │   ├── s3.ts                     # S3 Client & Presigned URL logic
│   │   └── locations.ts              # 300 photogenic locations
│   └── routes/
│       ├── +page.svelte              # Modern Tabbed UI (Runes)
│       └── api/
│           ├── upscale/              # Upload + Encoding + S3 Hosting
│           └── generate/             # AI Synthesis + Submission
├── .env.example                      # Template for secrets and limits
├── Dockerfile                        # Multi-stage production build
└── docker-compose.yml                # Container orchestration
```

## Tech Stack

- **Frontend**: Svelte 5 (Runes), TypeScript, SvelteKit
- **Backend**: Node.js, AWS SDK (S3), pngjs
- **AI**: Gemini 3 Flash / RunPod Qwen 30B
- **Infrastructure**: Docker, Docker Compose

## License

Private — All rights reserved.
