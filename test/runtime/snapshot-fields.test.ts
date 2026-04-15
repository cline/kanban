import { describe, expect, it } from "vitest";
import {
	type RuntimeStateStreamSnapshotMessage,
	runtimeStateStreamSnapshotMessageSchema,
} from "../../src/core/api-contract";
import type { RuntimeStartOptions } from "../../src/runtime-start";
import type { CreateRuntimeStateHubDependencies } from "../../src/server/runtime-state-hub";

describe("snapshot fields — isLocal and runtimeVersion", () => {
	describe("api-contract schema", () => {
		it("snapshot schema requires isLocal boolean field", () => {
			const validSnapshot: RuntimeStateStreamSnapshotMessage = {
				type: "snapshot",
				isLocal: true,
				runtimeVersion: "0.1.57",
				currentProjectId: null,
				projects: [],
				workspaceState: null,
				workspaceMetadata: null,
				clineSessionContextVersion: 0,
			};
			const result = runtimeStateStreamSnapshotMessageSchema.safeParse(validSnapshot);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.isLocal).toBe(true);
			}
		});

		it("snapshot schema requires runtimeVersion string field", () => {
			const validSnapshot: RuntimeStateStreamSnapshotMessage = {
				type: "snapshot",
				isLocal: false,
				runtimeVersion: "1.2.3",
				currentProjectId: null,
				projects: [],
				workspaceState: null,
				workspaceMetadata: null,
				clineSessionContextVersion: 0,
			};
			const result = runtimeStateStreamSnapshotMessageSchema.safeParse(validSnapshot);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.runtimeVersion).toBe("1.2.3");
			}
		});

		it("snapshot schema rejects payload missing isLocal", () => {
			const invalidSnapshot = {
				type: "snapshot",
				runtimeVersion: "0.1.0",
				currentProjectId: null,
				projects: [],
				workspaceState: null,
				workspaceMetadata: null,
				clineSessionContextVersion: 0,
			};
			const result = runtimeStateStreamSnapshotMessageSchema.safeParse(invalidSnapshot);
			expect(result.success).toBe(false);
		});

		it("snapshot schema rejects payload missing runtimeVersion", () => {
			const invalidSnapshot = {
				type: "snapshot",
				isLocal: true,
				currentProjectId: null,
				projects: [],
				workspaceState: null,
				workspaceMetadata: null,
				clineSessionContextVersion: 0,
			};
			const result = runtimeStateStreamSnapshotMessageSchema.safeParse(invalidSnapshot);
			expect(result.success).toBe(false);
		});

		it("isLocal: false is accepted by snapshot schema", () => {
			const snapshot: RuntimeStateStreamSnapshotMessage = {
				type: "snapshot",
				isLocal: false,
				runtimeVersion: "0.1.57",
				currentProjectId: null,
				projects: [],
				workspaceState: null,
				workspaceMetadata: null,
				clineSessionContextVersion: 0,
			};
			const result = runtimeStateStreamSnapshotMessageSchema.safeParse(snapshot);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.isLocal).toBe(false);
			}
		});
	});

	describe("CreateRuntimeStateHubDependencies", () => {
		it("requires isLocal and runtimeVersion fields", () => {
			const deps: Pick<CreateRuntimeStateHubDependencies, "isLocal" | "runtimeVersion"> = {
				isLocal: true,
				runtimeVersion: "0.1.57",
			};
			expect(deps.isLocal).toBe(true);
			expect(deps.runtimeVersion).toBe("0.1.57");
		});

		it("accepts isLocal: false", () => {
			const deps: Pick<CreateRuntimeStateHubDependencies, "isLocal" | "runtimeVersion"> = {
				isLocal: false,
				runtimeVersion: "1.0.0",
			};
			expect(deps.isLocal).toBe(false);
		});
	});

	describe("RuntimeStartOptions", () => {
		it("isLocal defaults to undefined when not set", () => {
			const options: RuntimeStartOptions = {};
			expect(options.isLocal).toBeUndefined();
		});

		it("accepts isLocal: true", () => {
			const options: RuntimeStartOptions = { isLocal: true };
			expect(options.isLocal).toBe(true);
		});

		it("accepts isLocal: false", () => {
			const options: RuntimeStartOptions = { isLocal: false };
			expect(options.isLocal).toBe(false);
		});
	});

	describe("runtimeVersion reading", () => {
		it("package.json version is a non-empty string", async () => {
			const { readFileSync } = await import("node:fs");
			const { join } = await import("node:path");
			const packageJsonPath = join(__dirname, "..", "..", "package.json");
			const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version: string };
			expect(typeof packageJson.version).toBe("string");
			expect(packageJson.version.length).toBeGreaterThan(0);
			expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+/);
		});
	});

	describe("startRuntime exports", () => {
		it("startRuntime function is exported", async () => {
			const mod = await import("../../src/runtime-start");
			expect(typeof mod.startRuntime).toBe("function");
		});

		it("RuntimeStartOptions type supports isLocal field", () => {
			// Type-level check: if this compiles, the field exists on RuntimeStartOptions
			const opts: RuntimeStartOptions = { isLocal: false, callbacks: { warn: () => {} } };
			expect(opts.isLocal).toBe(false);
		});
	});
});
