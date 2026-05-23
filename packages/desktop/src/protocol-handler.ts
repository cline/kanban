export const KANBAN_PROTOCOL = "kanban";
export const OAUTH_CALLBACK_PATH = "/oauth/callback";

interface ParsedProtocolUrl {
	raw: string;
	pathname: string;
	searchParams: URLSearchParams;
	isOAuthCallback: boolean;
}

export function parseProtocolUrl(raw: string): ParsedProtocolUrl | null {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}

	if (url.protocol !== `${KANBAN_PROTOCOL}:`) {
		return null;
	}

	// `kanban:` isn't a WHATWG "special" scheme, so `new URL("kanban://oauth/callback")`
	// parses "oauth" as the hostname and "/callback" as the pathname. Re-join
	// so downstream consumers see `/oauth/callback`.
	const pathname = `/${url.hostname}${url.pathname}`.replace(/\/+$/, "") || "/";

	return {
		raw,
		pathname,
		searchParams: url.searchParams,
		isOAuthCallback: pathname === OAUTH_CALLBACK_PATH,
	};
}

export interface ElectronAppLike {
	setAsDefaultProtocolClient(protocol: string): boolean;
	isDefaultProtocolClient(protocol: string): boolean;
}

export function registerProtocol(electronApp: ElectronAppLike): boolean {
	if (electronApp.isDefaultProtocolClient(KANBAN_PROTOCOL)) {
		return true;
	}
	return electronApp.setAsDefaultProtocolClient(KANBAN_PROTOCOL);
}

export function extractProtocolUrlFromArgv(argv: readonly string[]): string | null {
	const prefix = `${KANBAN_PROTOCOL}://`;
	for (const arg of argv) {
		if (arg.startsWith(prefix)) {
			return arg;
		}
	}
	return null;
}
