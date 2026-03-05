#!/usr/bin/env bash
# Scans LoRA directories and writes JSON config files for the rhub UI.
# Run this on the host before rebuilding the Docker container.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/src/lib"

generate_json() {
    local dir="$1"
    local base_url="$2"
    local out_file="$3"

    echo "Scanning $dir..."

    if [ ! -d "$dir" ]; then
        echo "  Directory not found: $dir — writing empty array."
        echo "[]" > "$out_file"
        return
    fi

    mapfile -t files < <(find "$dir" -maxdepth 1 -name "*.safetensors" | sort)

    if [ ${#files[@]} -eq 0 ]; then
        echo "  No .safetensors files found — writing empty array."
        echo "[]" > "$out_file"
        return
    fi

    local json="["
    local first=true
    for filepath in "${files[@]}"; do
        local filename
        filename=$(basename "$filepath")
        local name="${filename%.safetensors}"
        local url="$base_url/$filename"
        if [ "$first" = true ]; then
            first=false
        else
            json+=","
        fi
        local escaped_name escaped_url
        escaped_name=$(printf '%s' "$name" | sed 's/"/\\"/g')
        escaped_url=$(printf '%s' "$url" | sed 's/"/\\"/g')
        json+=$'\n  '"$(printf '{"name":"%s","url":"%s"}' "$escaped_name" "$escaped_url")"
    done
    json+=$'\n]'

    echo "$json" > "$out_file"
    echo "  Written ${#files[@]} LoRA(s) to $out_file"
}

generate_json \
    "/mnt/backblaze/storage/LoRA/Civitai/flux.2-klein-9b" \
    "https://filez.gemneye.xyz/LoRA/Civitai/flux.2-klein-9b" \
    "$LIB_DIR/loras-klein.json"

generate_json \
    "/mnt/backblaze/storage/LoRA/Civitai/zImage" \
    "https://filez.gemneye.xyz/LoRA/Civitai/zImage" \
    "$LIB_DIR/loras-zimage.json"

echo "Done. Rebuild the Docker container to apply changes."
