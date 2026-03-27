import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ptyMocks = vi.hoisted(() => ({
	spawn: vi.fn(),
}));

vi.mock("node-pty", () => ({
	spawn: ptyMocks.spawn,
}));

import { PtySession } from "../../../src/terminal/pty-session.js";

const originalPlatform = process.platform;
const originalComSpec = process.env.ComSpec;
const originalCOMSPEC = process.env.COMSPEC;

function setPlatform(value: NodeJS.Platform): void {
	Object.defineProperty(process, "platform", {
		value,
		configurable: true,
	});
}

function createMockPtyProcess() {
	const listeners: {
		onData?: (data: string | Buffer | Uint8Array) => void;
		onExit?: (event: { exitCode: number; signal?: number }) => void;
	} = {};

	return {
		pid: 4242,
		onData: vi.fn((listener: (data: string | Buffer | Uint8Array) => void) => {
			listeners.onData = listener;
		}),
		onExit: vi.fn((listener: (event: { exitCode: number; signal?: number }) => void) => {
			listeners.onExit = listener;
		}),
		kill: vi.fn(),
		write: vi.fn(),
		resize: vi.fn(),
		pause: vi.fn(),
		resume: vi.fn(),
		emitData: (data: string | Buffer | Uint8Array) => {
			listeners.onData?.(data);
		},
		emitExit: (event: { exitCode: number; signal?: number }) => {
			listeners.onExit?.(event);
		},
	};
}

