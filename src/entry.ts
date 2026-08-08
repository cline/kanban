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
 *
 * Runtime bootstrap: the `@clinebot/core` daemon entry references a bare global
 * `AI` (the Vercel AI SDK namespace) at module-evaluation time via an
 * __exportStar-style helper (`C(L, AI)`). When this module runs as the
 * hub-daemon main process (`node dist/entry.js`), that global is not defined,
 * which surfaces as `ReferenceError: AI is not defined`. We therefore
 * establish `globalThis.AI` (the installed `ai` package) here, before importing
 * the core entry, so the daemon can load and start. This is a no-op when the
 * global is already provided by a host launcher.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Establish the globalThis.AI namespace (Vercel AI SDK) required by the
// embedded @clinebot/core daemon entry at evaluation time. Prefer the public
// bare specifier; fall back to the nested file if the exports map is not
// honored. No-op if already provided.
if (typeof (globalThis as { AI?: unknown }).AI === "undefined") {
  try {
    (globalThis as { AI?: unknown }).AI = await import("ai");
  } catch {
    (globalThis as { AI?: unknown }).AI = await import(
      join(__dirname, "..", "node_modules", "ai", "dist", "index.mjs")
    );
  }
}

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
