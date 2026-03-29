// Manages the synthetic home agent session lifecycle for the sidebar.
// It keeps one in-memory session identity stable per workspace while the app
// stays open and rotates it only when the selected agent configuration
// meaningfully changes.

import { createHomeAgentSessionId, isHomeAgentSessionIdForWorkspace } from "@runtime-home-agent-session";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useRef } from "react";

import { notifyError } from "@/components/app-toaster";
import { getRuntimeClineProviderSettings, isNativeClineAgentSelected } from "@/runtime/native-agent";
import { estimateTaskSessionGeometry } from "@/runtime/task-session-geometry";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeConfigResponse, RuntimeGitRepositoryInfo, RuntimeTaskSessionSummary } from "@/runtime/types";

type HomeAgentPanelMode = "chat" | "terminal";

interface HomeAgentDescriptor {
	panelMode: HomeAgentPanelMode;
	descriptorKey: string;
	taskId: string;
}

interface UseHomeAgentSessionInput {
	currentProjectId: string | null;
	runtimeProjectConfig: RuntimeConfigResponse | null;
	workspaceGit: RuntimeGitRepositoryInfo | null;
	clineSessionContextVersion: number;
	sessionSummaries: Record<string, RuntimeTaskSessionSummary>;
	setSessionSummaries: Dispatch<SetStateAction<Record<string, RuntimeTaskSessionSummary>>>;
	upsertSessionSummary: (summary: RuntimeTaskSessionSummary) => void;
}

interface UseHomeAgentSessionResult {
	panelMode: HomeAgentPanelMode | null;
	taskId: string | null;
}

interface HomeAgentSessionIdentity {
	workspaceId: string;
	taskId: string;
}

interface HomeAgentWorkspaceDescriptor {
	descriptorKey: string;
	panelMode: HomeAgentPanelMode;
	taskId: string;
}

function buildClineDescriptor(config: RuntimeConfigResponse): string {
	const clineProviderSettings = getRuntimeClineProviderSettings(config);
	return JSON.stringify({
		agentId: config.selectedAgentId,
		providerId: clineProviderSettings.providerId ?? clineProviderSettings.oauthProvider ?? "",
		modelId: clineProviderSettings.modelId ?? "",
		baseUrl: clineProviderSettings.baseUrl ?? "",
		reasoningEffort: clineProviderSettings.reasoningEffort ?? null,
	});
}

function buildTerminalDescriptor(config: RuntimeConfigResponse): string {
	return JSON.stringify({
		agentId: config.selectedAgentId,
		command: config.effectiveCommand ?? "",
	});
}

function resolveHomeAgentBaseRef(workspaceGit: RuntimeGitRepositoryInfo | null): string {
	return workspaceGit?.currentBranch ?? workspaceGit?.defaultBranch ?? "HEAD";
}

function pruneWorkspaceHomeAgentSessions(
	setSessionSummaries: Dispatch<SetStateAction<Record<string, RuntimeTaskSessionSummary>>>,
	workspaceId: string,
	keepTaskId: string | null,
): void {
	setSessionSummaries((currentSessions) => {
		let didChange = false;
		const nextSessions: Record<string, RuntimeTaskSessionSummary> = {};

		for (const [taskId, summary] of Object.entries(currentSessions)) {
			if (isHomeAgentSessionIdForWorkspace(taskId, workspaceId) && taskId !== keepTaskId) {
				didChange = true;
				continue;
			}
			nextSessions[taskId] = summary;
		}

		return didChange ? nextSessions : currentSessions;
	});
}

function buildHomeAgentSessionKey(session: HomeAgentSessionIdentity): string {
	return `${session.workspaceId}:${session.taskId}`;
}

async function stopHomeAgentSession(session: HomeAgentSessionIdentity | null): Promise<void> {
	if (!session) {
		return;
	}
	try {
		await getRuntimeTrpcClient(session.workspaceId).runtime.stopTaskSession.mutate({
			taskId: session.taskId,
		});
	} catch {
		// Ignore stop errors during cleanup.
	}
}

