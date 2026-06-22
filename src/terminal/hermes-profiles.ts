import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

function getHermesRoot(): string {
	const configuredHome = process.env.HERMES_HOME;
	if (!configuredHome) return join(homedir(), ".hermes");
	return basename(dirname(configuredHome)) === "profiles" ? dirname(dirname(configuredHome)) : configuredHome;
}

export function resolveHermesProfileHome(profile: string): string {
	const normalizedProfile = profile.trim().toLowerCase();
	const root = getHermesRoot();
	return normalizedProfile === "default" ? root : join(root, "profiles", normalizedProfile);
}

export async function listHermesProfiles(): Promise<string[]> {
	const profiles = ["default"];
	try {
		const entries = await readdir(join(getHermesRoot(), "profiles"), { withFileTypes: true });
		profiles.push(
			...entries
				.filter((entry) => entry.isDirectory() && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(entry.name))
				.map((entry) => entry.name)
				.sort((left, right) => left.localeCompare(right)),
		);
	} catch {
		// The built-in default profile exists without a profiles directory.
	}
	return profiles;
}
