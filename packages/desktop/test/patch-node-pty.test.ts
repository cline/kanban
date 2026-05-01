import { describe, expect, it } from "vitest";

// The patch script is an `.mjs` with pure logic exported; we drive it with
// fixture strings here so that the test does not depend on — or mutate —
// the installed node-pty in node_modules.
import {
	REPLACEMENTS,
	patchContent,
	// @ts-expect-error — .mjs has no .d.ts; tsconfig.build.json excludes scripts/
} from "../scripts/patch-node-pty.mjs";

const PRE_APP_ASAR = `helperPath.replace('app.asar', 'app.asar.unpacked')`;
const POST_APP_ASAR = `helperPath.replace(/app\\.asar(?!\\.unpacked)/, 'app.asar.unpacked')`;
const PRE_NODE_MODULES = `helperPath.replace('node_modules.asar', 'node_modules.asar.unpacked')`;
const POST_NODE_MODULES = `helperPath.replace(/node_modules\\.asar(?!\\.unpacked)/, 'node_modules.asar.unpacked')`;

type Result = { name: string; status: "patched" | "already" | "drift" };

describe("patch-node-pty", () => {
	describe("REPLACEMENTS config", () => {
		it("has entries for both app.asar and node_modules.asar", () => {
			const names = (REPLACEMENTS as Array<{ name: string }>).map((r) => r.name);
			expect(names).toContain("app.asar → app.asar.unpacked");
			expect(names).toContain("node_modules.asar → node_modules.asar.unpacked");
		});

		it("every entry's post pattern survives its own transform (idempotent)", () => {
			// Guards against a REPLACEMENTS edit where `post` accidentally still
			// matches `pre` — which would make the script mis-detect "already"
			// as "drift" and the reverse on re-runs.
			for (const entry of REPLACEMENTS as Array<{ pre: string; post: string }>) {
				expect(entry.post).not.toContain(entry.pre);
			}
		});
	});

	describe("patchContent()", () => {
		it("transforms pre-patch source into post-patch source", () => {
			const src = `prefix\n${PRE_APP_ASAR}\nmiddle\n${PRE_NODE_MODULES}\nsuffix`;
			const { content, results } = patchContent(src) as {
				content: string;
				results: Result[];
			};

			expect(content).toContain(POST_APP_ASAR);
			expect(content).toContain(POST_NODE_MODULES);
			expect(content).not.toContain(PRE_APP_ASAR);
			expect(content).not.toContain(PRE_NODE_MODULES);
			expect(results.map((r) => r.status)).toEqual(["patched", "patched"]);
		});

		it("is a no-op on already-patched source (idempotent re-run)", () => {
			const src = `${POST_APP_ASAR}\n${POST_NODE_MODULES}`;
			const { content, results } = patchContent(src) as {
				content: string;
				results: Result[];
			};

			expect(content).toBe(src);
			expect(results.map((r) => r.status)).toEqual(["already", "already"]);
		});

		it("reports 'drift' for every replacement missing from source", () => {
			// Simulates an upstream node-pty rewrite that no longer contains
			// either the pre- or post-patch pattern. The caller is expected to
			// escalate this to a hard failure (see scripts/patch-node-pty.mjs).
			const src = `// node-pty source completely changed; no matching patterns`;
			const { content, results } = patchContent(src) as {
				content: string;
				results: Result[];
			};

			expect(content).toBe(src);
			expect(results.map((r) => r.status)).toEqual(["drift", "drift"]);
		});

		it("handles mixed state (one already-patched, one still pre-patch)", () => {
			// Belt-and-suspenders: if a future upstream patch partially changes
			// one call but leaves the other, the script should still converge
			// on a fully-patched file without false drift.
			const src = `${POST_APP_ASAR}\n${PRE_NODE_MODULES}`;
			const { content, results } = patchContent(src) as {
				content: string;
				results: Result[];
			};

			expect(content).toContain(POST_APP_ASAR);
			expect(content).toContain(POST_NODE_MODULES);
			expect(content).not.toContain(PRE_NODE_MODULES);
			expect(results.map((r) => r.status)).toEqual(["already", "patched"]);
		});

		it("reports per-entry drift when only one of two patterns is missing", () => {
			const src = `${PRE_APP_ASAR}\n// node_modules.asar call removed upstream`;
			const { results } = patchContent(src) as { results: Result[] };

			expect(results.map((r) => r.status)).toEqual(["patched", "drift"]);
		});
	});
});
