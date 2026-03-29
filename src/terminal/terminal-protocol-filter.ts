const ESC = 0x1b;
const BEL = 0x07;
const OSC_INTRODUCER = 0x5d;
const CSI_INTRODUCER = 0x5b;
const STRING_TERMINATOR = 0x5c;
const DEVICE_ATTRIBUTES_FINAL = 0x63;

export interface TerminalProtocolFilterState {
	pendingChunk: Buffer | null;
	interceptOscColorQueries: boolean;
	suppressDeviceAttributeQueries: boolean;
}

export interface CreateTerminalProtocolFilterStateOptions {
	interceptOscColorQueries?: boolean;
	suppressDeviceAttributeQueries?: boolean;
}

export interface FilterTerminalProtocolOutputOptions {
	onOsc10ForegroundQuery?: () => void;
	onOsc11BackgroundQuery?: () => void;
}

export function createTerminalProtocolFilterState(
	options: CreateTerminalProtocolFilterStateOptions = {},
): TerminalProtocolFilterState {
	return {
		pendingChunk: null,
		interceptOscColorQueries: options.interceptOscColorQueries ?? false,
		suppressDeviceAttributeQueries: options.suppressDeviceAttributeQueries ?? false,
	};
}

export function disableOscColorQueryIntercept(state: TerminalProtocolFilterState): void {
	state.interceptOscColorQueries = false;
}

function isCsiFinalByte(byte: number): boolean {
	return byte >= 0x40 && byte <= 0x7e;
}

function shouldSuppressDeviceAttributeQuery(
	state: TerminalProtocolFilterState,
	sequenceBody: Buffer,
	finalByte: number,
): boolean {
	if (!state.suppressDeviceAttributeQueries || finalByte !== DEVICE_ATTRIBUTES_FINAL) {
		return false;
	}
	const body = sequenceBody.toString("utf8");
	return body === "" || body === "0" || body === ">" || body === ">0";
}

export function filterTerminalProtocolOutput(
	state: TerminalProtocolFilterState,
	incoming: Buffer,
	options: FilterTerminalProtocolOutputOptions = {},
): Buffer {
	const pending = state.pendingChunk;
	const pendingLength = pending?.byteLength ?? 0;
	const source = pendingLength > 0 ? Buffer.concat([pending as Buffer, incoming]) : incoming;
	state.pendingChunk = null;

	let cursor = 0;
	let segmentStart = 0;
	const segments: Buffer[] = [];

	while (cursor < source.byteLength) {
		const next = cursor + 1;
		if (source[cursor] !== ESC) {
			cursor += 1;
			continue;
		}
		if (next >= source.byteLength) {
			if (cursor > segmentStart) {
				segments.push(source.subarray(segmentStart, cursor));
			}
			state.pendingChunk = source.subarray(cursor);
			segmentStart = source.byteLength;
			break;
		}

		const introducer = source[next];
		if (introducer === OSC_INTRODUCER) {
			const sequenceStart = cursor;
			if (sequenceStart > segmentStart) {
				segments.push(source.subarray(segmentStart, sequenceStart));
			}

			let sequenceEnd = -1;
			let contentEnd = -1;
			let index = sequenceStart + 2;
			while (index < source.byteLength) {
				const byte = source[index];
				if (byte === BEL) {
					contentEnd = index;
					sequenceEnd = index + 1;
					break;
				}
				if (byte === ESC && index + 1 < source.byteLength && source[index + 1] === STRING_TERMINATOR) {
					contentEnd = index;
					sequenceEnd = index + 2;
					break;
				}
				index += 1;
			}

			if (sequenceEnd === -1 || contentEnd === -1) {
				state.pendingChunk = source.subarray(sequenceStart);
				segmentStart = source.byteLength;
				break;
			}

			const content = source.subarray(sequenceStart + 2, contentEnd).toString("utf8");
			if (state.interceptOscColorQueries && content === "10;?") {
				options.onOsc10ForegroundQuery?.();
			} else if (state.interceptOscColorQueries && content === "11;?") {
				options.onOsc11BackgroundQuery?.();
			} else {
				segments.push(source.subarray(sequenceStart, sequenceEnd));
			}

			segmentStart = sequenceEnd;
			cursor = sequenceEnd;
			continue;
		}

		if (introducer === CSI_INTRODUCER) {
			const sequenceStart = cursor;
			if (sequenceStart > segmentStart) {
				segments.push(source.subarray(segmentStart, sequenceStart));
			}

			let finalIndex = -1;
			let index = sequenceStart + 2;
			while (index < source.byteLength) {
				if (isCsiFinalByte(source[index])) {
					finalIndex = index;
					break;
				}
				index += 1;
			}

			if (finalIndex === -1) {
				state.pendingChunk = source.subarray(sequenceStart);
				segmentStart = source.byteLength;
				break;
			}

			const finalByte = source[finalIndex] as number;
			if (!shouldSuppressDeviceAttributeQuery(state, source.subarray(sequenceStart + 2, finalIndex), finalByte)) {
				segments.push(source.subarray(sequenceStart, finalIndex + 1));
			}

			segmentStart = finalIndex + 1;
			cursor = finalIndex + 1;
			continue;
		}

		cursor += 1;
	}

	if (segmentStart < source.byteLength) {
		segments.push(source.subarray(segmentStart));
	}

	if (segments.length === 0) {
		return Buffer.alloc(0);
	}
	if (segments.length === 1) {
		return segments[0] as Buffer;
	}
	return Buffer.concat(segments);
}
