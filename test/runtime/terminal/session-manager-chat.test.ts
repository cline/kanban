import { describe, expect, it, vi } from "vitest";

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

describe("TerminalSessionManager chat consumeOutput", () => {
	it("upserts chat messages from launch.consumeOutput for any agent id", async () => {
		prepareAgentLaunchMock.mockImplementation(async (input: { args: string[]; binary?: string }) => ({
			binary: input.binary,
			args: [...input.args],
			env: {},
			consumeOutput: (_buffer: string, _chunk: string) => ({
				buffer: "",
				messages: [
					{
						id: "from-hook",
						role: "assistant" as const,
						content: "parsed from protocol",
						createdAt: 1,
						meta: null,
					},
				],
				passthrough: "",
			}),
		}));
		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(111, request);
			spawnedSessions.push(session);
			return session;
		});

		const manager = new TerminalSessionManager();
		await manager.startTaskSession({
			taskId: "task-chat",
			agentId: "claude",
			binary: "claude",
			args: [],
			cwd: "/tmp/task-chat",
			prompt: "hello",
		});

		spawnedSessions[0]?.triggerData("AG2_CHAT {}\n");
		expect(manager.listChatMessages("task-chat")).toEqual([
			{
				id: "from-hook",
				role: "assistant",
				content: "parsed from protocol",
				createdAt: 1,
				meta: null,
			},
		]);
	});
});
