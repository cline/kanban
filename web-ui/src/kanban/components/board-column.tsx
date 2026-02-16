import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { preserveOffsetOnSource } from "@atlaskit/pragmatic-drag-and-drop/element/preserve-offset-on-source";
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { BoardCard, CardShadow } from "@/kanban/components/board-card";
import {
	getColumnData,
	isCardData,
	isCardDropTargetData,
	isColumnData,
	isDraggingCard,
	isDraggingColumn,
} from "@/kanban/dnd/data";
import type { BoardColumn as BoardColumnModel } from "@/kanban/types";
import { isSafari } from "@/kanban/utils/is-safari";
import { isShallowEqual } from "@/kanban/utils/is-shallow-equal";

type ColumnState =
	| { type: "idle" }
	| { type: "is-card-over"; isOverChildCard: boolean; dragging: DOMRect }
	| { type: "is-column-over" }
	| { type: "is-dragging" };

const idle: ColumnState = { type: "idle" };

const stateStyles: { [Key in ColumnState["type"]]?: string } = {
	"is-column-over": "bg-zinc-950",
	"is-dragging": "opacity-50",
};

const columnAccentColors: Record<string, string> = {
	backlog: "#71717a",
	planning: "#3b82f6",
	running: "#f59e0b",
	review: "#a855f7",
	done: "#22c55e",
};

