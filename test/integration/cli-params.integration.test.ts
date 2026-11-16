import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGitTestEnv } from "../utilities/git-env";
import { createTempDir } from "../utilities/temp-dir";

const requireFromHere = createRequire(import.meta.url);

function resolveTsxLoaderImportSpecifier(): string {
	return pathToFileURL(requireFromHere.resolve("tsx")).href;
}

const CLI_ENTRYPOINT = resolve(process.cwd(), "src/cli.ts");

/**
 * Collect stdout/stderr from a short-lived CLI spawn until a marker line appears,
 * then kill the process and return the captured output.
 */
function captureStartupOutput(args: string[], envOverrides?: Record<string, string>): Promise<string> {
	return new Promise<string>((resolveOutput) => {
		const child = spawn(process.execPath, ["--import", resolveTsxLoaderImportSpecifier(), CLI_ENTRYPOINT, ...args], {
			env: createGitTestEnv(envOverrides),
			stdio: "pipe",
		});

		const chunks: string[] = [];
		let resolved = false;

		child.stdout.on("data", (data: Buffer) => {
			const text = data.toString();
			chunks.push(text);
			if (!resolved && text.includes("running at")) {
				resolved = true;
				child.kill("SIGTERM");
				resolveOutput(chunks.join(""));
			}
		});

		child.stderr.on("data", (data: Buffer) => {
			chunks.push(data.toString());
		});

		child.on("exit", () => {
			if (!resolved) {
				resolved = true;
				resolveOutput(chunks.join(""));
			}
		});

		// Safety timeout: kill after 15s regardless.
		setTimeout(() => {
			if (!resolved) {
				resolved = true;
				child.kill("SIGKILL");
				resolveOutput(chunks.join(""));
			}
		}, 15_000);
	});
}

describe("cli --no-passcode flag", () => {
	let homeDir: string;
	let cleanupHome: () => void;

	beforeAll(() => {
		({ path: homeDir, cleanup: cleanupHome } = createTempDir("kanban-cli-params-home-"));
	});

	afterAll(() => {
		cleanupHome();
	});

	it("prints passcode when --no-passcode is NOT passed (remote host)", async () => {
		const output = await captureStartupOutput(["--host", "0.0.0.0", "--no-open"], { HOME: homeDir });
		expect(output).toContain("Remote access passcode:");
		expect(output).not.toContain("Passcode authentication disabled");
	}, 20_000);

	it("disables passcode when --no-passcode IS passed (remote host)", async () => {
		const output = await captureStartupOutput(["--host", "0.0.0.0", "--no-passcode", "--no-open"], { HOME: homeDir });
		expect(output).toContain("Passcode authentication disabled");
		expect(output).not.toContain("Remote access passcode:");
	}, 20_000);
});
