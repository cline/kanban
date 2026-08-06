/**
 * Hub daemon spawn target.
 *
 * The kanban CLI launches the hub daemon from `dist/entry.js` (resolved
 * relative to the package root). The actual daemon implementation is shipped
 * inside the embedded `@clinebot/core` SDK, whose `package.json` exports map
 * exposes it as the public subpath `@clinebot/core/hub/daemon-entry`.
 *
 * This file is ESM (`kanban` package.json has `"type": "module"`). Do not use
 * CommonJS `require()` / `module.exports` here — Node loads `.js` files in an
 * ESM package as modules, so `require` is not defined.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mod: Record<string, unknown>;
try {
	// Primary: honor the @clinebot/core exports map. The deep path
	// `@clinebot/core/dist/hub/daemon/entry.js` is blocked by the `exports`
	// field, so we must use the public subpath.
	mod = (await import("@clinebot/core/hub/daemon-entry")) as Record<string, unknown>;
} catch {
	// Fallback: resolve the nested file directly relative to this module's
	// location, bypassing the exports map (for environments that don't honor it).
	const candidate = join(
		__dirname,
		"..",
		"node_modules",
		"@clinebot",
		"core",
		"dist",
		"hub",
		"daemon",
		"entry.js",
	);
	mod = (await import(candidate)) as Record<string, unknown>;
}

const defaultExport = (mod as { default?: unknown }).default ?? mod;

export default defaultExport;
export const __esModule = true;
