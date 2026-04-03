import { describe, expect, it } from "vitest";
import { RuntimeChildManager } from "../src/runtime-child.js";

describe("RuntimeChildManager (basic)", () => {
	it("can be constructed with required options", () => {
		const manager = new RuntimeChildManager({
			childScriptPath: "/path/to/runtime-child.js",
		});
		expect(manager).toBeInstanceOf(RuntimeChildManager);
	});

	it("reports running=false before start", () => {
		const manager = new RuntimeChildManager({
			childScriptPath: "/path/to/runtime-child.js",
		});
		expect(manager.running).toBe(false);
	});

	it("shutdown() is a no-op when no child is running", async () => {
		const manager = new RuntimeChildManager({
			childScriptPath: "/path/to/runtime-child.js",
		});
		// Should not throw — it's a no-op when nothing is running
		await manager.shutdown();
	});
});
