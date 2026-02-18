import { ArrowLeft, Settings } from "lucide-react";

export function TopBar({
	onBack,
	subtitle,
}: {
	onBack?: () => void;
	subtitle?: string;
}): React.ReactElement {
	return (
		<header className="flex h-12 items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4">
			<div className="flex items-center gap-2">
				{onBack ? (
					<button
						type="button"
						onClick={onBack}
						className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
						aria-label="Back to board"
					>
						<ArrowLeft className="size-4" />
					</button>
				) : null}
				<span className="text-lg" role="img" aria-label="banana">
					🍌
				</span>
				<span className="text-base font-semibold tracking-tight text-amber-300">Kanbanana</span>
				{subtitle ? (
					<>
						<span className="text-zinc-600">/</span>
						<span className="text-sm font-medium text-zinc-400">{subtitle}</span>
					</>
				) : null}
			</div>
			<button
				type="button"
				className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
				aria-label="Settings"
			>
				<Settings className="size-4" />
			</button>
		</header>
	);
}
