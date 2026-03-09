import { Classes, Colors, Dialog, DialogBody, KeyComboTag } from "@blueprintjs/core";

interface ShortcutEntry {
	combo: string;
	description: string;
}

interface ShortcutGroup {
	title: string;
	shortcuts: ShortcutEntry[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
	{
		title: "General",
		shortcuts: [{ combo: "C", description: "Create new task" }],
	},
	{
		title: "Terminal",
		shortcuts: [
			{ combo: "mod+j", description: "Toggle terminal" },
			{ combo: "mod+m", description: "Expand / collapse terminal" },
		],
	},
	{
		title: "Card detail",
		shortcuts: [
			{ combo: "esc", description: "Back to board" },
			{ combo: "up", description: "Previous card" },
			{ combo: "down", description: "Next card" },
		],
	},
	{
		title: "Task prompt",
		shortcuts: [{ combo: "mod+enter", description: "Submit prompt" }],
	},
	{
		title: "Git history",
		shortcuts: [
			{ combo: "up", description: "Previous commit" },
			{ combo: "down", description: "Next commit" },
		],
	},
	{
		title: "Dependencies",
		shortcuts: [{ combo: "mod", description: "Hold to enter linking mode" }],
	},
];

export function KeyboardShortcutsDialog({
	isOpen,
	onClose,
}: {
	isOpen: boolean;
	onClose: () => void;
}): React.ReactElement {
	return (
		<Dialog isOpen={isOpen} onClose={onClose} title="Keyboard shortcuts" icon="key" style={{ width: 480 }}>
			<DialogBody>
				{SHORTCUT_GROUPS.map((group) => (
					<div key={group.title} style={{ marginBottom: 16 }}>
						<h6 className={Classes.HEADING} style={{ margin: "0 0 8px 0", color: Colors.GRAY4 }}>
							{group.title}
						</h6>
						{group.shortcuts.map((shortcut) => (
							<div
								key={`${group.title}-${shortcut.combo}-${shortcut.description}`}
								style={{
									display: "flex",
									justifyContent: "space-between",
									alignItems: "center",
									padding: "6px 0",
									borderBottom: `1px solid ${Colors.DARK_GRAY5}`,
								}}
							>
								<span style={{ fontSize: "var(--bp-typography-size-body-medium)" }}>
									{shortcut.description}
								</span>
								<KeyComboTag combo={shortcut.combo} />
							</div>
						))}
					</div>
				))}
			</DialogBody>
		</Dialog>
	);
}
