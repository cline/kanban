import {
	AnchorButton,
	Button,
	Callout,
	Classes,
	Dialog,
	DialogBody,
	DialogFooter,
	Divider,
	Icon,
	InputGroup,
	Tag,
} from "@blueprintjs/core";
import { useEffect, useMemo, useState } from "react";

import { useRuntimeConfig } from "@/kanban/runtime/use-runtime-config";
import type { RuntimeAgentDefinition, RuntimeAgentId, RuntimeProjectShortcut } from "@/kanban/runtime/types";

const AGENT_INSTALL_URLS: Partial<Record<RuntimeAgentId, string>> = {
	claude: "https://docs.anthropic.com/en/docs/claude-code/quickstart",
	codex: "https://github.com/openai/codex",
	gemini: "https://github.com/google-gemini/gemini-cli",
	opencode: "https://github.com/sst/opencode",
	cline: "https://www.npmjs.com/package/cline",
};

function AgentRow({
	agent,
	isSelected,
	onSelect,
	disabled,
}: {
	agent: RuntimeAgentDefinition;
	isSelected: boolean;
	onSelect: () => void;
	disabled: boolean;
}): React.ReactElement {
	const installUrl = AGENT_INSTALL_URLS[agent.id];

	return (
		<div
			role="button"
			tabIndex={0}
			onClick={() => { if (agent.installed && !disabled) { onSelect(); } }}
			onKeyDown={(event) => { if (event.key === "Enter" && agent.installed && !disabled) { onSelect(); } }}
			style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 0", cursor: agent.installed ? "pointer" : "default" }}
		>
			<div style={{ display: "flex", alignItems: "flex-start", gap: 8, minWidth: 0 }}>
				<Icon icon={isSelected ? "selection" : "circle"} intent={isSelected ? "primary" : undefined} className={!agent.installed ? Classes.TEXT_DISABLED : undefined} style={{ marginTop: 2 }} />
				<div style={{ minWidth: 0 }}>
					<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
						<span>{agent.label}</span>
						{agent.installed ? <Tag minimal intent="success">Installed</Tag> : null}
					</div>
					{agent.command ? (
						<p className={`${Classes.TEXT_MUTED} ${Classes.MONOSPACE_TEXT}`} style={{ margin: "2px 0 0" }}>
							{agent.command}
						</p>
					) : null}
				</div>
			</div>
			{!agent.installed && installUrl ? (
				<AnchorButton
					text="Install"
					variant="outlined"
					size="small"
					href={installUrl}
					target="_blank"
					rel="noreferrer"
					onClick={(event: React.MouseEvent) => event.stopPropagation()}
				/>
			) : !agent.installed ? (
				<Button text="Install" variant="outlined" size="small" disabled />
			) : null}
		</div>
	);
}

