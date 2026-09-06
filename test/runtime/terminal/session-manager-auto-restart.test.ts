import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prepareAgentLaunchMock = vi.hoisted(() => vi.fn());
const ptySessionSpawnMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/terminal/agent-session-adapters.js", () => ({
	prepareAgentLaunch: prepareAgentLaunchMock,
}));

vi.mock("../../../src/terminal/pty-session.js", () => ({
	PtySession: {
		spawn: ptySessionSpawnMock,
	},
}));

import { TerminalSessionManager } from "../../../src/terminal/session-manager";

const CODEX_DEFERRED_STARTUP_INPUT_STABLE_MS = 1_000;

interface MockSpawnRequest {
	onData?: (chunk: Buffer) => void;
	onExit?: (event: { exitCode: number | null; signal?: number }) => void;
}

function createMockPtySession(pid: number, request: MockSpawnRequest) {
	return {
		pid,
		write: vi.fn(),
		resize: vi.fn(),
		pause: vi.fn(),
		resume: vi.fn(),
		stop: vi.fn(),
		wasInterrupted: vi.fn(() => false),
		triggerData: (chunk: string | Buffer) => {
			request.onData?.(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8"));
		},
		triggerExit: (exitCode: number | null) => {
			request.onExit?.({ exitCode });
		},
	};
}

async function waitForQueuedTerminalWork(): Promise<void> {
	await Promise.resolve();
	await new Promise<void>((resolve) => {
		setImmediate(resolve);
	});
	await Promise.resolve();
}

async function waitForDeferredStartupInputStablePeriod(): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, CODEX_DEFERRED_STARTUP_INPUT_STABLE_MS + 50);
	});
	await waitForQueuedTerminalWork();
}

async function expectDeferredStartupInputSent(
	session: ReturnType<typeof createMockPtySession>,
	deferredStartupInput: string,
): Promise<void> {
	await vi.waitFor(
		() => {
			expect(session.write).toHaveBeenCalledWith(deferredStartupInput);
		},
		{ timeout: CODEX_DEFERRED_STARTUP_INPUT_STABLE_MS + 1_000 },
	);
}

