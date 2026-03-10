export function isTerminalDeviceAttributesResponse(input: string): boolean {
	if (!input.startsWith("\u001b[") || !input.endsWith("c")) {
		return false;
	}
	const marker = input[2];
	if (marker !== "?" && marker !== ">") {
		return false;
	}
	const payload = input.slice(3, -1);
	if (payload.length === 0) {
		return false;
	}
	return /^[0-9;]+$/u.test(payload);
}
