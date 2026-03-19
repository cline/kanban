import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	getOpenCodeAuthPathCandidates,
	getOpenCodeConfigPathCandidates,
	getOpenCodeModelStatePathCandidates,
} from "../../../src/terminal/opencode-paths.js";

describe("opencode path candidates", () => {
	it("prioritizes explicit and env config paths before platform defaults", () => {
		const candidates = getOpenCodeConfigPathCandidates({
			explicitPath: " /tmp/custom-opencode.json ",
			homePath: "/home/dev",
			env: {
				OPENCODE_CONFIG: "/tmp/opencode-from-env.json",
				APPDATA: "C:\\Users\\dev\\AppData\\Roaming",
				LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local",
			} as NodeJS.ProcessEnv,
		});

		expect(candidates[0]).toBe("/tmp/custom-opencode.json");
		expect(candidates[1]).toBe("/tmp/opencode-from-env.json");
		expect(candidates).toContain(join("C:\\Users\\dev\\AppData\\Roaming", "opencode", "opencode.json"));
		expect(candidates).toContain(join("/home/dev", ".config", "opencode", "opencode.jsonc"));
	});

	it("includes Windows and Unix model/auth state paths", () => {
		const env = {
			APPDATA: "C:\\Users\\dev\\AppData\\Roaming",
			LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local",
		} as NodeJS.ProcessEnv;

		const modelStatePaths = getOpenCodeModelStatePathCandidates({ env, homePath: "/home/dev" });
		expect(modelStatePaths).toContain(
			join("C:\\Users\\dev\\AppData\\Local", "opencode", "state", "model.json"),
		);
		expect(modelStatePaths).toContain(join("/home/dev", ".local", "state", "opencode", "model.json"));

		const authPaths = getOpenCodeAuthPathCandidates({ env, homePath: "/home/dev" });
		expect(authPaths).toContain(join("C:\\Users\\dev\\AppData\\Roaming", "opencode", "auth.json"));
		expect(authPaths).toContain(join("/home/dev", ".local", "share", "opencode", "auth.json"));
	});
});
