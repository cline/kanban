import { X } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/components/ui/cn";
import { Tooltip } from "@/components/ui/tooltip";
import type { TaskImage } from "@/types";

interface TaskImageStripProps {
	images: TaskImage[];
	onRemoveImage?: (imageId: string) => void;
	className?: string;
	label?: string | null;
}

export function TaskImageStrip({
	images,
	onRemoveImage,
	className,
	label = null,
}: TaskImageStripProps): ReactElement | null {
	if (images.length === 0) {
		return null;
	}

	return (
		<div className={className}>
			{label ? (
				<div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">{label}</div>
			) : null}
			<div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto pr-1">
				{images.map((image) => {
					const preview = (
						<>
							<img
								src={`data:${image.mimeType};base64,${image.data}`}
								alt={image.name ?? "attached image"}
								className="h-5 w-5 rounded object-cover"
							/>
							<span className="min-w-0 max-w-32 truncate text-[11px] text-text-secondary">
								{image.name ?? "Image"}
							</span>
							{onRemoveImage ? (
								<X size={12} className="shrink-0 text-text-tertiary group-hover:text-accent" />
							) : null}
						</>
					);

					if (!onRemoveImage) {
						return (
							<div
								key={image.id}
								className="inline-flex max-w-[260px] min-w-0 items-center gap-1.5 rounded-md border border-border-bright bg-surface-2 px-1.5 py-1"
							>
								{preview}
							</div>
						);
					}

					return (
						<Tooltip key={image.id} content="Click to delete">
							<button
								type="button"
								onClick={() => onRemoveImage(image.id)}
								className={cn(
									"group inline-flex max-w-[260px] min-w-0 cursor-pointer items-center gap-1.5 rounded-md border border-border-bright bg-surface-2 px-1.5 py-1 hover:border-border-focus",
								)}
								aria-label={`Delete ${image.name ?? "image"}`}
							>
								{preview}
							</button>
						</Tooltip>
					);
				})}
			</div>
		</div>
	);
}
