#!/usr/bin/env bash
# Downloads a LoRA from Civitai by version ID, captures its trigger words,
# updates civitai_zimage_triggers.json, and regenerates loras-zimage.json.
#
# Usage: ./civitai-add-lora-zimage.sh <civitai-version-id>
# Example: ./civitai-add-lora-zimage.sh 2416596
set -euo pipefail

VERSION_ID="${1:?Usage: $0 <civitai-version-id>}"
CIVITAI_TOKEN="6f956090e131b090eec5c60a3bd88323"
LORA_DIR="/mnt/backblaze/storage/LoRA/Civitai/zImage"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRIGGERS_FILE="$SCRIPT_DIR/civitai_zimage_triggers.json"

if ! command -v jq &>/dev/null; then
    echo "Error: jq is required but not installed." >&2
    exit 1
fi

# 1. Fetch version metadata from Civitai API
echo "Fetching metadata for version $VERSION_ID..."
metadata=$(curl -sf "https://civitai.com/api/v1/model-versions/$VERSION_ID")

model_name=$(echo "$metadata" | jq -r '.model.name')
model_id=$(echo "$metadata" | jq -r '.modelId')
filename=$(echo "$metadata" | jq -r '.files[0].name')
trigger_words=$(echo "$metadata" | jq -c '[.trainedWords[]? | select(. != "")]')
page_url="https://civitai.com/models/$model_id"

echo "  Model:         $model_name"
echo "  File:          $filename"
echo "  Trigger words: $trigger_words"
echo "  Page:          $page_url"

# 2. Download the LoRA
echo ""
echo "Downloading to $LORA_DIR..."
wget \
    "https://civitai.com/api/download/models/$VERSION_ID?token=$CIVITAI_TOKEN" \
    --content-disposition \
    -P "$LORA_DIR"

# 3. Update triggers JSON — remove any existing entry for this file, then append
echo ""
echo "Updating $TRIGGERS_FILE..."
updated=$(jq \
    --arg lf "$filename" \
    --arg mn "$model_name" \
    --arg pu "$page_url" \
    --argjson tw "$trigger_words" \
    'map(select(.local_file != $lf)) + [{
        model_name: $mn,
        local_file: $lf,
        page_url: $pu,
        trigger_words: $tw,
        match_confidence: "high"
    }] | sort_by(.local_file)' \
    "$TRIGGERS_FILE")
echo "$updated" > "$TRIGGERS_FILE"
echo "  Done."

# 4. Regenerate loras-zimage.json
echo ""
echo "Regenerating LoRA list..."
"$SCRIPT_DIR/generate-loras.sh"
