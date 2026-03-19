import { EventEmitter } from "node:events";
import type { spawn } from "node:child_process";

import { describe, expect, it } from "vitest";

import { openInBrowser } from "../../src/server/browser.js";

class MockChildProcess extends EventEmitter {
	unrefCalled = false;

	unref(): this {
		this.unrefCalled = true;
		return this;
	}
}

function createMockSpawn(recorder: Array<{ command: string; args: string[]; child: MockChildProcess }>): typeof spawn {
	return ((command: string, args?: readonly string[]) => {
		const child = new MockChildProcess();
		recorder.push({
			command,
			args: args ? [...args] : [],
			child,
		});
		return child as unknown as ReturnType<typeof spawn>;
	}) as typeof spawn;
}

describe("openInBrowser", () => {
	it("falls back on linux when xdg-open is unavailable", () => {
		const spawned: Array<{ command: string; args: string[]; child: MockChildProcess }> = [];
		const warnings: string[] = [];

		openInBrowser("http://127.0.0.1:3484", {
			platform: "linux",
			spawnProcess: createMockSpawn(spawned),
			warn: (message) => {
				warnings.push(message);
			},
		});

		expect(spawned).toHaveLength(1);
		expect(spawned[0]?.command).toBe("xdg-open");
		expect(spawned[0]?.args).toEqual(["http://127.0.0.1:3484"]);
		expect(spawned[0]?.child.unrefCalled).toBe(true);

		expect(() => {
			spawned[0]?.child.emit("error", {
				code: "ENOENT",
			});
		}).not.toThrow();

		expect(spawned).toHaveLength(2);
		expect(spawned[1]?.command).toBe("gio");
		expect(spawned[1]?.args).toEqual(["open", "http://127.0.0.1:3484"]);
		expect(warnings).toEqual([]);
	});

	it("warns once when all linux browser commands are missing", () => {
		const spawned: Array<{ command: string; args: string[]; child: MockChildProcess }> = [];
		const warnings: string[] = [];

		openInBrowser("http://127.0.0.1:3484", {
			platform: "linux",
			spawnProcess: createMockSpawn(spawned),
			warn: (message) => {
				warnings.push(message);
			},
		});

		spawned[0]?.child.emit("error", { code: "ENOENT" });
		spawned[1]?.child.emit("error", { code: "ENOENT" });
		spawned[2]?.child.emit("error", { code: "ENOENT" });

		expect(spawned.map((entry) => entry.command)).toEqual(["xdg-open", "gio", "sensible-browser"]);
		expect(warnings).toEqual(["Could not open browser automatically. Open this URL manually: http://127.0.0.1:3484"]);
	});
});