export function useHomeAgentSession({
	currentProjectId,
	runtimeProjectConfig,
	workspaceGit,
	clineSessionContextVersion,
	sessionSummaries,
	setSessionSummaries,
	upsertSessionSummary,
}: UseHomeAgentSessionInput): UseHomeAgentSessionResult {
	const latestBaseRefRef = useRef("HEAD");
	const homeDescriptorByWorkspaceRef = useRef(new Map<string, HomeAgentWorkspaceDescriptor>());
	const desiredTaskIdByWorkspaceRef = useRef(new Map<string, string>());
	const startedSessionKeysRef = useRef(new Set<string>());
	const pendingStartRequestIdsRef = useRef(new Map<string, number>());
	const previousClineSessionContextVersionByWorkspaceRef = useRef(new Map<string, number>());
	const nextStartRequestIdRef = useRef(0);
	const disposedRef = useRef(false);
	const clineProviderSettings = getRuntimeClineProviderSettings(runtimeProjectConfig);

	useEffect(() => {
		latestBaseRefRef.current = resolveHomeAgentBaseRef(workspaceGit);
	}, [workspaceGit?.currentBranch, workspaceGit?.defaultBranch]);

	const descriptor = useMemo<HomeAgentDescriptor | null>(() => {
		if (!currentProjectId || !runtimeProjectConfig) {
			return null;
		}

		let panelMode: HomeAgentPanelMode;
		let descriptorKey: string;
		if (isNativeClineAgentSelected(runtimeProjectConfig.selectedAgentId)) {
			panelMode = "chat";
			descriptorKey = buildClineDescriptor(runtimeProjectConfig);
		} else {
			if (!runtimeProjectConfig.effectiveCommand) {
				return null;
			}
			panelMode = "terminal";
			descriptorKey = buildTerminalDescriptor(runtimeProjectConfig);
		}

		const existingDescriptor = homeDescriptorByWorkspaceRef.current.get(currentProjectId);
		if (
			existingDescriptor &&
			existingDescriptor.descriptorKey === descriptorKey &&
			existingDescriptor.panelMode === panelMode
		) {
			return {
				panelMode,
				descriptorKey,
				taskId: existingDescriptor.taskId,
			};
		}

		const taskId = createHomeAgentSessionId(currentProjectId, runtimeProjectConfig.selectedAgentId);
		homeDescriptorByWorkspaceRef.current.set(currentProjectId, {
			descriptorKey,
			panelMode,
			taskId,
		});
		return {
			panelMode,
			descriptorKey,
			taskId,
		};
	}, [
		currentProjectId,
		clineProviderSettings.baseUrl,
		clineProviderSettings.modelId,
		clineProviderSettings.reasoningEffort,
		clineProviderSettings.oauthProvider,
		clineProviderSettings.providerId,
		runtimeProjectConfig?.effectiveCommand,
		runtimeProjectConfig?.selectedAgentId,
	]);

	const descriptorTaskId = descriptor?.taskId ?? null;
	const hasLoadedRuntimeProjectConfig = runtimeProjectConfig !== null;

	useEffect(() => {
		if (!currentProjectId || !hasLoadedRuntimeProjectConfig) {
			return;
		}

		const previousTaskId = desiredTaskIdByWorkspaceRef.current.get(currentProjectId) ?? null;

		if (!descriptorTaskId) {
			if (!previousTaskId) {
				return;
			}

			homeDescriptorByWorkspaceRef.current.delete(currentProjectId);
			desiredTaskIdByWorkspaceRef.current.delete(currentProjectId);
			startedSessionKeysRef.current.delete(
				buildHomeAgentSessionKey({
					workspaceId: currentProjectId,
					taskId: previousTaskId,
				}),
			);
			pruneWorkspaceHomeAgentSessions(setSessionSummaries, currentProjectId, null);
			void stopHomeAgentSession({
				workspaceId: currentProjectId,
				taskId: previousTaskId,
			});
			return;
		}

		if (previousTaskId === descriptorTaskId) {
			return;
		}

		desiredTaskIdByWorkspaceRef.current.set(currentProjectId, descriptorTaskId);
		pruneWorkspaceHomeAgentSessions(setSessionSummaries, currentProjectId, descriptorTaskId);

		if (!previousTaskId) {
			return;
		}

		startedSessionKeysRef.current.delete(
			buildHomeAgentSessionKey({
				workspaceId: currentProjectId,
				taskId: previousTaskId,
			}),
		);
		void stopHomeAgentSession({
			workspaceId: currentProjectId,
			taskId: previousTaskId,
		});
	}, [currentProjectId, descriptorTaskId, hasLoadedRuntimeProjectConfig, setSessionSummaries]);

	// When MCP settings or auth change, the runtime bumps the Cline session context version.
	// Reload the existing home chat in place so it keeps the same sidebar task id and messages,
	// but restarts the underlying Cline session with a fresh MCP tool bundle.
	useEffect(() => {
		if (!currentProjectId || !descriptor || descriptor.panelMode !== "chat") {
			return;
		}

		const previousVersion = previousClineSessionContextVersionByWorkspaceRef.current.get(currentProjectId);
		previousClineSessionContextVersionByWorkspaceRef.current.set(currentProjectId, clineSessionContextVersion);

		if (previousVersion === undefined || previousVersion === clineSessionContextVersion) {
			return;
		}

		if (!sessionSummaries[descriptor.taskId]) {
			return;
		}

		let cancelled = false;
		void getRuntimeTrpcClient(currentProjectId)
			.runtime.reloadTaskChatSession.mutate({
				taskId: descriptor.taskId,
			})
			.then((response) => {
				if (cancelled || disposedRef.current) {
					return;
				}
				if (!response.ok || !response.summary) {
					throw new Error(response.error ?? "Could not reload home agent session.");
				}
				upsertSessionSummary(response.summary);
			})
			.catch((error) => {
				if (cancelled || disposedRef.current) {
					return;
				}
				const message = error instanceof Error ? error.message : String(error);
				notifyError(message);
			});

		return () => {
			cancelled = true;
		};
	}, [clineSessionContextVersion, currentProjectId, descriptor, sessionSummaries, upsertSessionSummary]);

	useEffect(() => {
		if (!currentProjectId || !descriptor || descriptor.panelMode !== "terminal") {
			return;
		}

		const session = {
			workspaceId: currentProjectId,
			taskId: descriptor.taskId,
		} satisfies HomeAgentSessionIdentity;
		const sessionKey = buildHomeAgentSessionKey(session);

		if (desiredTaskIdByWorkspaceRef.current.get(session.workspaceId) !== session.taskId) {
			return;
		}

		if (startedSessionKeysRef.current.has(sessionKey)) {
			return;
		}

		if (pendingStartRequestIdsRef.current.has(sessionKey)) {
			return;
		}

		const requestId = nextStartRequestIdRef.current + 1;
		nextStartRequestIdRef.current = requestId;
		pendingStartRequestIdsRef.current.set(sessionKey, requestId);

		void (async () => {
			try {
				const geometry = estimateTaskSessionGeometry(window.innerWidth, window.innerHeight);
				const trpcClient = getRuntimeTrpcClient(session.workspaceId);
				const response = await trpcClient.runtime.startTaskSession.mutate({
					taskId: session.taskId,
					prompt: "",
					baseRef: latestBaseRefRef.current,
					cols: geometry.cols,
					rows: geometry.rows,
				});

				if (!response.ok || !response.summary) {
					throw new Error(response.error ?? "Could not start home agent session.");
				}

				if (pendingStartRequestIdsRef.current.get(sessionKey) !== requestId) {
					return;
				}
				pendingStartRequestIdsRef.current.delete(sessionKey);

				if (desiredTaskIdByWorkspaceRef.current.get(session.workspaceId) !== session.taskId) {
					await stopHomeAgentSession(session);
					return;
				}

				if (disposedRef.current) {
					return;
				}

				startedSessionKeysRef.current.add(sessionKey);
				upsertSessionSummary(response.summary);
			} catch (error) {
				if (pendingStartRequestIdsRef.current.get(sessionKey) !== requestId) {
					return;
				}
				pendingStartRequestIdsRef.current.delete(sessionKey);
				if (
					disposedRef.current ||
					desiredTaskIdByWorkspaceRef.current.get(session.workspaceId) !== session.taskId
				) {
					return;
				}
				const message = error instanceof Error ? error.message : String(error);
				notifyError(message);
			}
		})();
	}, [currentProjectId, descriptor, sessionSummaries, upsertSessionSummary]);

	useEffect(() => {
		return () => {
			disposedRef.current = true;
			desiredTaskIdByWorkspaceRef.current.clear();
			homeDescriptorByWorkspaceRef.current.clear();
			startedSessionKeysRef.current.clear();
			pendingStartRequestIdsRef.current.clear();
			previousClineSessionContextVersionByWorkspaceRef.current.clear();
		};
	}, []);

	return {
		panelMode: descriptor?.panelMode ?? null,
		taskId: descriptor?.taskId ?? null,
	};
}
