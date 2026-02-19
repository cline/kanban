import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRuntimeConfig } from "@/kanban/runtime/use-runtime-config";
import type {
	RuntimeAcpProbeResponse,
	RuntimeProjectShortcut,
	RuntimeSupportedAcpAgent,
} from "@/kanban/runtime/types";

interface RuntimeErrorPayload {
	error?: string;
}

export function RuntimeSettingsDialog({
	open,
	onOpenChange,
	onSaved,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSaved: () => void;
}): React.ReactElement {
	const { config, isLoading, isSaving, save } = useRuntimeConfig(open);
	const [commandInput, setCommandInput] = useState("");
	const [shortcuts, setShortcuts] = useState<RuntimeProjectShortcut[]>([]);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [isProbing, setIsProbing] = useState(false);
	const [probeResult, setProbeResult] = useState<RuntimeAcpProbeResponse | null>(null);

	useEffect(() => {
		if (!open) {
			return;
		}
		setCommandInput(config?.acpCommand ?? "");
		setShortcuts(config?.shortcuts ?? []);
		setSaveError(null);
		setProbeResult(null);
	}, [config?.acpCommand, config?.shortcuts, open]);

	const hasEnvOverride = config?.commandSource === "env";
	const supportedAgents = config?.supportedAgents ?? [];
	const effectiveCommand = config?.effectiveCommand?.trim() || null;

	const probeCommand = async (command: string): Promise<RuntimeAcpProbeResponse> => {
		const trimmed = command.trim();
		if (!trimmed) {
			return {
				ok: false,
				reason: "ACP command is empty.",
			};
		}

		setIsProbing(true);
		try {
			const response = await fetch("/api/runtime/acp/probe", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ command: trimmed }),
			});
			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as RuntimeErrorPayload | null;
				return {
					ok: false,
					reason: payload?.error ?? `ACP probe failed with ${response.status}`,
				};
			}
			return (await response.json()) as RuntimeAcpProbeResponse;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				ok: false,
				reason: message,
			};
		} finally {
			setIsProbing(false);
		}
	};

	const handleProbe = async () => {
		setSaveError(null);
		const result = await probeCommand(commandInput);
		setProbeResult(result);
	};

	const handleSave = async () => {
		setSaveError(null);
		const next = commandInput.trim();
		if (next) {
			const result = await probeCommand(next);
			setProbeResult(result);
			if (!result.ok) {
				setSaveError(result.reason ?? "ACP command probe failed.");
				return;
			}
		}

		const saved = await save({
			acpCommand: next ? next : null,
			shortcuts,
		});
		if (!saved) {
			setSaveError("Could not save runtime settings. Check runtime logs and try again.");
			return;
		}
		onSaved();
		onOpenChange(false);
	};

	const renderAgentState = (agent: RuntimeSupportedAcpAgent): string => {
		if (agent.configured && agent.installed) {
			return "Configured";
		}
		if (agent.configured && !agent.installed) {
			return "Configured, dependency missing";
		}
		if (agent.installed) {
			return "Installed";
		}
		return "Not installed";
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
				<DialogHeader>
					<DialogTitle>ACP Runtime Setup</DialogTitle>
					<DialogDescription className="text-zinc-400">
						Set and verify the ACP command Kanbanana should run for task sessions.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-3">
					<div className="space-y-1">
						<label htmlFor="acp-command-input" className="text-xs text-zinc-400">
							ACP command (project)
						</label>
						<div className="flex items-center gap-2">
							<input
								id="acp-command-input"
								value={commandInput}
								onChange={(event) => {
									setCommandInput(event.target.value);
									setProbeResult(null);
								}}
								placeholder="npx @zed-industries/codex-acp@latest"
								className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
								disabled={isLoading || isSaving || isProbing}
							/>
							<Button
								type="button"
								variant="outline"
								onClick={() => {
									void handleProbe();
								}}
								disabled={isLoading || isSaving || isProbing || !commandInput.trim()}
							>
								{isProbing ? "Testing..." : "Test"}
							</Button>
						</div>
					</div>

					{probeResult ? (
						probeResult.ok ? (
							<p className="text-xs text-emerald-300">ACP probe succeeded for this command.</p>
						) : (
							<p className="whitespace-pre-wrap text-xs text-red-300">{probeResult.reason ?? "ACP probe failed."}</p>
						)
					) : null}

					<div className="space-y-2 rounded border border-zinc-800 p-3">
						<div className="flex items-center justify-between gap-2">
							<p className="text-xs text-zinc-400">Supported ACP commands</p>
							<p className="text-[11px] text-zinc-500">
								Detected binaries: {(config?.detectedCommands ?? []).join(", ") || "none"}
							</p>
						</div>
						<div className="space-y-2">
							{supportedAgents.map((agent) => (
								<div key={agent.id} className="rounded border border-zinc-800 bg-zinc-950/70 p-2">
									<div className="flex items-center justify-between gap-3">
										<div className="min-w-0">
											<p className="text-sm text-zinc-100">{agent.label}</p>
											<p className="truncate font-mono text-[11px] text-zinc-500">{agent.command}</p>
										</div>
										<Button
											type="button"
											variant={agent.configured ? "secondary" : "outline"}
											size="sm"
											onClick={() => {
												setCommandInput(agent.command);
												setProbeResult(null);
											}}
											disabled={isLoading || isSaving || isProbing}
										>
											{agent.configured ? "Selected" : "Use"}
										</Button>
									</div>
									<p className="mt-1 text-[11px] text-zinc-400">{renderAgentState(agent)}</p>
								</div>
							))}
							{supportedAgents.length === 0 ? (
								<p className="text-xs text-zinc-500">No supported ACP commands were returned by runtime.</p>
							) : null}
						</div>
					</div>

					{effectiveCommand ? (
						<p className="text-xs text-zinc-500">Current runtime command: {effectiveCommand}</p>
					) : (
						<p className="text-xs text-amber-300">No ACP command is configured yet.</p>
					)}
					<p className="text-xs text-zinc-500">Global config path: {config?.configPath ?? "~/.kanbanana/config.json"}</p>

					<div className="space-y-2 rounded border border-zinc-800 p-3">
						<div className="flex items-center justify-between">
							<p className="text-xs text-zinc-400">Script shortcuts</p>
							<button
								type="button"
								onClick={() =>
									setShortcuts((current) => [
										...current,
										{
											id: crypto.randomUUID(),
											label: "Run",
											command: "",
										},
									])
								}
								className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500"
							>
								Add
							</button>
						</div>
						<div className="space-y-2">
							{shortcuts.map((shortcut) => (
								<div key={shortcut.id} className="grid grid-cols-[1fr_2fr_auto] gap-2">
									<input
										value={shortcut.label}
										onChange={(event) =>
											setShortcuts((current) =>
												current.map((item) =>
													item.id === shortcut.id
														? {
																...item,
																label: event.target.value,
															}
														: item,
												),
											)
										}
										placeholder="Label"
										className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
									/>
									<input
										value={shortcut.command}
										onChange={(event) =>
											setShortcuts((current) =>
												current.map((item) =>
													item.id === shortcut.id
														? {
																...item,
																command: event.target.value,
															}
														: item,
												),
											)
										}
										placeholder="Command"
										className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
									/>
									<button
										type="button"
										onClick={() => setShortcuts((current) => current.filter((item) => item.id !== shortcut.id))}
										className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500"
									>
										Remove
									</button>
								</div>
							))}
							{shortcuts.length === 0 ? <p className="text-xs text-zinc-500">No shortcuts configured yet.</p> : null}
						</div>
					</div>

					{hasEnvOverride ? (
						<p className="text-xs text-amber-300">
							`KANBANANA_ACP_COMMAND` is set and currently overrides project config.
						</p>
					) : null}
					{saveError ? <p className="whitespace-pre-wrap text-xs text-red-300">{saveError}</p> : null}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving || isProbing}>
						Cancel
					</Button>
					<Button onClick={() => void handleSave()} disabled={isLoading || isSaving || isProbing}>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
