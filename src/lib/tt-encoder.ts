/**
 * TT-Encoder - LSB Steganography Encoder (TypeScript)
 *
 * Hides files inside PNG images using LSB steganography.
 * Compatible with TT-Decoder.
 */
import { PNG } from 'pngjs';

/**
 * Encode a payload buffer into a new carrier PNG image.
 * The carrier image is automatically sized to hold the payload.
 * 
 * @param payloadBuffer The file data to hide
 * @param extension The file extension (e.g., 'jpg', 'png')
 * @returns Buffer containing the encoded PNG image
 */
export function encodeImage(payloadBuffer: Buffer | Uint8Array, extension: string): Buffer {
    const data = Buffer.isBuffer(payloadBuffer) ? payloadBuffer : Buffer.from(payloadBuffer);
    const payloadSize = data.length;
    
    // Clean extension (remove leading dot if present)
    const ext = extension.startsWith('.') ? extension.substring(1) : extension;
    const extBuffer = Buffer.from(ext, 'ascii');
    const extLen = extBuffer.length;

    // Header layout: [ext_len(1)][ext(n)][data_size(4)][file_data...]
    // headerLength is the number of bytes in this layout.
    const headerLength = 1 + extLen + 4 + payloadSize;
    
    // Total bits needed: 32 (for headerLength) + headerLength * 8
    const totalBitsNeeded = 32 + (headerLength * 8);

    // Calculate carrier dimensions. 
    // We use middle 60% of pixels. Each pixel has 3 channels (RGB).
    // Capacity = width * height * 0.6 * 3
    const pixelsNeeded = Math.ceil(totalBitsNeeded / (0.6 * 3));
    let side = Math.ceil(Math.sqrt(pixelsNeeded));
    // Ensure width/height are at least some reasonable minimum
    side = Math.max(side, 64);
    
    const width = side;
    const height = side;

    const png = new PNG({ width, height });
    
    // Fill carrier with neutral grey
    for (let i = 0; i < png.data.length; i += 4) {
        png.data[i] = 128;     // R
        png.data[i + 1] = 128; // G
        png.data[i + 2] = 128; // B
        png.data[i + 3] = 255; // A
    }

    // Generate the bit stream
    const bits = new Uint8Array(totalBitsNeeded);
    let bitIdx = 0;

    // 1. 32-bit header length (big-endian)
    for (let i = 31; i >= 0; i--) {
        bits[bitIdx++] = (headerLength >>> i) & 1;
    }

    // 2. ext_len (1 byte)
    for (let i = 7; i >= 0; i--) {
        bits[bitIdx++] = (extLen >>> i) & 1;
    }

    // 3. ext (n bytes)
    for (let i = 0; i < extLen; i++) {
        const byte = extBuffer[i];
        for (let j = 7; j >= 0; j--) {
            bits[bitIdx++] = (byte >>> j) & 1;
        }
    }

    // 4. data_size (4 bytes, big-endian)
    for (let i = 31; i >= 0; i--) {
        bits[bitIdx++] = (payloadSize >>> i) & 1;
    }

    // 5. file_data
    for (let i = 0; i < payloadSize; i++) {
        const byte = data[i];
        for (let j = 7; j >= 0; j--) {
            bits[bitIdx++] = (byte >>> j) & 1;
        }
    }

    // Embed bits into LSBs of the middle 60% region
    const startRow = Math.floor(height / 5);
    const endRow = height - Math.floor(height / 5);
    let currentBit = 0;

    for (let y = startRow; y < endRow && currentBit < bits.length; y++) {
        for (let x = 0; x < width && currentBit < bits.length; x++) {
            const idx = (y * width + x) * 4;
            
            // Channel R
            png.data[idx] = (png.data[idx] & 0xFE) | bits[currentBit++];
            if (currentBit >= bits.length) break;
            
            // Channel G
            png.data[idx + 1] = (png.data[idx + 1] & 0xFE) | bits[currentBit++];
            if (currentBit >= bits.length) break;
            
            // Channel B
            png.data[idx + 2] = (png.data[idx + 2] & 0xFE) | bits[currentBit++];
            if (currentBit >= bits.length) break;
        }
    }

    return PNG.sync.write(png);
}
