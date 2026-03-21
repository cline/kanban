import { act, useCallback, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useHomeAgentSession } from "@/hooks/use-home-agent-session";
import type { RuntimeConfigResponse, RuntimeGitRepositoryInfo, RuntimeTaskSessionSummary } from "@/runtime/types";

const startTaskSessionMutateMock = vi.hoisted(() => vi.fn());
const stopTaskSessionMutateMock = vi.hoisted(() => vi.fn());
const notifyErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: (workspaceId: string | null) => ({
		runtime: {
			startTaskSession: {
				mutate: (input: object) => startTaskSessionMutateMock({ workspaceId, ...input }),
			},
			stopTaskSession: {
				mutate: (input: object) => stopTaskSessionMutateMock({ workspaceId, ...input }),
			},
		},
	}),
}));

vi.mock("@/runtime/task-session-geometry", () => ({
	estimateTaskSessionGeometry: () => ({ cols: 120, rows: 24 }),
}));

vi.mock("@/components/app-toaster", () => ({
	notifyError: notifyErrorMock,
}));

interface HookSnapshot {
	panelMode: ReturnType<typeof useHomeAgentSession>["panelMode"];
	sessionKeys: string[];
	taskId: string | null;
}

function createSummary(taskId: string, agentId: RuntimeTaskSessionSummary["agentId"]): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "running",
		agentId,
		workspacePath: "/tmp/repo",
		pid: 1234,
		startedAt: Date.now(),
		updatedAt: Date.now(),
		lastOutputAt: Date.now(),
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
	};
}

function createRuntimeConfig(overrides: Partial<RuntimeConfigResponse> = {}): RuntimeConfigResponse {
	return {
		selectedAgentId: "codex",
		selectedShortcutLabel: null,
		agentAutonomousModeEnabled: true,
		effectiveCommand: "codex --dangerously-bypass-approvals-and-sandbox",
		globalConfigPath: "/tmp/global-config.json",
		projectConfigPath: "/tmp/project-config.json",
		readyForReviewNotificationsEnabled: true,
		detectedCommands: ["codex", "claude", "cline"],
		agents: [
			{
				id: "codex",
				label: "OpenAI Codex",
				binary: "codex",
				command: "codex --dangerously-bypass-approvals-and-sandbox",
				defaultArgs: [],
				installed: true,
				configured: true,
			},
			{
				id: "claude",
				label: "Claude Code",
				binary: "claude",
				command: "claude --dangerously-skip-permissions",
				defaultArgs: [],
				installed: true,
				configured: false,
			},
			{
				id: "cline",
				label: "Cline",
				binary: "cline",
				command: "cline",
				defaultArgs: [],
				installed: true,
				configured: false,
			},
		],
		shortcuts: [],
		clineProviderSettings: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			baseUrl: null,
			apiKeyConfigured: false,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		},
		commitPromptTemplate: "commit",
		openPrPromptTemplate: "pr",
		commitPromptTemplateDefault: "commit",
		openPrPromptTemplateDefault: "pr",
		...overrides,
	};
}

function createLegacyRuntimeConfig(overrides: Partial<RuntimeConfigResponse> = {}): RuntimeConfigResponse {
	const { clineProviderSettings: _clineProviderSettings, ...legacyConfig } = createRuntimeConfig(overrides);
	return legacyConfig as RuntimeConfigResponse;
}

const DEFAULT_WORKSPACE_GIT: RuntimeGitRepositoryInfo = {
	currentBranch: "main",
	defaultBranch: "main",
	branches: ["main"],
};

function createFlushPromises(): Promise<void> {
	return Promise.resolve().then(() => Promise.resolve());
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolvePromise: ((value: T) => void) | null = null;
	const promise = new Promise<T>((resolve) => {
		resolvePromise = resolve;
	});
	if (!resolvePromise) {
		throw new Error("Could not create deferred promise.");
	}
	return {
		promise,
		resolve: resolvePromise,
	};
}

