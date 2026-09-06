import { delimiter, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const agentAdapterMocks = vi.hoisted(() => ({
	prepareAgentLaunch: vi.fn(),
}));

const ptySessionMocks = vi.hoisted(() => ({
	spawn: vi.fn(),
}));

vi.mock("../../../src/terminal/agent-session-adapters.js", () => ({
	prepareAgentLaunch: agentAdapterMocks.prepareAgentLaunch,
}));

vi.mock("../../../src/terminal/pty-session.js", () => ({
	PtySession: {
		spawn: ptySessionMocks.spawn,
	},
}));

import { TerminalSessionManager } from "../../../src/terminal/session-manager";
import { createTempDir } from "../../utilities/temp-dir";

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalPath = process.env.PATH;

function restoreEnv(): void {
	if (originalHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = originalHome;
	}

	if (originalUserProfile === undefined) {
		delete process.env.USERPROFILE;
	} else {
		process.env.USERPROFILE = originalUserProfile;
	}

	if (originalPath === undefined) {
		delete process.env.PATH;
	} else {
		process.env.PATH = originalPath;
	}
}

describe.sequential("TerminalSessionManager launch env", () => {
	beforeEach(() => {
		agentAdapterMocks.prepareAgentLaunch.mockReset();
		agentAdapterMocks.prepareAgentLaunch.mockResolvedValue({
			args: [],
			env: {},
		});
		ptySessionMocks.spawn.mockReset();
		ptySessionMocks.spawn.mockReturnValue({
			pid: 4242,
			write: vi.fn(),
			resize: vi.fn(),
			stop: vi.fn(),
			wasInterrupted: vi.fn(() => false),
		});
		restoreEnv();
	});

	afterEach(() => {
		restoreEnv();
	});

	it("augments the spawned agent PATH with standard user-local bin directories", async () => {
		if (process.platform === "win32") {
			return;
		}

		const { path: tempHome, cleanup } = createTempDir("kanban-session-manager-home-");
		try {
			process.env.HOME = tempHome;
			process.env.USERPROFILE = tempHome;
			process.env.PATH = "/usr/bin:/bin";

			const manager = new TerminalSessionManager();
			await manager.startTaskSession({
				taskId: "task-1",
				agentId: "droid",
				binary: "droid",
				args: [],
				cwd: tempHome,
				prompt: "Inspect the repo",
			});

			expect(ptySessionMocks.spawn).toHaveBeenCalledTimes(1);
			const launchRequest = ptySessionMocks.spawn.mock.calls[0]?.[0] as {
				env?: Record<string, string | undefined>;
			};
			expect(launchRequest.env?.PATH?.split(delimiter)).toContain(join(tempHome, ".local", "bin"));
			expect(launchRequest.env?.TERM_PROGRAM).toBe("kanban");
		} finally {
			cleanup();
		}
	});
});
