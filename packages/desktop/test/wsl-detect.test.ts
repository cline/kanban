import { describe, expect, it } from "vitest";
import {
	parseWslListOutput,
	detectWsl,
	buildWslCommand,
	type ExecFn,
} from "../src/wsl-detect.js";

// ---------------------------------------------------------------------------
// parseWslListOutput
// ---------------------------------------------------------------------------

describe("parseWslListOutput", () => {
	it("parses typical `wsl --list --verbose` output", () => {
		const raw = [
			"  NAME            STATE           VERSION",
			"* Ubuntu          Running         2",
			"  Debian          Stopped         2",
		].join("\r\n");

		const distros = parseWslListOutput(raw);
		expect(distros).toEqual([
			{ name: "Ubuntu", isDefault: true },
			{ name: "Debian", isDefault: false },
		]);
	});

	it("handles single distro output", () => {
		const raw = [
			"  NAME      STATE    VERSION",
			"* Ubuntu    Running  2",
		].join("\n");

		const distros = parseWslListOutput(raw);
		expect(distros).toEqual([{ name: "Ubuntu", isDefault: true }]);
	});

	it("returns empty array for empty input", () => {
		expect(parseWslListOutput("")).toEqual([]);
	});

	it("returns empty array when only a header is present", () => {
		expect(parseWslListOutput("  NAME  STATE  VERSION")).toEqual([]);
	});

	it("handles output without a default marker", () => {
		const raw = [
			"  NAME      STATE    VERSION",
			"  Ubuntu    Running  2",
			"  Debian    Stopped  2",
		].join("\n");

		const distros = parseWslListOutput(raw);
		expect(distros).toHaveLength(2);
		expect(distros.every((d) => !d.isDefault)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// detectWsl
// ---------------------------------------------------------------------------

describe("detectWsl", () => {
	it("returns unavailable on non-Windows platforms", () => {
		const result = detectWsl({ platform: "darwin" });
		expect(result.available).toBe(false);
		expect(result.unavailableReason).toContain("Windows");
	});

	it("returns unavailable when wsl.exe --status throws", () => {
		const exec: ExecFn = (cmd, args) => {
			if (args.includes("--status")) throw new Error("not found");
			return "";
		};
		const result = detectWsl({ platform: "win32", exec });
		expect(result.available).toBe(false);
		expect(result.unavailableReason).toContain("installed");
	});

	it("returns unavailable when --list --verbose throws", () => {
		const exec: ExecFn = (_cmd, args) => {
			if (args.includes("--status")) return "ok";
			throw new Error("list failed");
		};
		const result = detectWsl({ platform: "win32", exec });
		expect(result.available).toBe(false);
		expect(result.unavailableReason).toContain("listed");
	});

	it("returns unavailable when no distros are found", () => {
		const exec: ExecFn = (_cmd, args) => {
			if (args.includes("--status")) return "ok";
			return "  NAME  STATE  VERSION\n";
		};
		const result = detectWsl({ platform: "win32", exec });
		expect(result.available).toBe(false);
		expect(result.unavailableReason).toContain("no Linux distributions");
	});

	it("returns available with distros when WSL is properly set up", () => {
		const exec: ExecFn = (_cmd, args) => {
			if (args.includes("--status")) return "ok";
			return [
				"  NAME      STATE    VERSION",
				"* Ubuntu    Running  2",
				"  Debian    Stopped  2",
			].join("\n");
		};
		const result = detectWsl({ platform: "win32", exec });
		expect(result.available).toBe(true);
		expect(result.distros).toHaveLength(2);
		expect(result.defaultDistro).toBe("Ubuntu");
		expect(result.unavailableReason).toBeUndefined();
	});

	it("falls back to first distro if no default marker", () => {
		const exec: ExecFn = (_cmd, args) => {
			if (args.includes("--status")) return "ok";
			return [
				"  NAME      STATE    VERSION",
				"  Alpine    Stopped  2",
			].join("\n");
		};
		const result = detectWsl({ platform: "win32", exec });
		expect(result.available).toBe(true);
		expect(result.defaultDistro).toBe("Alpine");
	});
});

// ---------------------------------------------------------------------------
// buildWslCommand
// ---------------------------------------------------------------------------

describe("buildWslCommand", () => {
	it("builds the correct command structure", () => {
		const result = buildWslCommand("Ubuntu", "npx", [
			"kanban",
			"--port",
			"auto",
		]);
		expect(result.file).toBe("wsl.exe");
		expect(result.args).toEqual([
			"-d",
			"Ubuntu",
			"--",
			"npx",
			"kanban",
			"--port",
			"auto",
		]);
	});

	it("works with empty args", () => {
		const result = buildWslCommand("Debian", "ls", []);
		expect(result.args).toEqual(["-d", "Debian", "--", "ls"]);
	});
});
