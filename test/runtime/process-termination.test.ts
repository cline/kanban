import { describe, expect, it, vi } from "vitest";

import { terminateProcessForTimeout } from "../../src/server/process-termination.js";

describe("terminateProcessForTimeout", () => {
	it("uses SIGTERM on non-windows platforms", () => {
		const kill = vi.fn(() => true);
		const killProcessTree = vi.fn();

		terminateProcessForTimeout(
			{
				pid: 123,
				kill,
			},
			{
				platform: "linux",
				killProcessTree,
			},
		);

		expect(kill).toHaveBeenCalledWith("SIGTERM");
		expect(killProcessTree).not.toHaveBeenCalled();
	});

	it("uses default kill and taskkill tree on windows", () => {
		const kill = vi.fn(() => true);
		const killProcessTree = vi.fn();

		terminateProcessForTimeout(
			{
				pid: 456,
				kill,
			},
			{
				platform: "win32",
				killProcessTree,
			},
		);

		expect(kill).toHaveBeenCalledWith();
		expect(killProcessTree).toHaveBeenCalledWith(456, "SIGTERM", expect.any(Function));
	});

	it("skips taskkill tree when pid is missing on windows", () => {
		const kill = vi.fn(() => true);
		const killProcessTree = vi.fn();

		terminateProcessForTimeout(
			{
				kill,
			},
			{
				platform: "win32",
				killProcessTree,
			},
		);

		expect(kill).toHaveBeenCalledWith();
		expect(killProcessTree).not.toHaveBeenCalled();
	});
});