export function BoardColumn({
	column,
	onAddCard,
}: {
	column: BoardColumnModel;
	onAddCard: (title: string) => void;
}): React.ReactElement {
	const outerRef = useRef<HTMLDivElement | null>(null);
	const innerRef = useRef<HTMLDivElement | null>(null);
	const headerRef = useRef<HTMLDivElement | null>(null);
	const scrollableRef = useRef<HTMLDivElement | null>(null);
	const [state, setState] = useState<ColumnState>(idle);
	const [isAdding, setIsAdding] = useState(false);
	const [newTitle, setNewTitle] = useState("");
	const inputRef = useRef<HTMLInputElement | null>(null);

	const accentColor = columnAccentColors[column.id] ?? "#71717a";

	useEffect(() => {
		if (isAdding && inputRef.current) {
			inputRef.current.focus();
		}
	}, [isAdding]);

	function handleStartAdding() {
		setIsAdding(true);
		requestAnimationFrame(() => {
			if (scrollableRef.current) {
				scrollableRef.current.scrollTop = scrollableRef.current.scrollHeight;
			}
		});
	}

	function handleSubmit() {
		const trimmed = newTitle.trim();
		if (trimmed) {
			onAddCard(trimmed);
		}
		setNewTitle("");
		setIsAdding(false);
	}

	useEffect(() => {
		const outer = outerRef.current;
		const inner = innerRef.current;
		const header = headerRef.current;
		const scrollable = scrollableRef.current;
		if (!outer || !inner || !header || !scrollable) {
			return;
		}

		const columnData = getColumnData({ column });

		return combine(
			draggable({
				element: header,
				getInitialData: () => columnData,
				onGenerateDragPreview({ source, nativeSetDragImage, location }) {
					if (!isColumnData(source.data)) {
						return;
					}

					setCustomNativeDragPreview({
						nativeSetDragImage,
						getOffset: preserveOffsetOnSource({ element: header, input: location.current.input }),
						render({ container }) {
							const rect = inner.getBoundingClientRect();
							const preview = inner.cloneNode(true);
							if (!(preview instanceof HTMLElement)) {
								return;
							}

							preview.style.width = `${rect.width}px`;
							preview.style.height = `${rect.height}px`;
							if (!isSafari()) {
								preview.style.transform = "rotate(4deg)";
							}

							container.appendChild(preview);
						},
					});
				},
				onDragStart() {
					setState({ type: "is-dragging" });
				},
				onDrop() {
					setState(idle);
				},
			}),
			dropTargetForElements({
				element: outer,
				getData: () => columnData,
				canDrop({ source }) {
					return isDraggingCard({ source }) || isDraggingColumn({ source });
				},
				getIsSticky: () => true,
				onDragStart({ source, location }) {
					if (!isCardData(source.data)) {
						return;
					}

					const innerMost = location.current.dropTargets[0];
					const isOverChildCard = Boolean(innerMost && isCardDropTargetData(innerMost.data));
					setState({ type: "is-card-over", dragging: source.data.rect, isOverChildCard });
				},
				onDragEnter({ source, location }) {
					if (isCardData(source.data)) {
						const innerMost = location.current.dropTargets[0];
						const isOverChildCard = Boolean(innerMost && isCardDropTargetData(innerMost.data));
						const proposed: ColumnState = {
							type: "is-card-over",
							dragging: source.data.rect,
							isOverChildCard,
						};
						setState((current) => (isShallowEqual(proposed, current) ? current : proposed));
						return;
					}

					if (isColumnData(source.data) && source.data.column.id !== column.id) {
						setState({ type: "is-column-over" });
					}
				},
				onDropTargetChange({ source, location }) {
					if (!isCardData(source.data)) {
						return;
					}

					const innerMost = location.current.dropTargets[0];
					const isOverChildCard = Boolean(innerMost && isCardDropTargetData(innerMost.data));
					const proposed: ColumnState = {
						type: "is-card-over",
						dragging: source.data.rect,
						isOverChildCard,
					};
					setState((current) => (isShallowEqual(proposed, current) ? current : proposed));
				},
				onDragLeave({ source }) {
					if (isColumnData(source.data) && source.data.column.id === column.id) {
						return;
					}

					setState(idle);
				},
				onDrop() {
					setState(idle);
				},
			}),
			autoScrollForElements({
				element: scrollable,
				canScroll: isDraggingCard,
				getConfiguration: () => ({ maxScrollSpeed: "fast" }),
			}),
		);
	}, [column]);

	return (
		<section
			ref={outerRef}
			className="flex min-h-0 min-w-0 flex-col border-r border-zinc-800 bg-zinc-900 last:border-r-0"
			style={{ "--col-accent": accentColor } as React.CSSProperties}
		>
			<div
				ref={innerRef}
				className={`flex min-h-0 flex-1 flex-col ${stateStyles[state.type] ?? ""}`}
				style={
					state.type === "is-card-over"
						? { boxShadow: `inset 0 0 0 2px ${accentColor}66` }
						: undefined
				}
			>
				<div
					ref={headerRef}
					className={`flex h-11 items-center justify-between px-3 ${state.type === "is-column-over" ? "invisible" : "cursor-grab"}`}
					style={{ backgroundColor: `${accentColor}65` }}
				>
					<div className="flex items-center gap-2">
						<span className="text-sm font-semibold text-zinc-200">{column.title}</span>
						<span className="text-xs font-medium text-white/60">{column.cards.length}</span>
					</div>
					<button
						type="button"
						onMouseDown={(e) => e.stopPropagation()}
						onClick={handleStartAdding}
						className="rounded p-1 text-zinc-400 transition-colors hover:text-zinc-200"
						aria-label={`Add task to ${column.title}`}
					>
						<Plus className="size-4" />
					</button>
				</div>

				<div
					ref={scrollableRef}
					className={`flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 ${state.type === "is-column-over" ? "invisible" : ""}`}
				>
					{column.cards.map((card) => (
						<BoardCard key={card.id} card={card} columnId={column.id} />
					))}

					{state.type === "is-card-over" && !state.isOverChildCard ? (
						<CardShadow dragging={state.dragging} />
					) : null}

					{isAdding ? (
						<input
							ref={inputRef}
							value={newTitle}
							onChange={(e) => setNewTitle(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									handleSubmit();
								}
								if (e.key === "Escape") {
									setNewTitle("");
									setIsAdding(false);
								}
							}}
							onBlur={handleSubmit}
							placeholder="Task title..."
							className="w-full flex-shrink-0 rounded-lg border-2 border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
						/>
					) : (
						<button
							type="button"
							onClick={handleStartAdding}
							className="flex w-full flex-shrink-0 items-center justify-center rounded-lg border-2 border-zinc-700 py-2 text-zinc-500 transition-colors hover:border-zinc-500 hover:text-zinc-300"
						>
							<Plus className="size-5" />
						</button>
					)}
				</div>
			</div>
		</section>
	);
}
