import { execFile, spawnSync } from "node:child_process";
import treeKill from "tree-kill";
import type { ManagedProcessRecord } from "./process-registry";

export interface StopProcessResult {
	wasRunning: boolean;
	forced: boolean;
	stopped: boolean;
}

export function isProcessAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
	}
}

export function getProcessCommandLine(pid: number): string | null {
	if (pid === process.pid) {
		return [process.execPath, ...process.execArgv, ...process.argv].join(" ");
	}
	if (process.platform === "win32") {
		const wmic = spawnSync("wmic", ["process", "where", `(ProcessId=${pid})`, "get", "CommandLine", "/value"], {
			encoding: "utf8",
			windowsHide: true,
		});
		if (wmic.status === 0 && wmic.stdout) {
			const line = wmic.stdout.split(/\r?\n/).find((value) => value.trim().toLowerCase().startsWith("commandline="));
			if (line) {
				return line.slice(line.indexOf("=") + 1).trim();
			}
		}
		const powershell = spawnSync(
			"powershell",
			["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`],
			{
				encoding: "utf8",
				windowsHide: true,
			},
		);
		return powershell.status === 0 && powershell.stdout ? powershell.stdout.trim() || null : null;
	}
	const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	return result.status === 0 && result.stdout ? result.stdout.trim() || null : null;
}

export function getProcessStartedAt(pid: number): Date | null {
	if (!Number.isInteger(pid) || pid <= 0) {
		return null;
	}
	if (pid === process.pid) {
		return new Date(Date.now() - process.uptime() * 1_000);
	}
	if (process.platform === "win32") {
		const result = spawnSync(
			"powershell",
			[
				"-NoProfile",
				"-Command",
				`(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`,
			],
			{ encoding: "utf8", windowsHide: true },
		);
		if (result.status !== 0 || !result.stdout) {
			return null;
		}
		const startedAt = new Date(result.stdout.trim());
		return Number.isNaN(startedAt.valueOf()) ? null : startedAt;
	}
	const result = spawnSync("ps", ["-p", String(pid), "-o", "lstart="], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
		env: { ...process.env, LC_ALL: "C" },
	});
	if (result.status !== 0 || !result.stdout) {
		return null;
	}
	const startedAt = new Date(result.stdout.trim());
	return Number.isNaN(startedAt.valueOf()) ? null : startedAt;
}

export function isKanbanCommandLineProcess(pid: number): boolean {
	if (!isProcessAlive(pid)) {
		return false;
	}
	const commandLine = getProcessCommandLine(pid);
	if (!commandLine) {
		return false;
	}
	const normalized = commandLine.replaceAll("\\", "/").toLowerCase();
	const commandMatches =
		/(^|[\s/])kanban(?:\.cmd|\.exe|\.js)?(?:[\s/]|$)/u.test(normalized) ||
		(normalized.includes("/kanban/") && /(?:^|[\s/])cli\.(?:js|ts)(?:\s|$)/u.test(normalized));
	return commandMatches;
}

export function isKanbanProcess(record: ManagedProcessRecord): boolean {
	if (!isKanbanCommandLineProcess(record.pid)) {
		return false;
	}
	const actualStartedAt = getProcessStartedAt(record.pid);
	const recordedStartedAt = new Date(record.startedAt);
	if (actualStartedAt && !Number.isNaN(recordedStartedAt.valueOf())) {
		return Math.abs(actualStartedAt.valueOf() - recordedStartedAt.valueOf()) < 2_000;
	}
	// Command-line validation remains useful on systems where process start time
	// is not available (for example, restricted Windows environments).
	return true;
}

function sendGracefulSignal(pid: number): Promise<void> {
	if (process.platform === "win32") {
		return new Promise((resolve) => {
			execFile("taskkill", ["/PID", String(pid), "/T"], { windowsHide: true }, () => resolve());
		});
	}
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		// The process may have exited between validation and signalling.
	}
	return Promise.resolve();
}

function sendForcefulSignal(pid: number): Promise<void> {
	if (process.platform === "win32") {
		return new Promise((resolve) => {
			execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
		});
	}
	return new Promise((resolve) => {
		try {
			treeKill(pid, "SIGKILL", () => resolve());
		} catch {
			resolve();
		}
	});
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (isProcessAlive(pid) && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return !isProcessAlive(pid);
}

export async function stopManagedProcess(pid: number, timeoutMs = 10_000): Promise<StopProcessResult> {
	if (!isProcessAlive(pid)) {
		return { wasRunning: false, forced: false, stopped: true };
	}
	await sendGracefulSignal(pid);
	if (await waitForExit(pid, timeoutMs)) {
		return { wasRunning: true, forced: false, stopped: true };
	}
	await sendForcefulSignal(pid);
	const stopped = await waitForExit(pid, 2_000);
	return { wasRunning: true, forced: true, stopped };
}
