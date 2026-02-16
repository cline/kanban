import { Settings } from "lucide-react";

export function TopBar(): React.ReactElement {
	return (
		<header className="flex h-12 items-center justify-between border-b border-amber-600/20 bg-amber-400 px-4">
			<div className="flex items-center gap-2">
				<span className="text-lg" role="img" aria-label="banana">
					🍌
				</span>
				<span className="text-base font-semibold tracking-tight text-zinc-900">Kanbanana</span>
			</div>
			<button
				type="button"
				className="rounded-md p-1.5 text-amber-900/70 transition-colors hover:bg-amber-500/50 hover:text-amber-900"
				aria-label="Settings"
			>
				<Settings className="size-4" />
			</button>
		</header>
	);
}
