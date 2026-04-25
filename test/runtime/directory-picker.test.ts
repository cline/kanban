import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { pickDirectoryPathFromSystemDialog } from "../../src/server/directory-picker";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
	spawn: spawnMock,
}));

interface RecordedCommand {
	command: string;
	args: string[];
}

interface MockRunCommandResult {
	stdout: string;
	stderr: string;
	status: number | null;
	signal: NodeJS.Signals | null;
	error?: NodeJS.ErrnoException;
}

function createSpawnResult(overrides: Partial<MockRunCommandResult> = {}): MockRunCommandResult {
	return {
		stdout: "",
		stderr: "",
		status: 0,
		signal: null,
		error: undefined,
		...overrides,
	};
}

function createRunCommand(
	responses: Record<string, MockRunCommandResult>,
	commands: RecordedCommand[],
): (command: string, args: string[]) => Promise<MockRunCommandResult> {
	return async (command: string, args: string[]) => {
		commands.push({ command, args });
		const response = responses[command];
		if (!response) {
			throw new Error(`Unexpected command: ${command}`);
		}
		return response;
	};
}

interface MockChildStream extends EventEmitter {
	setEncoding: (encoding: string) => void;
}

interface MockChildProcess extends EventEmitter {
	stdout: MockChildStream;
	stderr: MockChildStream;
	kill: ReturnType<typeof vi.fn>;
	pid?: number;
}

function createMockChild(
	schedule: (input: { child: MockChildProcess; stdout: MockChildStream; stderr: MockChildStream }) => void,
): MockChildProcess {
	const stdout = new EventEmitter() as MockChildStream;
	stdout.setEncoding = () => {};
	const stderr = new EventEmitter() as MockChildStream;
	stderr.setEncoding = () => {};
	const child = new EventEmitter() as MockChildProcess;
	child.stdout = stdout;
	child.stderr = stderr;
	child.kill = vi.fn(() => true);
	child.pid = 123;
	schedule({ child, stdout, stderr });
	return child;
}

describe("pickDirectoryPathFromSystemDialog", () => {
	it("falls back to kdialog when zenity is unavailable on linux", async () => {
		const commands: RecordedCommand[] = [];
		const selectedPath = await pickDirectoryPathFromSystemDialog({
			platform: "linux",
			cwd: "/tmp",
			runCommand: createRunCommand(
				{
					zenity: createSpawnResult({
						error: {
							code: "ENOENT",
							message: "command not found",
						} as NodeJS.ErrnoException,
					}),
					kdialog: createSpawnResult({
						stdout: "/tmp/my-repo\n",
					}),
				},
				commands,
			),
		});

		expect(selectedPath).toBe("/tmp/my-repo");
		expect(commands).toEqual([
			{
				command: "zenity",
				args: ["--file-selection", "--directory", "--title=Select project folder"],
			},
			{
				command: "kdialog",
				args: ["--getexistingdirectory", "/tmp", "Select project folder"],
			},
		]);
	});

	it("returns null when the picker is cancelled", async () => {
		const commands: RecordedCommand[] = [];
		const selectedPath = await pickDirectoryPathFromSystemDialog({
			platform: "linux",
			runCommand: createRunCommand(
				{
					zenity: createSpawnResult({
						status: 1,
					}),
				},
				commands,
			),
		});

		expect(selectedPath).toBeNull();
		expect(commands).toEqual([
			{
				command: "zenity",
				args: ["--file-selection", "--directory", "--title=Select project folder"],
			},
		]);
	});

	it("throws a clear error when no linux picker commands are installed", async () => {
		const commands: RecordedCommand[] = [];
		await expect(() =>
			pickDirectoryPathFromSystemDialog({
				platform: "linux",
				runCommand: createRunCommand(
					{
						zenity: createSpawnResult({
							error: {
								code: "ENOENT",
								message: "command not found",
							} as NodeJS.ErrnoException,
						}),
						kdialog: createSpawnResult({
							error: {
								code: "ENOENT",
								message: "command not found",
							} as NodeJS.ErrnoException,
						}),
					},
					commands,
				),
			}),
		).rejects.toThrow('Could not open directory picker. Install "zenity" or "kdialog" and try again.');
	});

	it("throws command stderr when picker fails for a real error", async () => {
		await expect(() =>
			pickDirectoryPathFromSystemDialog({
				platform: "linux",
				runCommand: createRunCommand(
					{
						zenity: createSpawnResult({
							status: 1,
							stderr: "Gtk warning",
						}),
					},
					[],
				),
			}),
		).rejects.toThrow("Could not open directory picker via zenity: Gtk warning");
	});

	it("waits for close before advancing after an error event", async () => {
		spawnMock.mockReset();
		spawnMock
			.mockImplementationOnce(() =>
				createMockChild(({ child }) => {
					queueMicrotask(() => {
						child.emit(
							"error",
							Object.assign(new Error("command not found"), { code: "ENOENT" }) as NodeJS.ErrnoException,
						);
					});
					setTimeout(() => {
						child.emit("close", null, null);
					}, 0);
				}),
			)
			.mockImplementationOnce(() =>
				createMockChild(({ child, stdout }) => {
					queueMicrotask(() => {
						stdout.emit("data", "/tmp/from-kdialog\n");
						child.emit("close", 0, null);
					});
				}),
			);

		const pickerPromise = pickDirectoryPathFromSystemDialog({
			platform: "linux",
			cwd: "/tmp",
		});

		await Promise.resolve();
		expect(spawnMock).toHaveBeenCalledTimes(1);

		await expect(pickerPromise).resolves.toBe("/tmp/from-kdialog");
		expect(spawnMock).toHaveBeenCalledTimes(2);
	});

	it("times out a hung picker process and kills it", async () => {
		vi.useFakeTimers();
		try {
			spawnMock.mockReset();
			const child = createMockChild(() => {});
			spawnMock.mockReturnValue(child);

			const pickerPromise = pickDirectoryPathFromSystemDialog({
				platform: "linux",
				timeoutMs: 100,
			});
			const rejection = expect(pickerPromise).rejects.toThrow(
				"Could not open directory picker via zenity: Directory picker timed out after 100ms.",
			);

			await vi.advanceTimersByTimeAsync(100);

			expect(child.kill).toHaveBeenCalledWith("SIGTERM");
			expect(spawnMock).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(1_000);
			await rejection;
		} finally {
			vi.useRealTimers();
		}
	});

	it("uses close to finish promptly after timing out when kill succeeds", async () => {
		vi.useFakeTimers();
		try {
			spawnMock.mockReset();
			const child = createMockChild(({ child }) => {
				child.kill = vi.fn((signal?: NodeJS.Signals | number) => {
					queueMicrotask(() => {
						child.emit("close", null, typeof signal === "string" ? signal : null);
					});
					return true;
				});
			});
			spawnMock.mockReturnValue(child);

			const pickerPromise = pickDirectoryPathFromSystemDialog({
				platform: "linux",
				timeoutMs: 100,
			});
			const rejection = expect(pickerPromise).rejects.toThrow(
				"Could not open directory picker via zenity: Directory picker timed out after 100ms.",
			);

			await vi.advanceTimersByTimeAsync(100);

			await rejection;
			expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		} finally {
			vi.useRealTimers();
		}
	});
});

