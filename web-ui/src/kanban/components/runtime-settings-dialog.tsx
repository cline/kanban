import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRuntimeConfig } from "@/kanban/runtime/use-runtime-config";

const suggestedByBinary: Record<string, string> = {
	codex: "codex --acp",
	claude: "claude --acp",
	gemini: "gemini --acp",
};

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

	useEffect(() => {
		if (!open) {
			return;
		}
		setCommandInput(config?.acpCommand ?? "");
	}, [config?.acpCommand, open]);

	const suggestions = useMemo(() => {
		const detected = config?.detectedCommands ?? [];
		return detected.map((command) => ({
			id: command,
			value: suggestedByBinary[command] ?? command,
		}));
	}, [config?.detectedCommands]);

	const hasEnvOverride = config?.commandSource === "env";

	const handleSave = async () => {
		const next = commandInput.trim();
		await save(next ? next : null);
		onSaved();
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
				<DialogHeader>
					<DialogTitle>ACP Runtime Setup</DialogTitle>
					<DialogDescription className="text-zinc-400">
						Set the ACP command Kanbanana should run for task sessions.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-3">
					<div className="space-y-1">
						<label htmlFor="acp-command-input" className="text-xs text-zinc-400">
							ACP command
						</label>
						<input
							id="acp-command-input"
							value={commandInput}
							onChange={(event) => setCommandInput(event.target.value)}
							placeholder="codex --acp"
							className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
							disabled={isLoading || isSaving}
						/>
					</div>
					{suggestions.length > 0 ? (
						<div className="space-y-1">
							<p className="text-xs text-zinc-500">Detected binaries</p>
							<div className="flex flex-wrap gap-2">
								{suggestions.map((suggestion) => (
									<button
										type="button"
										key={suggestion.id}
										onClick={() => setCommandInput(suggestion.value)}
										className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500"
									>
										{suggestion.value}
									</button>
								))}
							</div>
						</div>
					) : null}
					<p className="text-xs text-zinc-500">Project config path: {config?.configPath ?? ".kanbanana/config.json"}</p>
					{hasEnvOverride ? (
						<p className="text-xs text-amber-300">`KANBANANA_ACP_COMMAND` is set and currently overrides project config.</p>
					) : null}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={isLoading || isSaving}>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
