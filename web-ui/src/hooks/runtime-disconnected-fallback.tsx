import { AlertCircle } from "lucide-react";
import type { ReactElement } from "react";

export function RuntimeDisconnectedFallback(): ReactElement {
	return (
		<div
			style={{
				display: "flex",
				height: "100svh",
				alignItems: "center",
				justifyContent: "center",
				background: "var(--color-surface-0)",
				padding: "24px",
			}}
		>
			<div className="flex flex-col items-center justify-center gap-3 py-12 text-text-tertiary">
				<AlertCircle size={48} />
				<h3 className="font-semibold text-text-primary">Disconnected from Kanban</h3>
				<p className="text-text-secondary">Restart the Kanban runtime, then reload this tab.</p>
			</div>
		</div>
	);
}
