import { spawn } from "node:child_process";
import { terminateProcessForTimeout } from "./process-termination";

interface DirectoryPickerCommandCandidate {
	command: string;
	args: string[];
}

type DirectoryPickerCommandResult =
	| { kind: "selected"; path: string }
	| { kind: "cancelled" }
	| { kind: "unavailable" };

interface DirectoryPickerCommandExecutionResult {
	stdout: string;
	stderr: string;
	status: number | null;
	signal: NodeJS.Signals | null;
	error?: NodeJS.ErrnoException;
}

type RunCommand = (command: string, args: string[]) => Promise<DirectoryPickerCommandExecutionResult>;

interface PickDirectoryPathFromSystemDialogOptions {
	platform?: NodeJS.Platform;
	cwd?: string;
	timeoutMs?: number;
	runCommand?: RunCommand;
}

const DEFAULT_DIRECTORY_PICKER_TIMEOUT_MS = 5 * 60 * 1000;
const DIRECTORY_PICKER_CLOSE_GRACE_MS = 1_000;

const WINDOWS_DIRECTORY_PICKER_SCRIPT = [
	"$ErrorActionPreference = 'Stop'",
	"Add-Type -AssemblyName System.Windows.Forms",
	"Add-Type -AssemblyName System.Drawing",
	"[System.Windows.Forms.Application]::EnableVisualStyles()",
	"$owner = $null",
	"try {",
	"$owner = New-Object System.Windows.Forms.Form",
	"$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen",
	"$owner.Size = New-Object System.Drawing.Size(1, 1)",
	"$owner.Opacity = 0",
	"$owner.ShowInTaskbar = $false",
	"$owner.TopMost = $true",
	"$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow",
	"$owner.Show()",
	"$owner.Activate()",
	"$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
	"$dialog.Description = 'Select a project folder'",
	"$dialog.ShowNewFolderButton = $false",
	"$dialogResult = $dialog.ShowDialog($owner)",
	"if ($dialogResult -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }",
	"} finally {",
	"if ($owner -ne $null) { $owner.Close(); $owner.Dispose() }",
	"}",
].join("; ");

function parseChildProcessErrorCode(error: unknown): string | null {
	if (!error || typeof error !== "object" || !("code" in error)) {
		return null;
	}
	const code = (error as NodeJS.ErrnoException).code;
	return typeof code === "string" ? code : null;
}

function createDirectoryPickerTimeoutError(timeoutMs: number): NodeJS.ErrnoException {
	return Object.assign(new Error(`Directory picker timed out after ${timeoutMs}ms.`), {
		code: "ETIMEDOUT",
	}) as NodeJS.ErrnoException;
}

async function defaultRunCommand(
	command: string,
	args: string[],
	options: {
		platform: NodeJS.Platform;
		timeoutMs: number;
	},
): Promise<DirectoryPickerCommandExecutionResult> {
	return await new Promise((resolve) => {
		const child = spawn(command, args, {
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: false,
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		let pendingError: NodeJS.ErrnoException | undefined;
		let closeGraceHandle: NodeJS.Timeout | null = null;
		const timeoutHandle =
			options.timeoutMs > 0
				? setTimeout(() => {
						pendingError ??= createDirectoryPickerTimeoutError(options.timeoutMs);
						terminateProcessForTimeout(child, {
							platform: options.platform,
						});
						closeGraceHandle = setTimeout(() => {
							finish({
								stdout,
								stderr,
								status: null,
								signal: null,
								error: pendingError,
							});
						}, DIRECTORY_PICKER_CLOSE_GRACE_MS);
					}, options.timeoutMs)
				: null;

		const finish = (result: DirectoryPickerCommandExecutionResult): void => {
			if (settled) {
				return;
			}
			settled = true;
			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
			}
			if (closeGraceHandle) {
				clearTimeout(closeGraceHandle);
			}
			resolve(result);
		};

		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			stdout += chunk;
		});

		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => {
			stderr += chunk;
		});

		child.once("error", (error) => {
			pendingError ??= error as NodeJS.ErrnoException;
		});

		child.once("close", (status, signal) => {
			finish({
				stdout,
				stderr,
				status,
				signal,
				error: pendingError,
			});
		});
	});
}

