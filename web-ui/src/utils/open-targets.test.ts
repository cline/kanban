import { describe, expect, it } from "vitest";
import { buildOpenCommand, getOpenTargetOption, getOpenTargetOptions } from "@/utils/open-targets";

describe("open-targets", () => {
	it("filters unsupported options on windows", () => {
		const windowsOptions = getOpenTargetOptions("windows");
		expect(windowsOptions.some((option) => option.id === "iterm2")).toBe(false);
		expect(windowsOptions.some((option) => option.id === "xcode")).toBe(false);
		expect(windowsOptions.some((option) => option.id === "finder")).toBe(true);
	});

	it("falls back to default option when selected target is unsupported on platform", () => {
		const selected = getOpenTargetOption("iterm2", "linux");
		expect(selected.id).toBe("vscode");
	});

	it("builds a macOS app-open command", () => {
		expect(buildOpenCommand("vscode", "/tmp/repo", "mac")).toBe("open -a 'Visual Studio Code' '/tmp/repo'");
	});

	it("builds a linux file manager command", () => {
		expect(buildOpenCommand("finder", "/tmp/my repo", "linux")).toBe("xdg-open '/tmp/my repo'");
	});

	it("builds a windows file explorer command", () => {
		expect(buildOpenCommand("finder", "C:\\Users\\dev\\my repo", "windows")).toBe(
			'explorer "C:\\Users\\dev\\my repo"',
		);
	});

	it("falls back to default command when target is unsupported on windows", () => {
		expect(buildOpenCommand("iterm2", "C:\\Users\\dev\\my repo", "windows")).toBe('code "C:\\Users\\dev\\my repo"');
	});
});