function requireSnapshot(snapshot: HookSnapshot | null): HookSnapshot {
	if (snapshot === null) {
		throw new Error("Expected a hook snapshot.");
	}
	return snapshot;
}

function requireTaskId(taskId: string | null): string {
	if (taskId === null) {
		throw new Error("Expected a task id.");
	}
	return taskId;
}

function HookHarness({
	config,
	currentProjectId,
	onSnapshot,
	workspaceGit = DEFAULT_WORKSPACE_GIT,
}: {
	config: RuntimeConfigResponse | null;
	currentProjectId: string | null;
	onSnapshot: (snapshot: HookSnapshot) => void;
	workspaceGit?: RuntimeGitRepositoryInfo | null;
}): null {
	const [sessionSummaries, setSessionSummaries] = useState<Record<string, RuntimeTaskSessionSummary>>({});
	const upsertSessionSummary = useCallback((summary: RuntimeTaskSessionSummary) => {
		setSessionSummaries((currentSessions) => ({
			...currentSessions,
			[summary.taskId]: summary,
		}));
	}, []);
	const result = useHomeAgentSession({
		currentProjectId,
		runtimeProjectConfig: config,
		workspaceGit,
		sessionSummaries,
		setSessionSummaries,
		upsertSessionSummary,
	});

	useEffect(() => {
		onSnapshot({
			panelMode: result.panelMode,
			sessionKeys: Object.keys(sessionSummaries),
			taskId: result.taskId,
		});
	}, [onSnapshot, result.panelMode, result.taskId, sessionSummaries]);

	return null;
}

