import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRuntimeConfig } from "@/kanban/runtime/use-runtime-config";
import type { RuntimeAgentDefinition, RuntimeAgentId, RuntimeProjectShortcut } from "@/kanban/runtime/types";

const AGENT_INSTALL_URLS: Partial<Record<RuntimeAgentId, string>> = {
	claude: "https://docs.anthropic.com/en/docs/claude-code/quickstart",
	codex: "https://github.com/openai/codex",
	gemini: "https://github.com/google-gemini/gemini-cli",
	opencode: "https://github.com/sst/opencode",
};

function getAgentState(agent: RuntimeAgentDefinition): string {
	if (agent.installed) {
		return "Installed";
	}
	return "Not installed";
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
	const [selectedAgentId, setSelectedAgentId] = useState<RuntimeAgentId>("claude");
	const [customCommand, setCustomCommand] = useState("");
	const [shortcuts, setShortcuts] = useState<RuntimeProjectShortcut[]>([]);
	const [saveError, setSaveError] = useState<string | null>(null);

	const supportedAgents = useMemo(() => {
		return (config?.agents ?? []).filter((agent) => agent.id !== "custom");
	}, [config?.agents]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const configuredAgentId = config?.selectedAgentId ?? null;
		const firstInstalledAgentId = supportedAgents.find((agent) => agent.installed)?.id;
		const fallbackAgentId = firstInstalledAgentId ?? supportedAgents[0]?.id ?? "claude";
		setSelectedAgentId(configuredAgentId ?? fallbackAgentId);
		setCustomCommand(config?.customAgentCommand ?? "");
		setShortcuts(config?.shortcuts ?? []);
		setSaveError(null);
	}, [config?.customAgentCommand, config?.selectedAgentId, config?.shortcuts, open, supportedAgents]);

	const handleSave = async () => {
		setSaveError(null);
		const trimmedCustomCommand = customCommand.trim();
		if (selectedAgentId === "custom" && !trimmedCustomCommand) {
			setSaveError("Custom command cannot be empty.");
			return;
		}
		if (selectedAgentId !== "custom") {
			const selectedAgent = supportedAgents.find((agent) => agent.id === selectedAgentId);
			if (!selectedAgent || !selectedAgent.installed) {
				setSaveError("Selected agent is not installed. Install it first or choose an installed agent.");
				return;
			}
		}
		const saved = await save({
			selectedAgentId,
			customAgentCommand: trimmedCustomCommand || null,
			shortcuts,
		});
		if (!saved) {
			setSaveError("Could not save runtime settings. Check runtime logs and try again.");
			return;
		}
		onSaved();
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="border-border bg-card text-foreground">
				<DialogHeader>
					<DialogTitle>Agent Runtime Setup</DialogTitle>
					<DialogDescription className="text-muted-foreground">
						Choose one installed agent. If an agent is missing, use Install.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-3">
					<div className="space-y-2 rounded border border-border p-3">
						<div className="flex items-center justify-between gap-2">
							<p className="text-xs text-muted-foreground">Supported agents</p>
							<p className="text-[11px] text-muted-foreground">
								{(config?.detectedCommands ?? []).join(", ") || "No agent binaries detected"}
							</p>
						</div>
						<div className="space-y-2">
							{supportedAgents.map((agent) => {
								const installUrl = AGENT_INSTALL_URLS[agent.id];
								return (
									<div key={agent.id} className="rounded border border-border bg-background/70 p-2">
										<div className="flex items-center justify-between gap-3">
											<div className="min-w-0">
												<p className="text-sm text-foreground">{agent.label}</p>
												{agent.command ? (
													<p className="truncate font-mono text-[11px] text-muted-foreground">{agent.command}</p>
												) : null}
											</div>
											{agent.installed ? (
												<Button
													type="button"
													variant={agent.id === selectedAgentId ? "secondary" : "outline"}
													size="sm"
													onClick={() => setSelectedAgentId(agent.id)}
													disabled={isLoading || isSaving}
												>
													{agent.id === selectedAgentId ? "Selected" : "Use"}
												</Button>
											) : installUrl ? (
												<Button type="button" variant="outline" size="sm" asChild>
													<a href={installUrl} target="_blank" rel="noreferrer">
														Install
													</a>
												</Button>
											) : (
												<Button type="button" variant="outline" size="sm" disabled>
													Install
												</Button>
											)}
										</div>
										<p className="mt-1 text-[11px] text-muted-foreground">{getAgentState(agent)}</p>
									</div>
								);
							})}
							{supportedAgents.length === 0 ? (
								<p className="text-xs text-muted-foreground">No supported agents discovered.</p>
							) : null}
						</div>
					</div>

					<div className="space-y-2 rounded border border-border p-3">
						<div className="flex items-center justify-between gap-3">
							<div>
								<p className="text-xs text-muted-foreground">Custom command</p>
								<p className="text-[11px] text-muted-foreground">Use if your agent binary is non-standard.</p>
							</div>
							<Button
								type="button"
								variant={selectedAgentId === "custom" ? "secondary" : "outline"}
								size="sm"
								onClick={() => setSelectedAgentId("custom")}
								disabled={isLoading || isSaving}
							>
								{selectedAgentId === "custom" ? "Selected" : "Use custom"}
							</Button>
						</div>
						<input
							value={customCommand}
							onChange={(event) => setCustomCommand(event.target.value)}
							placeholder="claude --dangerously-skip-permissions"
							className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
							disabled={isLoading || isSaving}
						/>
					</div>

					{config?.effectiveCommand ? (
						<p className="text-xs text-muted-foreground">Current runtime command: {config.effectiveCommand}</p>
					) : (
						<p className="text-xs text-amber-300">No runnable agent command configured yet.</p>
					)}
					<p className="text-xs text-muted-foreground">Global config path: {config?.configPath ?? "~/.kanbanana/config.json"}</p>

					<div className="space-y-2 rounded border border-border p-3">
						<div className="flex items-center justify-between">
							<p className="text-xs text-muted-foreground">Script shortcuts</p>
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
								className="rounded border border-border px-2 py-1 text-xs text-foreground hover:border-muted-foreground/80"
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
										className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
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
										className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
									/>
									<button
										type="button"
										onClick={() => setShortcuts((current) => current.filter((item) => item.id !== shortcut.id))}
										className="rounded border border-border px-2 py-1 text-xs text-foreground hover:border-muted-foreground/80"
									>
										Remove
									</button>
								</div>
							))}
							{shortcuts.length === 0 ? <p className="text-xs text-muted-foreground">No shortcuts configured yet.</p> : null}
						</div>
					</div>

					{saveError ? <p className="whitespace-pre-wrap text-xs text-red-300">{saveError}</p> : null}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
						Cancel
					</Button>
					<Button onClick={() => void handleSave()} disabled={isLoading || isSaving}>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