it("uses powershell on windows when available", async () => {
	const commands: RecordedCommand[] = [];
	const selectedPath = await pickDirectoryPathFromSystemDialog({
		platform: "win32",
		runCommand: createRunCommand(
			{
				powershell: createSpawnResult({
					stdout: "C:\\Users\\dev\\repo\n",
				}),
			},
			commands,
		),
	});

	expect(selectedPath).toBe("C:\\Users\\dev\\repo");
	expect(commands).toHaveLength(1);
	expect(commands[0]?.command).toBe("powershell");
	expect(commands[0]?.args.slice(0, 3)).toEqual(["-NoProfile", "-STA", "-Command"]);
});

it("falls back to pwsh when powershell is unavailable on windows", async () => {
	const commands: RecordedCommand[] = [];
	const selectedPath = await pickDirectoryPathFromSystemDialog({
		platform: "win32",
		runCommand: createRunCommand(
			{
				powershell: createSpawnResult({
					error: {
						code: "ENOENT",
						message: "command not found",
					} as NodeJS.ErrnoException,
				}),
				pwsh: createSpawnResult({
					stdout: "C:\\Users\\dev\\repo\n",
				}),
			},
			commands,
		),
	});

	expect(selectedPath).toBe("C:\\Users\\dev\\repo");
	expect(commands.map((entry) => entry.command)).toEqual(["powershell", "pwsh"]);
});

it("returns null when windows picker is cancelled", async () => {
	const selectedPath = await pickDirectoryPathFromSystemDialog({
		platform: "win32",
		runCommand: createRunCommand(
			{
				powershell: createSpawnResult({
					status: 1,
				}),
			},
			[],
		),
	});

	expect(selectedPath).toBeNull();
});

it("throws a clear error when no windows picker commands are installed", async () => {
	await expect(() =>
		pickDirectoryPathFromSystemDialog({
			platform: "win32",
			runCommand: createRunCommand(
				{
					powershell: createSpawnResult({
						error: {
							code: "ENOENT",
							message: "command not found",
						} as NodeJS.ErrnoException,
					}),
					pwsh: createSpawnResult({
						error: {
							code: "ENOENT",
							message: "command not found",
						} as NodeJS.ErrnoException,
					}),
				},
				[],
			),
		}),
	).rejects.toThrow('Could not open directory picker. Install PowerShell ("powershell" or "pwsh") and try again.');
});
