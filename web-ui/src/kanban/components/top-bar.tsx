import { ArrowLeft, Settings } from "lucide-react";

export function TopBar({
	onBack,
	subtitle,
}: {
	onBack?: () => void;
	subtitle?: string;
}): React.ReactElement {
	return (
		<header className="flex h-12 items-center justify-between border-b border-amber-600/20 bg-amber-400 px-4">
			<div className="flex items-center gap-2">
				{onBack ? (
					<button
						type="button"
						onClick={onBack}
						className="rounded-md p-1 text-amber-900/70 hover:bg-amber-500/50 hover:text-amber-900"
						aria-label="Back to board"
					>
						<ArrowLeft className="size-4" />
					</button>
				) : null}
				<span className="text-lg" role="img" aria-label="banana">
					🍌
				</span>
				<span className="text-base font-semibold tracking-tight text-zinc-900">Kanbanana</span>
				{subtitle ? (
					<>
						<span className="text-zinc-900/40">/</span>
						<span className="text-sm font-medium text-zinc-900/70">{subtitle}</span>
					</>
				) : null}
			</div>
			<button
				type="button"
				className="rounded-md p-1.5 text-amber-900/70 hover:bg-amber-500/50 hover:text-amber-900"
				aria-label="Settings"
			>
				<Settings className="size-4" />
			</button>
		</header>
	);
}