export function RuntimeSettingsDialog({
	open,
	workspaceId,
	onOpenChange,
	onSaved,
}: {
	open: boolean;
	workspaceId: string | null;
	onOpenChange: (open: boolean) => void;
	onSaved?: () => void;
}): React.ReactElement {
	const { config, isLoading, isSaving, save } = useRuntimeConfig(open, workspaceId);
	const [selectedAgentId, setSelectedAgentId] = useState<RuntimeAgentId>("claude");
	const [shortcuts, setShortcuts] = useState<RuntimeProjectShortcut[]>([]);
	const [saveError, setSaveError] = useState<string | null>(null);

	const supportedAgents = useMemo(() => config?.agents ?? [], [config?.agents]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const configuredAgentId = config?.selectedAgentId ?? null;
		const firstInstalledAgentId = supportedAgents.find((agent) => agent.installed)?.id;
		const fallbackAgentId = firstInstalledAgentId ?? supportedAgents[0]?.id ?? "claude";
		setSelectedAgentId(configuredAgentId ?? fallbackAgentId);
		setShortcuts(config?.shortcuts ?? []);
		setSaveError(null);
	}, [config?.selectedAgentId, config?.shortcuts, open, supportedAgents]);

	const handleSave = async () => {
		setSaveError(null);
		const selectedAgent = supportedAgents.find((agent) => agent.id === selectedAgentId);
		if (!selectedAgent || !selectedAgent.installed) {
			setSaveError("Selected agent is not installed. Install it first or choose an installed agent.");
			return;
		}
		const saved = await save({
			selectedAgentId,
			shortcuts,
		});
		if (!saved) {
			setSaveError("Could not save runtime settings. Check runtime logs and try again.");
			return;
		}
		onSaved?.();
		onOpenChange(false);
	};

	return (
		<Dialog
			isOpen={open}
			onClose={() => onOpenChange(false)}
			title="Settings"
			icon="cog"
		>
			<DialogBody>
				<h5 className={Classes.HEADING} style={{ margin: 0 }}>Global</h5>
				<p
					className={`${Classes.TEXT_MUTED} ${Classes.MONOSPACE_TEXT}`}
					style={{ margin: 0, wordBreak: "break-all", cursor: config?.globalConfigPath ? "pointer" : undefined }}
					onClick={() => { if (config?.globalConfigPath) { window.open(`file://${config.globalConfigPath}`); } }}
				>
					{config?.globalConfigPath ?? "~/.kanbanana/config.json"}
					{config?.globalConfigPath ? <Icon icon="share" style={{ marginLeft: 6, verticalAlign: "middle" }} size={12} /> : null}
				</p>

				<h6 className={Classes.HEADING} style={{ margin: "12px 0 0" }}>Agent runtime</h6>
				{supportedAgents.map((agent) => (
					<AgentRow
						key={agent.id}
						agent={agent}
						isSelected={agent.id === selectedAgentId}
						onSelect={() => setSelectedAgentId(agent.id)}
						disabled={isLoading || isSaving}
					/>
				))}
				{supportedAgents.length === 0 ? (
					<p className={Classes.TEXT_MUTED} style={{ padding: "8px 0" }}>No supported agents discovered.</p>
				) : null}

				<Divider style={{ margin: "16px 0" }} />

				<h5 className={Classes.HEADING} style={{ margin: 0 }}>Project</h5>
				<p
					className={`${Classes.TEXT_MUTED} ${Classes.MONOSPACE_TEXT}`}
					style={{ margin: 0, wordBreak: "break-all", cursor: config?.projectConfigPath ? "pointer" : undefined }}
					onClick={() => { if (config?.projectConfigPath) { window.open(`file://${config.projectConfigPath}`); } }}
				>
					{config?.projectConfigPath ?? "<project>/.kanbanana/config.json"}
					{config?.projectConfigPath ? <Icon icon="share" style={{ marginLeft: 6, verticalAlign: "middle" }} size={12} /> : null}
				</p>

				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "12px 0 8px" }}>
					<h6 className={Classes.HEADING} style={{ margin: 0 }}>Script shortcuts</h6>
					<Button
						icon="plus"
						text="Add"
						variant="minimal"
						size="small"
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
					/>
				</div>

				{shortcuts.map((shortcut) => (
					<div key={shortcut.id} style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 8, marginBottom: 4 }}>
						<InputGroup
							value={shortcut.label}
							onChange={(event) =>
								setShortcuts((current) =>
									current.map((item) =>
										item.id === shortcut.id
											? { ...item, label: event.target.value }
											: item,
									),
								)
							}
							placeholder="Label"
							size="small"
						/>
						<InputGroup
							value={shortcut.command}
							onChange={(event) =>
								setShortcuts((current) =>
									current.map((item) =>
										item.id === shortcut.id
											? { ...item, command: event.target.value }
											: item,
									),
								)
							}
							placeholder="Command"
							size="small"
						/>
						<Button
							icon="cross"
							variant="minimal"
							size="small"
							onClick={() => setShortcuts((current) => current.filter((item) => item.id !== shortcut.id))}
						/>
					</div>
				))}
				{shortcuts.length === 0 ? (
					<p className={Classes.TEXT_MUTED}>No shortcuts configured.</p>
				) : null}

				{saveError ? (
					<Callout intent="danger" compact style={{ marginTop: 12 }}>
						{saveError}
					</Callout>
				) : null}
			</DialogBody>
			<DialogFooter
				actions={
					<>
						<Button text="Cancel" variant="outlined" onClick={() => onOpenChange(false)} disabled={isSaving} />
						<Button text="Save" intent="primary" onClick={() => void handleSave()} disabled={isLoading || isSaving} />
					</>
				}
			/>
		</Dialog>
	);
}
