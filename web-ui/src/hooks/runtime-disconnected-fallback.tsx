import { Classes, Colors, NonIdealState } from "@blueprintjs/core";
import type { ReactElement } from "react";

export function RuntimeDisconnectedFallback(): ReactElement {
	return (
		<div
			className={Classes.DARK}
			style={{
				display: "flex",
				height: "100svh",
				alignItems: "center",
				justifyContent: "center",
				background: Colors.DARK_GRAY1,
				padding: "24px",
			}}
		>
			<NonIdealState
				icon="error"
				title="Disconnected from kanban"
				description="Run kanban again in your terminal, then reload this tab."
			/>
		</div>
	);
}
