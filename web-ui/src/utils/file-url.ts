export function toFileUrl(path: string): string {
	const trimmedPath = path.trim();
	if (trimmedPath.length === 0) {
		return "file:///";
	}

	if (trimmedPath.startsWith("file://")) {
		try {
			return new URL(trimmedPath).toString();
		} catch {
			return trimmedPath;
		}
	}

	const normalizedPath = trimmedPath.replaceAll("\\", "/");

	if (normalizedPath.startsWith("//")) {
		return new URL(`file:${normalizedPath}`).toString();
	}

	const pathWithLeadingSlash = /^[A-Za-z]:\//.test(normalizedPath)
		? `/${normalizedPath}`
		: normalizedPath.startsWith("/")
			? normalizedPath
			: `/${normalizedPath}`;

	return new URL(`file://${pathWithLeadingSlash}`).toString();
}