async function runDirectoryPickerCommand(
	candidate: DirectoryPickerCommandCandidate,
	runCommand: RunCommand,
): Promise<DirectoryPickerCommandResult> {
	const result = await runCommand(candidate.command, candidate.args);

	const errorCode = parseChildProcessErrorCode(result.error);
	if (errorCode === "ENOENT") {
		return { kind: "unavailable" };
	}

	if (result.error) {
		const message = result.error.message || String(result.error);
		throw new Error(`Could not open directory picker via ${candidate.command}: ${message}`);
	}

	if (result.signal) {
		throw new Error(`Directory picker command ${candidate.command} terminated by signal: ${result.signal}`);
	}

	if (result.status !== 0) {
		const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
		if (stderr) {
			const stderrLower = stderr.toLowerCase();
			if (stderrLower.includes("user cancel") || stderrLower.includes("(-128)")) {
				return { kind: "cancelled" };
			}
			throw new Error(`Could not open directory picker via ${candidate.command}: ${stderr}`);
		}
		return { kind: "cancelled" };
	}

	const selectedPath = typeof result.stdout === "string" ? result.stdout.trim() : "";
	if (!selectedPath) {
		return { kind: "cancelled" };
	}

	return { kind: "selected", path: selectedPath };
}

export async function pickDirectoryPathFromSystemDialog(
	options: PickDirectoryPathFromSystemDialogOptions = {},
): Promise<string | null> {
	const platform = options.platform ?? process.platform;
	const cwd = options.cwd ?? process.cwd();
	const timeoutMs = options.timeoutMs ?? DEFAULT_DIRECTORY_PICKER_TIMEOUT_MS;
	const runCommand =
		options.runCommand ??
		((command: string, args: string[]) =>
			defaultRunCommand(command, args, {
				platform,
				timeoutMs,
			}));

	if (platform === "darwin") {
		const result = await runDirectoryPickerCommand(
			{
				command: "osascript",
				args: ["-e", 'POSIX path of (choose folder with prompt "Select a project folder")'],
			},
			runCommand,
		);
		if (result.kind === "selected") {
			return result.path;
		}
		if (result.kind === "cancelled") {
			return null;
		}
		throw new Error('Could not open directory picker. Command "osascript" is not available.');
	}

	if (platform === "linux") {
		const candidates: DirectoryPickerCommandCandidate[] = [
			{
				command: "zenity",
				args: ["--file-selection", "--directory", "--title=Select project folder"],
			},
			{
				command: "kdialog",
				args: ["--getexistingdirectory", cwd, "Select project folder"],
			},
		];

		for (const candidate of candidates) {
			const result = await runDirectoryPickerCommand(candidate, runCommand);
			if (result.kind === "unavailable") {
				continue;
			}
			if (result.kind === "selected") {
				return result.path;
			}
			return null;
		}

		throw new Error('Could not open directory picker. Install "zenity" or "kdialog" and try again.');
	}

	if (platform === "win32") {
		const candidates: DirectoryPickerCommandCandidate[] = [
			{
				command: "powershell",
				args: ["-NoProfile", "-STA", "-Command", WINDOWS_DIRECTORY_PICKER_SCRIPT],
			},
			{
				command: "pwsh",
				args: ["-NoProfile", "-STA", "-Command", WINDOWS_DIRECTORY_PICKER_SCRIPT],
			},
		];

		for (const candidate of candidates) {
			const result = await runDirectoryPickerCommand(candidate, runCommand);
			if (result.kind === "unavailable") {
				continue;
			}
			if (result.kind === "selected") {
				return result.path;
			}
			return null;
		}

		throw new Error('Could not open directory picker. Install PowerShell ("powershell" or "pwsh") and try again.');
	}

	return null;
}
