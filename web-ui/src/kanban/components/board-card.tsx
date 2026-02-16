import {
	type Edge,
	attachClosestEdge,
	extractClosestEdge,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { preserveOffsetOnSource } from "@atlaskit/pragmatic-drag-and-drop/element/preserve-offset-on-source";
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
	getCardData,
	getCardDropTargetData,
	isCardData,
	isDraggingCard,
} from "@/kanban/dnd/data";
import type { BoardCard as BoardCardModel } from "@/kanban/types";
import { isSafari } from "@/kanban/utils/is-safari";
import { isShallowEqual } from "@/kanban/utils/is-shallow-equal";

type CardState =
	| { type: "idle" }
	| { type: "is-dragging" }
	| { type: "is-dragging-and-left-self" }
	| { type: "is-over"; dragging: DOMRect; closestEdge: Edge }
	| { type: "preview"; container: HTMLElement; dragging: DOMRect };

const idle: CardState = { type: "idle" };

const innerStyles: { [Key in CardState["type"]]?: string } = {
	idle: "cursor-grab card-interactive",
	"is-dragging": "opacity-40",
};

const outerStyles: { [Key in CardState["type"]]?: string } = {
	"is-dragging-and-left-self": "hidden",
};

export function CardShadow({ dragging }: { dragging: DOMRect }): React.ReactElement {
	return (
		<div
			className="flex-shrink-0 rounded-lg border-2 border-dashed bg-zinc-800/50"
			style={{ height: dragging.height, borderColor: "var(--col-accent)" }}
		/>
	);
}

function CardDisplay({
	card,
	state,
	outerRef,
	innerRef,
}: {
	card: BoardCardModel;
	state: CardState;
	outerRef?: React.MutableRefObject<HTMLDivElement | null>;
	innerRef?: React.MutableRefObject<HTMLDivElement | null>;
}): React.ReactElement {
	return (
		<div ref={outerRef} className={`flex flex-shrink-0 flex-col gap-2 ${outerStyles[state.type] ?? ""}`}>
			{state.type === "is-over" && state.closestEdge === "top" ? (
				<CardShadow dragging={state.dragging} />
			) : null}

			<article
				ref={innerRef}
				className={`rounded-lg border-2 border-zinc-700 bg-zinc-800 p-3 shadow-md ${innerStyles[state.type] ?? ""}`}
				style={
					state.type === "preview"
						? {
								width: state.dragging.width,
								height: state.dragging.height,
								transform: !isSafari() ? "rotate(4deg)" : undefined,
							}
						: undefined
				}
			>
				<p className="text-sm font-medium leading-snug text-zinc-100">{card.title}</p>
				{card.body ? (
					<p className="mt-1 line-clamp-2 text-sm leading-relaxed text-zinc-400">{card.body}</p>
				) : null}
			</article>

			{state.type === "is-over" && state.closestEdge === "bottom" ? (
				<CardShadow dragging={state.dragging} />
			) : null}
		</div>
	);
}

export function BoardCard({
	card,
	columnId,
}: {
	card: BoardCardModel;
	columnId: string;
}): React.ReactElement {
	const outerRef = useRef<HTMLDivElement | null>(null);
	const innerRef = useRef<HTMLDivElement | null>(null);
	const [state, setState] = useState<CardState>(idle);

	useEffect(() => {
		const outer = outerRef.current;
		const inner = innerRef.current;
		if (!outer || !inner) {
			return;
		}

		return combine(
			draggable({
				element: inner,
				getInitialData: ({ element }) =>
					getCardData({
						card,
						columnId,
						rect: element.getBoundingClientRect(),
					}),
				onGenerateDragPreview({ source, nativeSetDragImage, location }) {
					if (!isCardData(source.data)) {
						return;
					}

					setCustomNativeDragPreview({
						nativeSetDragImage,
						getOffset: preserveOffsetOnSource({ element: inner, input: location.current.input }),
						render({ container }) {
							setState({
								type: "preview",
								container,
								dragging: inner.getBoundingClientRect(),
							});
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
				getIsSticky: () => true,
				canDrop: isDraggingCard,
				getData({ element, input }) {
					return attachClosestEdge(getCardDropTargetData({ card, columnId }), {
						element,
						input,
						allowedEdges: ["top", "bottom"],
					});
				},
				onDragEnter({ source, self }) {
					if (!isCardData(source.data) || source.data.card.id === card.id) {
						return;
					}

					const closestEdge = extractClosestEdge(self.data);
					if (!closestEdge) {
						return;
					}

					setState({
						type: "is-over",
						dragging: source.data.rect,
						closestEdge,
					});
				},
				onDrag({ source, self }) {
					if (!isCardData(source.data) || source.data.card.id === card.id) {
						return;
					}

					const closestEdge = extractClosestEdge(self.data);
					if (!closestEdge) {
						return;
					}

					const proposed: CardState = {
						type: "is-over",
						dragging: source.data.rect,
						closestEdge,
					};

					setState((current) => (isShallowEqual(proposed, current) ? current : proposed));
				},
				onDragLeave({ source }) {
					if (!isCardData(source.data)) {
						return;
					}

					if (source.data.card.id === card.id) {
						setState({ type: "is-dragging-and-left-self" });
						return;
					}

					setState(idle);
				},
				onDrop() {
					setState(idle);
				},
			}),
		);
	}, [card, columnId]);

	return (
		<>
			<CardDisplay outerRef={outerRef} innerRef={innerRef} state={state} card={card} />
			{state.type === "preview"
				? createPortal(<CardDisplay state={state} card={card} />, state.container)
				: null}
		</>
	);
}
