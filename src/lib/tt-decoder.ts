/**
 * TT-Decoder - LSB Steganography Decoder (TypeScript)
 *
 * Extracts hidden files from PNG images encoded with LSB steganography.
 * Ported from falLoRA ttdecode.py
 */
import { PNG } from 'pngjs';

export interface DecodedResult {
	data: Uint8Array | null;
	extension: string | null;
}

/**
 * Decode a hidden file from an LSB-encoded PNG image buffer.
 * Reads LSBs from the middle 60% of image height (skipping top/bottom 20%)
 * and parses the embedded header + file data.
 */
export function decodeImage(imageBuffer: Buffer | Uint8Array): DecodedResult {
	try {
		// Ensure Buffer for pngjs compatibility
		const buf = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer);

		const png = PNG.sync.read(buf);
		const { width, height, data } = png;

		// Middle 60% region (skip 20% top and bottom)
		const startRow = Math.floor(height / 5);
		const endRow = height - Math.floor(height / 5);

		if (endRow <= startRow) {
			console.error('[TT-Decoder] Image too small for decoding');
			return { data: null, extension: null };
		}

		// Extract LSBs from R, G, B channels (skip Alpha) into a typed array
		const bitCapacity = (endRow - startRow) * width * 3;
		const flatBits = new Uint8Array(bitCapacity);
		let bitCount = 0;

		for (let y = startRow; y < endRow; y++) {
			for (let x = 0; x < width; x++) {
				const idx = (y * width + x) * 4; // RGBA layout
				flatBits[bitCount++] = data[idx] & 1;     // R
				flatBits[bitCount++] = data[idx + 1] & 1; // G
				flatBits[bitCount++] = data[idx + 2] & 1; // B
			}
		}

		// --- Parse 32-bit header length ---
		if (bitCount < 32) {
			console.error('[TT-Decoder] Image too small to contain header');
			return { data: null, extension: null };
		}

		let headerLength = 0;
		for (let i = 0; i < 32; i++) {
			headerLength = (headerLength << 1) | flatBits[i];
		}

		// Dynamic limit: header can't exceed what the image LSBs can hold
		const maxHeaderLength = Math.floor((bitCount - 32) / 8);
		if (headerLength <= 0 || headerLength > maxHeaderLength) {
			console.error(`[TT-Decoder] Invalid header length: ${headerLength} (max: ${maxHeaderLength})`);
			return { data: null, extension: null };
		}

		const headerBitCount = headerLength * 8;
		const totalBitsNeeded = 32 + headerBitCount;
		// This check is now guaranteed to pass by the limit above, but kept for clarity
		if (bitCount < totalBitsNeeded) {
			console.error(`[TT-Decoder] Not enough data. Need ${totalBitsNeeded} bits, have ${bitCount}`);
			return { data: null, extension: null };
		}

		// --- Extract header bytes ---
		const headerBytes = bitsToBytes(flatBits, 32, headerBitCount);

		if (headerBytes.length < 5) {
			console.error('[TT-Decoder] Header too short');
			return { data: null, extension: null };
		}

		// Header layout: [ext_len(1)][ext(n)][data_size(4)][file_data_part...]
		const extLen = headerBytes[0];

		if (headerBytes.length < 1 + extLen + 4) {
			console.error('[TT-Decoder] Malformed header');
			return { data: null, extension: null };
		}

		// Parse file extension
		let extension = '';
		for (let i = 0; i < extLen; i++) {
			extension += String.fromCharCode(headerBytes[1 + i]);
		}

		// Parse data size as unsigned 32-bit big-endian
		const dataSize = (
			(headerBytes[1 + extLen] << 24) |
			(headerBytes[2 + extLen] << 16) |
			(headerBytes[3 + extLen] << 8) |
			headerBytes[4 + extLen]
		) >>> 0; // >>> 0 ensures unsigned interpretation

		const metadataSize = 1 + extLen + 4;

		// First part of file data lives inside the header bytes (after metadata)
		const fileDataPart1 = headerBytes.subarray(metadataSize);
		const part1Len = fileDataPart1.length;

		// Remaining data comes from LSB bits after the header
		const headerEndBit = 32 + headerBitCount;
		const remainingBytes = dataSize - part1Len;

		let fileData: Uint8Array;

		if (remainingBytes < 0) {
			// All data fits within header bytes
			fileData = fileDataPart1.slice(0, dataSize);
		} else if (remainingBytes > 0) {
			// Need more data from the LSB bit stream
			const dataBitCount = remainingBytes * 8;

			if (bitCount < headerEndBit + dataBitCount) {
				console.error('[TT-Decoder] Not enough bits for file data');
				return { data: null, extension: null };
			}

			const fileDataPart2 = bitsToBytes(flatBits, headerEndBit, dataBitCount);

			const combined = new Uint8Array(part1Len + fileDataPart2.length);
			combined.set(fileDataPart1, 0);
			combined.set(fileDataPart2, part1Len);
			fileData = combined;
		} else {
			fileData = new Uint8Array(fileDataPart1);
		}

		if (fileData.length !== dataSize) {
			console.error(`[TT-Decoder] Size mismatch. Expected ${dataSize}, got ${fileData.length}`);
			return { data: null, extension: null };
		}

		return { data: fileData, extension };
	} catch (e) {
		console.error('[TT-Decoder] Decode failed:', e);
		return { data: null, extension: null };
	}
}

/**
 * Convert a region of a bits array to packed bytes.
 * Unrolled inner loop for performance.
 */
function bitsToBytes(bits: Uint8Array, offset: number, bitCount: number): Uint8Array {
	const byteCount = Math.floor(bitCount / 8);
	const bytes = new Uint8Array(byteCount);

	for (let i = 0; i < byteCount; i++) {
		const base = offset + i * 8;
		bytes[i] =
			(bits[base] << 7) |
			(bits[base + 1] << 6) |
			(bits[base + 2] << 5) |
			(bits[base + 3] << 4) |
			(bits[base + 4] << 3) |
			(bits[base + 5] << 2) |
			(bits[base + 6] << 1) |
			bits[base + 7];
	}

	return bytes;
}
