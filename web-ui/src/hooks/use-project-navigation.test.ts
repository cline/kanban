import { describe, expect, it } from "vitest";

import {
	isDirectoryPickerUnavailableErrorMessage,
	parseRemovedProjectPathFromStreamError,
} from "@/hooks/use-project-navigation";

describe("parseRemovedProjectPathFromStreamError", () => {
	it("extracts removed project paths", () => {
		expect(
			parseRemovedProjectPathFromStreamError("Project no longer exists on disk and was removed: /tmp/project"),
		).toBe("/tmp/project");
	});

	it("returns null when prefix is not present", () => {
		expect(parseRemovedProjectPathFromStreamError("Something else happened")).toBeNull();
	});
});

describe("isDirectoryPickerUnavailableErrorMessage", () => {
	it("detects headless Linux picker failures", () => {
		expect(
			isDirectoryPickerUnavailableErrorMessage(
				'Could not open directory picker. Install "zenity" or "kdialog" and try again.',
			),
		).toBe(true);
	});

	it("detects other platform picker-unavailable errors", () => {
		expect(
			isDirectoryPickerUnavailableErrorMessage(
				'Could not open directory picker. Install PowerShell ("powershell" or "pwsh") and try again.',
			),
		).toBe(true);
		expect(
			isDirectoryPickerUnavailableErrorMessage(
				'Could not open directory picker. Command "osascript" is not available.',
			),
		).toBe(true);
	});

	it("does not treat cancellation as unavailable", () => {
		expect(isDirectoryPickerUnavailableErrorMessage("No directory was selected.")).toBe(false);
	});
});