describe("TerminalSessionManager auto-restart", () => {
	beforeEach(() => {
		prepareAgentLaunchMock.mockReset();
		ptySessionSpawnMock.mockReset();
		vi.useRealTimers();
		prepareAgentLaunchMock.mockImplementation(async (input: { args: string[]; binary?: string }) => ({
			binary: input.binary,
			args: [...input.args],
			env: {},
		}));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("restarts an attached agent session after it exits", async () => {
		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(spawnedSessions.length === 0 ? 111 : 222, request);
			spawnedSessions.push(session);
			return session;
		});

		const manager = new TerminalSessionManager();
		manager.attach("task-1", {
			onState: vi.fn(),
			onOutput: vi.fn(),
			onExit: vi.fn(),
		});

		await manager.startTaskSession({
			taskId: "task-1",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: "/tmp/task-1",
			prompt: "Fix the bug",
		});

		expect(ptySessionSpawnMock).toHaveBeenCalledTimes(1);
		spawnedSessions[0]?.triggerExit(130);

		await vi.waitFor(() => {
			expect(ptySessionSpawnMock).toHaveBeenCalledTimes(2);
		});
		expect(manager.getSummary("task-1")?.state).toBe("running");
		expect(manager.getSummary("task-1")?.pid).toBe(222);
	});

	it("does not restart an attached agent session after an explicit stop", async () => {
		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(111, request);
			spawnedSessions.push(session);
			return session;
		});

		const manager = new TerminalSessionManager();
		manager.attach("task-1", {
			onState: vi.fn(),
			onOutput: vi.fn(),
			onExit: vi.fn(),
		});

		await manager.startTaskSession({
			taskId: "task-1",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: "/tmp/task-1",
			prompt: "Fix the bug",
		});

		manager.stopTaskSession("task-1");
		spawnedSessions[0]?.triggerExit(0);
		await Promise.resolve();
		await Promise.resolve();

		expect(ptySessionSpawnMock).toHaveBeenCalledTimes(1);
		expect(manager.getSummary("task-1")?.state).toBe("awaiting_review");
		expect(manager.getSummary("task-1")?.pid).toBeNull();
	});

	it("sends deferred Codex startup input when the prompt marker appears", async () => {
		const deferredStartupInput = "\u001b[200~/plan Validate rollout\u001b[201~\r";
		prepareAgentLaunchMock.mockResolvedValue({
			binary: "codex",
			args: [],
			env: {},
			deferredStartupInput,
		});

		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(111, request);
			spawnedSessions.push(session);
			return session;
		});

		const manager = new TerminalSessionManager();
		await manager.startTaskSession({
			taskId: "task-1",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: "/tmp/task-1",
			prompt: "Fix the bug",
			startInPlanMode: true,
		});

		const session = spawnedSessions[0];
		expect(session).toBeDefined();
		if (!session) {
			return;
		}

		session.triggerData("Booting Codex\n");
		await waitForQueuedTerminalWork();
		expect(session.write).not.toHaveBeenCalledWith(deferredStartupInput);

		session.triggerData("› ");
		await waitForQueuedTerminalWork();
		expect(session.write).not.toHaveBeenCalledWith(deferredStartupInput);
		await expectDeferredStartupInputSent(session, deferredStartupInput);
		expect(session.write).toHaveBeenCalledTimes(1);
	});

	it("waits for the prompt marker instead of sending when the startup UI header appears", async () => {
		const deferredStartupInput = "\u001b[200~/plan Validate startup UI detect\u001b[201~\r";
		prepareAgentLaunchMock.mockResolvedValue({
			binary: "codex",
			args: [],
			env: {},
			deferredStartupInput,
		});

		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(111, request);
			spawnedSessions.push(session);
			return session;
		});

		const manager = new TerminalSessionManager();
		await manager.startTaskSession({
			taskId: "task-1",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: "/tmp/task-1",
			prompt: "Fix the bug",
			startInPlanMode: true,
		});

		const session = spawnedSessions[0];
		expect(session).toBeDefined();
		if (!session) {
			return;
		}

		session.triggerData(">_ OpenAI Codex (v0.117.0)\n");
		await waitForQueuedTerminalWork();
		expect(session.write).not.toHaveBeenCalledWith(deferredStartupInput);

		session.triggerData("› ");
		await waitForQueuedTerminalWork();
		expect(session.write).not.toHaveBeenCalledWith(deferredStartupInput);
		await expectDeferredStartupInputSent(session, deferredStartupInput);
		expect(session.write).toHaveBeenCalledTimes(1);
	});

	it("waits for Codex MCP startup work to finish before sending deferred startup input", async () => {
		const deferredStartupInput = "\u001b[200~/plan Validate MCP startup\u001b[201~\r";
		prepareAgentLaunchMock.mockResolvedValue({
			binary: "codex",
			args: [],
			env: {},
			deferredStartupInput,
		});

		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(111, request);
			spawnedSessions.push(session);
			return session;
		});

		const manager = new TerminalSessionManager();
		await manager.startTaskSession({
			taskId: "task-1",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: "/tmp/task-1",
			prompt: "Fix the bug",
			startInPlanMode: true,
		});

		const session = spawnedSessions[0];
		expect(session).toBeDefined();
		if (!session) {
			return;
		}

		session.triggerData(">_ OpenAI Codex (v0.124.0)\n");
		session.triggerData("Starting MCP servers (1/2)\n");
		await waitForQueuedTerminalWork();
		expect(session.write).not.toHaveBeenCalledWith(deferredStartupInput);

		session.triggerData("Booting MCP server: linear\n");
		await waitForQueuedTerminalWork();
		expect(session.write).not.toHaveBeenCalledWith(deferredStartupInput);

		session.triggerData("\u001b[2J\u001b[H› ");
		await waitForQueuedTerminalWork();
		expect(session.write).not.toHaveBeenCalledWith(deferredStartupInput);
		await expectDeferredStartupInputSent(session, deferredStartupInput);
		expect(session.write).toHaveBeenCalledTimes(1);
	});

	it("treats the misspelled Codex MCP startup text as busy", async () => {
		const deferredStartupInput = "\u001b[200~/plan Validate misspelled MCP startup\u001b[201~\r";
		prepareAgentLaunchMock.mockResolvedValue({
			binary: "codex",
			args: [],
			env: {},
			deferredStartupInput,
		});

		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(111, request);
			spawnedSessions.push(session);
			return session;
		});

		const manager = new TerminalSessionManager();
		await manager.startTaskSession({
			taskId: "task-1",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: "/tmp/task-1",
			prompt: "Fix the bug",
			startInPlanMode: true,
		});

		const session = spawnedSessions[0];
		expect(session).toBeDefined();
		if (!session) {
			return;
		}

		session.triggerData("Staring MCP servers (1/1)\n› ");
		await waitForQueuedTerminalWork();
		expect(session.write).not.toHaveBeenCalledWith(deferredStartupInput);

		session.triggerData("\u001b[2J\u001b[H› ");
		await waitForQueuedTerminalWork();
		expect(session.write).not.toHaveBeenCalledWith(deferredStartupInput);
		await expectDeferredStartupInputSent(session, deferredStartupInput);
		expect(session.write).toHaveBeenCalledTimes(1);
	});

	it("keeps deferred Codex startup input blocked while MCP startup text remains visible", async () => {
		const deferredStartupInput = "\u001b[200~/plan Validate MCP visible text\u001b[201~\r";
		prepareAgentLaunchMock.mockResolvedValue({
			binary: "codex",
			args: [],
			env: {},
			deferredStartupInput,
		});

		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(111, request);
			spawnedSessions.push(session);
			return session;
		});

		const manager = new TerminalSessionManager();
		await manager.startTaskSession({
			taskId: "task-1",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: "/tmp/task-1",
			prompt: "Fix the bug",
			startInPlanMode: true,
		});

		const session = spawnedSessions[0];
		expect(session).toBeDefined();
		if (!session) {
			return;
		}

		session.triggerData("Starting MCP servers (1/1)\n› ");
		await waitForQueuedTerminalWork();
		expect(session.write).not.toHaveBeenCalledWith(deferredStartupInput);

		session.triggerData("› ");
		await waitForQueuedTerminalWork();
		expect(session.write).not.toHaveBeenCalledWith(deferredStartupInput);

		session.triggerData("\u001b[2J\u001b[H› ");
		await waitForQueuedTerminalWork();
		expect(session.write).not.toHaveBeenCalledWith(deferredStartupInput);
		await expectDeferredStartupInputSent(session, deferredStartupInput);
		expect(session.write).toHaveBeenCalledTimes(1);
	});

	it("cancels a clean prompt stable check when Codex starts MCP work before the delay elapses", async () => {
		const deferredStartupInput = "\u001b[200~/plan Validate delayed MCP startup\u001b[201~\r";
		prepareAgentLaunchMock.mockResolvedValue({
			binary: "codex",
			args: [],
			env: {},
			deferredStartupInput,
		});

		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(111, request);
			spawnedSessions.push(session);
			return session;
		});

		const manager = new TerminalSessionManager();
		await manager.startTaskSession({
			taskId: "task-1",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: "/tmp/task-1",
			prompt: "Fix the bug",
			startInPlanMode: true,
		});

		const session = spawnedSessions[0];
		expect(session).toBeDefined();
		if (!session) {
			return;
		}

		session.triggerData("› ");
		await waitForQueuedTerminalWork();
		expect(session.write).not.toHaveBeenCalledWith(deferredStartupInput);

		session.triggerData("\u001b[2J\u001b[HStarting MCP servers (1/1)\n› ");
		await waitForDeferredStartupInputStablePeriod();
		expect(session.write).not.toHaveBeenCalledWith(deferredStartupInput);

		session.triggerData("\u001b[2J\u001b[H› ");
		await waitForQueuedTerminalWork();
		await expectDeferredStartupInputSent(session, deferredStartupInput);
		expect(session.write).toHaveBeenCalledTimes(1);
	});

	it("recognizes wrapped Codex MCP startup text as busy", async () => {
		const deferredStartupInput = "\u001b[200~/plan Validate wrapped MCP text\u001b[201~\r";
		prepareAgentLaunchMock.mockResolvedValue({
			binary: "codex",
			args: [],
			env: {},
			deferredStartupInput,
		});

		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(111, request);
			spawnedSessions.push(session);
			return session;
		});

		const manager = new TerminalSessionManager();
		await manager.startTaskSession({
			taskId: "task-1",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: "/tmp/task-1",
			prompt: "Fix the bug",
			startInPlanMode: true,
			cols: 20,
		});

		const session = spawnedSessions[0];
		expect(session).toBeDefined();
		if (!session) {
			return;
		}

		session.triggerData("Starting MCP serv\r\ners (1/1)\r\n› ");
		await waitForQueuedTerminalWork();

		expect(session.write).not.toHaveBeenCalledWith(deferredStartupInput);
	});
});