describe("PtySession", () => {
	beforeEach(() => {
		ptyMocks.spawn.mockReset();
		setPlatform(originalPlatform);
		if (originalComSpec === undefined) {
			delete process.env.ComSpec;
		} else {
			process.env.ComSpec = originalComSpec;
		}
		if (originalCOMSPEC === undefined) {
			delete process.env.COMSPEC;
		} else {
			process.env.COMSPEC = originalCOMSPEC;
		}
	});

	afterEach(() => {
		setPlatform(originalPlatform);
	});

	it("launches through cmd shell on Windows", () => {
		setPlatform("win32");
		process.env.ComSpec = "C:\\Windows\\System32\\cmd.exe";
		const ptyProcess = createMockPtyProcess();
		ptyMocks.spawn.mockReturnValue(ptyProcess);

		const session = PtySession.spawn({
			binary: "codex",
			args: ["--foo", "hello world"],
			cwd: "C:/repo",
			env: { TERM: "xterm-256color" },
			cols: 120,
			rows: 40,
		});

		expect(ptyMocks.spawn).toHaveBeenCalledTimes(1);
		expect(ptyMocks.spawn.mock.calls[0]?.[0]).toBe("C:\\Windows\\System32\\cmd.exe");
		expect(ptyMocks.spawn.mock.calls[0]?.[1]).toContain("/d /s /c");
		expect(ptyMocks.spawn.mock.calls[0]?.[1]).toContain("codex");
		expect(ptyMocks.spawn.mock.calls[0]?.[1]).toContain("hello^");
		expect(ptyMocks.spawn.mock.calls[0]?.[1]).toContain("world");
		expect(session.pid).toBe(4242);
	});

	it("does not over-quote bare executables on Windows", () => {
		setPlatform("win32");
		process.env.ComSpec = "C:\\Windows\\System32\\cmd.exe";
		const ptyProcess = createMockPtyProcess();
		ptyMocks.spawn.mockReturnValue(ptyProcess);

		PtySession.spawn({
			binary: "cline",
			args: [],
			cwd: "C:/repo",
			cols: 120,
			rows: 40,
		});

		expect(ptyMocks.spawn).toHaveBeenCalledTimes(1);
		expect(ptyMocks.spawn.mock.calls[0]?.[1]).toBe('/d /s /c "cline"');
	});

	it("preserves full prompt text on Windows", () => {
		setPlatform("win32");
		process.env.ComSpec = "C:\\Windows\\System32\\cmd.exe";
		const ptyProcess = createMockPtyProcess();
		ptyMocks.spawn.mockReturnValue(ptyProcess);

		PtySession.spawn({
			binary: "cline",
			args: ["add comment to random file\nwith more context"],
			cwd: "C:/repo",
			cols: 120,
			rows: 40,
		});

		expect(ptyMocks.spawn).toHaveBeenCalledTimes(1);
		const cmdArgs = ptyMocks.spawn.mock.calls[0]?.[1] as string;
		expect(cmdArgs).toContain("cline");
		expect(cmdArgs).toContain("add^");
		expect(cmdArgs).toContain("comment^");
		expect(cmdArgs).toContain("random^");
		expect(cmdArgs).toContain("file\\nwith^");
		expect(cmdArgs).toContain("more^");
		expect(cmdArgs).toContain("context");
	});

	it("does not use cmd shell outside Windows", () => {
		setPlatform("darwin");
		const ptyProcess = createMockPtyProcess();
		ptyMocks.spawn.mockReturnValue(ptyProcess);

		PtySession.spawn({
			binary: "codex",
			args: [],
			cwd: "/tmp",
			cols: 120,
			rows: 40,
		});

		expect(ptyMocks.spawn).toHaveBeenCalledTimes(1);
		expect(ptyMocks.spawn.mock.calls[0]?.[0]).toBe("codex");
	});

	it("does not wrap cmd itself on Windows", () => {
		setPlatform("win32");
		process.env.ComSpec = "C:\\Windows\\System32\\cmd.exe";
		const ptyProcess = createMockPtyProcess();
		ptyMocks.spawn.mockReturnValue(ptyProcess);

		PtySession.spawn({
			binary: "cmd.exe",
			args: ["/c", "echo hi"],
			cwd: "C:/repo",
			cols: 120,
			rows: 40,
		});

		expect(ptyMocks.spawn).toHaveBeenCalledTimes(1);
		expect(ptyMocks.spawn.mock.calls[0]?.[0]).toBe("cmd.exe");
	});

	it("ignores resize calls after the pty has exited", () => {
		setPlatform("win32");
		const ptyProcess = createMockPtyProcess();
		ptyMocks.spawn.mockReturnValue(ptyProcess);

		const session = PtySession.spawn({
			binary: "claude",
			args: [],
			cwd: "C:/repo",
			cols: 120,
			rows: 40,
		});

		ptyProcess.emitExit({ exitCode: 0 });

		expect(() => session.resize(100, 30, 1200, 720)).not.toThrow();
		expect(ptyProcess.resize).not.toHaveBeenCalled();
	});

	it("ignores node-pty resize races after process exit", () => {
		setPlatform("win32");
		const ptyProcess = createMockPtyProcess();
		ptyProcess.resize.mockImplementation(() => {
			throw new Error("Cannot resize a pty that has already exited");
		});
		ptyMocks.spawn.mockReturnValue(ptyProcess);

		const session = PtySession.spawn({
			binary: "claude",
			args: [],
			cwd: "C:/repo",
			cols: 120,
			rows: 40,
		});

		expect(() => session.resize(100, 30)).not.toThrow();
		expect(() => session.resize(120, 40)).not.toThrow();
		expect(ptyProcess.resize).toHaveBeenCalledTimes(1);
	});

	it("rethrows non-ignorable resize errors", () => {
		setPlatform("win32");
		const ptyProcess = createMockPtyProcess();
		ptyProcess.resize.mockImplementation(() => {
			const error = new Error("permission denied") as NodeJS.ErrnoException;
			error.code = "EPERM";
			throw error;
		});
		ptyMocks.spawn.mockReturnValue(ptyProcess);

		const session = PtySession.spawn({
			binary: "claude",
			args: [],
			cwd: "C:/repo",
			cols: 120,
			rows: 40,
		});

		expect(() => session.resize(100, 30)).toThrow("permission denied");
	});

	it("ignores EIO write errors", () => {
		setPlatform("darwin");
		const ptyProcess = createMockPtyProcess();
		ptyProcess.write.mockImplementation(() => {
			const error = new Error("i/o error") as NodeJS.ErrnoException;
			error.code = "EIO";
			throw error;
		});
		ptyMocks.spawn.mockReturnValue(ptyProcess);

		const session = PtySession.spawn({
			binary: "claude",
			args: [],
			cwd: "/tmp",
			cols: 120,
			rows: 40,
		});

		expect(() => session.write("hello")).not.toThrow();
	});

	it("rethrows non-ignorable write errors", () => {
		setPlatform("darwin");
		const ptyProcess = createMockPtyProcess();
		ptyProcess.write.mockImplementation(() => {
			const error = new Error("permission denied") as NodeJS.ErrnoException;
			error.code = "EPERM";
			throw error;
		});
		ptyMocks.spawn.mockReturnValue(ptyProcess);

		const session = PtySession.spawn({
			binary: "claude",
			args: [],
			cwd: "/tmp",
			cols: 120,
			rows: 40,
		});

		expect(() => session.write("hello")).toThrow("permission denied");
	});
});
