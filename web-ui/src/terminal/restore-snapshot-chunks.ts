/** xterm parse budget for restore writes, not a second scrollback cap. */
export const RESTORE_WRITE_CHUNK_BYTES = 16 * 1024;

export function splitRestoreSnapshot(snapshot: string, chunkBytes: number = RESTORE_WRITE_CHUNK_BYTES): string[] {
	if (snapshot.length === 0) {
		return [];
	}

	const encoder = new TextEncoder();
	const parts: string[] = [];
	let start = 0;
	let usedBytes = 0;
	let index = 0;

	while (index < snapshot.length) {
		const codePoint = snapshot.codePointAt(index);
		if (codePoint === undefined) {
			break;
		}
		const char = String.fromCodePoint(codePoint);
		const charBytes = encoder.encode(char).byteLength;
		if (usedBytes > 0 && usedBytes + charBytes > chunkBytes) {
			parts.push(snapshot.slice(start, index));
			start = index;
			usedBytes = 0;
		}
		usedBytes += charBytes;
		index += char.length;
	}

	if (start < snapshot.length) {
		parts.push(snapshot.slice(start));
	}

	return parts;
}
