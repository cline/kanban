import { describe, expect, it } from "vitest";
import { RuntimeChildManager } from "../src/runtime-child.js";

describe("RuntimeChildManager", () => {
	it("can be constructed with required options", () => {
		const manager = new RuntimeChildManager({
			childScriptPath: "/path/to/runtime-child.js",
		});
		expect(manager).toBeInstanceOf(RuntimeChildManager);
	});

	it("start() throws not-implemented error (stub)", async () => {
		const manager = new RuntimeChildManager({
			childScriptPath: "/path/to/runtime-child.js",
		});
		await expect(
			manager.start({ host: "127.0.0.1", port: "auto", authToken: "token" }),
		).rejects.toThrow("not yet implemented");
	});

	it("shutdown() throws not-implemented error (stub)", async () => {
		const manager = new RuntimeChildManager({
			childScriptPath: "/path/to/runtime-child.js",
		});
		await expect(manager.shutdown()).rejects.toThrow("not yet implemented");
	});
});
