declare module 'pngjs' {
	interface PNGOptions {
		width?: number;
		height?: number;
		fill?: boolean;
		filterType?: number;
	}

	interface PNGData {
		width: number;
		height: number;
		data: Buffer;
	}

	class PNG {
		static sync: {
			read(buffer: Buffer): PNGData;
			write(png: PNGData): Buffer;
		};
		constructor(options?: PNGOptions);
		width: number;
		height: number;
		data: Buffer;
	}
}
