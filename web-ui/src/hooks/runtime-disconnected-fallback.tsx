import { AlertCircle, RefreshCw } from "lucide-react";
import type { ReactElement } from "react";

const isDesktopApp = typeof navigator !== "undefined" && navigator.userAgent.includes("Electron");

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
				<h3 className="font-semibold text-text-primary">
					{isDesktopApp ? "Kanban Runtime Disconnected" : "Disconnected from Cline"}
				</h3>
				<p className="text-text-secondary text-center max-w-sm">
					{isDesktopApp
						? "The runtime process stopped unexpectedly. The app will attempt to restart it automatically. If this persists, try quitting and reopening the app."
						: "Run cline again in your terminal, then reload this tab."}
				</p>
				{isDesktopApp && (
					<button
						type="button"
						onClick={() => window.location.reload()}
						className="mt-2 flex items-center gap-2 rounded-md bg-surface-2 px-4 py-2 text-sm text-text-primary hover:bg-surface-3 transition-colors"
					>
						<RefreshCw size={14} />
						Reload
					</button>
				)}
			</div>
		</div>
	);
}