describe("useHomeAgentSession", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		startTaskSessionMutateMock.mockReset();
		stopTaskSessionMutateMock.mockReset();
		startTaskSessionMutateMock.mockImplementation(async ({ taskId }: { taskId: string }) => ({
			ok: true,
			summary: createSummary(taskId, "codex"),
		}));
		notifyErrorMock.mockReset();
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("starts a home terminal session and rotates it when the selected agent changes", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig()}
					currentProjectId="workspace-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const initialSnapshot = requireSnapshot(latestSnapshot);
		const initialTaskId = initialSnapshot.taskId;
		expect(initialSnapshot.panelMode).toBe("terminal");
		expect(initialTaskId).toMatch(/^__home_agent__:workspace-1:codex:/);
		expect(startTaskSessionMutateMock).toHaveBeenCalledTimes(1);
		expect(startTaskSessionMutateMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				taskId: initialTaskId,
				prompt: "",
				baseRef: "main",
			}),
		);
		expect(initialSnapshot.sessionKeys).toEqual([initialTaskId]);

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig({
						selectedAgentId: "claude",
						effectiveCommand: "claude --dangerously-skip-permissions",
					})}
					currentProjectId="workspace-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const rotatedSnapshot = requireSnapshot(latestSnapshot);
		expect(rotatedSnapshot.panelMode).toBe("terminal");
		expect(rotatedSnapshot.taskId).toMatch(/^__home_agent__:workspace-1:claude:/);
		expect(rotatedSnapshot.taskId).not.toBe(initialTaskId);
		expect(startTaskSessionMutateMock).toHaveBeenCalledTimes(2);
		expect(stopTaskSessionMutateMock).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			taskId: initialTaskId,
		});
		expect(rotatedSnapshot.sessionKeys).toEqual([rotatedSnapshot.taskId]);
	});

	it("does not restart the home terminal session on a no-op rerender", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig()}
					currentProjectId="workspace-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const initialTaskId = requireTaskId(requireSnapshot(latestSnapshot).taskId);

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig()}
					currentProjectId="workspace-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const rerenderedSnapshot = requireSnapshot(latestSnapshot);
		expect(rerenderedSnapshot.taskId).toBe(initialTaskId);
		expect(startTaskSessionMutateMock).toHaveBeenCalledTimes(1);
		expect(stopTaskSessionMutateMock).not.toHaveBeenCalled();
	});

	it("keys cline home chat sessions by provider without auto-starting a terminal session", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig({
						selectedAgentId: "cline",
						effectiveCommand: "cline",
					})}
					currentProjectId="workspace-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const anthropicSnapshot = requireSnapshot(latestSnapshot);
		const anthropicTaskId = anthropicSnapshot.taskId;
		expect(anthropicSnapshot.panelMode).toBe("chat");
		expect(anthropicTaskId).toMatch(/^__home_agent__:workspace-1:cline:/);
		expect(startTaskSessionMutateMock).not.toHaveBeenCalled();

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig({
						selectedAgentId: "cline",
						effectiveCommand: "cline",
						clineProviderSettings: {
							providerId: "oca",
							modelId: "gpt-5",
							baseUrl: null,
							apiKeyConfigured: false,
							oauthProvider: null,
							oauthAccessTokenConfigured: false,
							oauthRefreshTokenConfigured: false,
							oauthAccountId: null,
							oauthExpiresAt: null,
						},
					})}
					currentProjectId="workspace-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const updatedSnapshot = requireSnapshot(latestSnapshot);
		expect(updatedSnapshot.panelMode).toBe("chat");
		expect(updatedSnapshot.taskId).toMatch(/^__home_agent__:workspace-1:cline:/);
		expect(updatedSnapshot.taskId).not.toBe(anthropicTaskId);
		expect(stopTaskSessionMutateMock).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			taskId: anthropicTaskId,
		});
		expect(startTaskSessionMutateMock).not.toHaveBeenCalled();
	});

	it("falls back to empty cline settings when older config shapes omit them", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					config={createLegacyRuntimeConfig({
						selectedAgentId: "cline",
						effectiveCommand: "cline",
					})}
					currentProjectId="workspace-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const snapshot = requireSnapshot(latestSnapshot);
		expect(snapshot.panelMode).toBe("chat");
		expect(snapshot.taskId).toMatch(/^__home_agent__:workspace-1:cline:/);
		expect(startTaskSessionMutateMock).not.toHaveBeenCalled();
	});

	it("creates a fresh home chat session id after remounting the app", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig({
						selectedAgentId: "cline",
						effectiveCommand: "cline",
					})}
					currentProjectId="workspace-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const firstTaskId = requireTaskId(requireSnapshot(latestSnapshot).taskId);

		await act(async () => {
			root.unmount();
		});
		root = createRoot(container);
		latestSnapshot = null;

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig({
						selectedAgentId: "cline",
						effectiveCommand: "cline",
					})}
					currentProjectId="workspace-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const secondTaskId = requireTaskId(requireSnapshot(latestSnapshot).taskId);
		expect(secondTaskId).toMatch(/^__home_agent__:workspace-1:cline:/);
		expect(secondTaskId).not.toBe(firstTaskId);
	});

	it("stops stale terminal starts when the selected agent changes mid-launch", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const firstStart = createDeferred<{
			ok: boolean;
			summary: RuntimeTaskSessionSummary;
		}>();
		const secondStart = createDeferred<{
			ok: boolean;
			summary: RuntimeTaskSessionSummary;
		}>();

		startTaskSessionMutateMock.mockReset();
		startTaskSessionMutateMock
			.mockImplementationOnce(async () => await firstStart.promise)
			.mockImplementationOnce(async () => await secondStart.promise);

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig()}
					currentProjectId="workspace-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const firstTaskId = requireTaskId(requireSnapshot(latestSnapshot).taskId);
		expect(firstTaskId).toMatch(/^__home_agent__:workspace-1:codex:/);

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig({
						selectedAgentId: "claude",
						effectiveCommand: "claude --dangerously-skip-permissions",
					})}
					currentProjectId="workspace-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const secondTaskId = requireTaskId(requireSnapshot(latestSnapshot).taskId);
		expect(secondTaskId).toMatch(/^__home_agent__:workspace-1:claude:/);
		expect(secondTaskId).not.toBe(firstTaskId);
		expect(stopTaskSessionMutateMock).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			taskId: firstTaskId,
		});

		await act(async () => {
			firstStart.resolve({
				ok: true,
				summary: createSummary(firstTaskId, "codex"),
			});
			await createFlushPromises();
			secondStart.resolve({
				ok: true,
				summary: createSummary(secondTaskId, "claude"),
			});
			await createFlushPromises();
		});

		expect(requireSnapshot(latestSnapshot).sessionKeys).toEqual([secondTaskId]);
		expect(stopTaskSessionMutateMock).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: "workspace-1",
				taskId: firstTaskId,
			}),
		);
		expect(startTaskSessionMutateMock).toHaveBeenCalledTimes(2);
	});

	it("keeps one home terminal session per project when switching workspaces", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig()}
					currentProjectId="workspace-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const firstTaskId = requireTaskId(requireSnapshot(latestSnapshot).taskId);
		expect(firstTaskId).toMatch(/^__home_agent__:workspace-1:codex:/);

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig()}
					currentProjectId="workspace-2"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const secondSnapshot = requireSnapshot(latestSnapshot);
		expect(secondSnapshot.taskId).toMatch(/^__home_agent__:workspace-2:codex:/);
		expect(secondSnapshot.taskId).not.toBe(firstTaskId);
		expect([...secondSnapshot.sessionKeys].sort()).toEqual([firstTaskId, secondSnapshot.taskId].sort());
		expect(startTaskSessionMutateMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				workspaceId: "workspace-2",
				taskId: secondSnapshot.taskId,
			}),
		);
		expect(stopTaskSessionMutateMock).not.toHaveBeenCalled();

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig()}
					currentProjectId="workspace-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const returnedSnapshot = requireSnapshot(latestSnapshot);
		expect(returnedSnapshot.taskId).toBe(firstTaskId);
		expect([...returnedSnapshot.sessionKeys].sort()).toEqual([firstTaskId, secondSnapshot.taskId].sort());
		expect(startTaskSessionMutateMock).toHaveBeenCalledTimes(2);
	});

	it("reuses an in-flight project terminal start when switching away and back", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const firstWorkspaceStart = createDeferred<{
			ok: boolean;
			summary: RuntimeTaskSessionSummary;
		}>();
		const secondWorkspaceStart = createDeferred<{
			ok: boolean;
			summary: RuntimeTaskSessionSummary;
		}>();

		startTaskSessionMutateMock.mockReset();
		startTaskSessionMutateMock
			.mockImplementationOnce(async () => await firstWorkspaceStart.promise)
			.mockImplementationOnce(async () => await secondWorkspaceStart.promise);

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig()}
					currentProjectId="workspace-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const workspaceOneTaskId = requireTaskId(requireSnapshot(latestSnapshot).taskId);

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig()}
					currentProjectId="workspace-2"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const workspaceTwoTaskId = requireTaskId(requireSnapshot(latestSnapshot).taskId);

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig()}
					currentProjectId="workspace-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		expect(requireTaskId(requireSnapshot(latestSnapshot).taskId)).toBe(workspaceOneTaskId);
		expect(startTaskSessionMutateMock).toHaveBeenCalledTimes(2);

		await act(async () => {
			root.render(
				<HookHarness
					config={null}
					currentProjectId="workspace-2"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		await act(async () => {
			firstWorkspaceStart.resolve({
				ok: true,
				summary: createSummary(workspaceOneTaskId, "codex"),
			});
			await createFlushPromises();
			secondWorkspaceStart.resolve({
				ok: true,
				summary: createSummary(workspaceTwoTaskId, "codex"),
			});
			await createFlushPromises();
		});

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig()}
					currentProjectId="workspace-2"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		expect(requireTaskId(requireSnapshot(latestSnapshot).taskId)).toBe(workspaceTwoTaskId);
		expect([...requireSnapshot(latestSnapshot).sessionKeys].sort()).toEqual(
			[workspaceOneTaskId, workspaceTwoTaskId].sort(),
		);
		expect(startTaskSessionMutateMock).toHaveBeenCalledTimes(2);
		expect(stopTaskSessionMutateMock).not.toHaveBeenCalled();
	});
});
