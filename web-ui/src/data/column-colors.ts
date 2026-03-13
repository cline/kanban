// Column accent colors for the sys/terminal aesthetic.
// Values reference CSS custom properties defined in globals.css — single source of truth.

export const panelSeparatorColor = "var(--kb-border-panel)";

// Top-border accent strip color per column
export const columnAccentColors: Record<string, string> = {
	backlog: "var(--kb-col-backlog-accent)",
	in_progress: "var(--kb-col-active-accent)",
	review: "var(--kb-col-review-accent)",
	trash: "var(--kb-col-trash-accent)",
};

// Lighter text color (count, meta) per column
export const columnLightColors: Record<string, string> = {
	backlog: "var(--kb-col-backlog-light)",
	in_progress: "var(--kb-col-active-light)",
	review: "var(--kb-col-review-light)",
	trash: "var(--kb-col-trash-light)",
};

// All columns share the same body background (slightly darker than app surface)
export const columnBgColor = "var(--kb-surface-col-bg)";

