import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface DependencyLinkDraft {
	sourceTaskId: string;
	targetTaskId: string | null;
	pointerClientX: number;
	pointerClientY: number;
}

function getTaskIdFromPoint(clientX: number, clientY: number): string | null {
	if (typeof document === "undefined") {
		return null;
	}
	const element = document.elementFromPoint(clientX, clientY);
	if (!(element instanceof HTMLElement)) {
		return null;
	}
	const card = element.closest<HTMLElement>("[data-task-id]");
	return card?.dataset.taskId ?? null;
}

export function useDependencyLinking({
	onCreateDependency,
}: {
	onCreateDependency?: (fromTaskId: string, toTaskId: string) => void;
}): {
	draft: DependencyLinkDraft | null;
	isModifierPressed: boolean;
	onDependencyPointerDown: (taskId: string, event: ReactMouseEvent<HTMLElement>) => void;
	onDependencyPointerEnter: (taskId: string) => void;
} {
	const [draft, setDraft] = useState<DependencyLinkDraft | null>(null);
	const [isModifierPressed, setIsModifierPressed] = useState(false);
	const draftRef = useRef<DependencyLinkDraft | null>(null);
	const modifierPressedRef = useRef(false);

	const completeDependencyLink = useCallback(
		(taskId: string | null): boolean => {
			const current = draftRef.current;
			if (!current || !taskId || taskId === current.sourceTaskId) {
				return false;
			}
			onCreateDependency?.(current.sourceTaskId, taskId);
			draftRef.current = null;
			setDraft(null);
			return true;
		},
		[onCreateDependency],
	);

	useEffect(() => {
		draftRef.current = draft;
	}, [draft]);

	useEffect(() => {
		const handleKeyStateChange = (event: KeyboardEvent) => {
			const nextModifierPressed = event.metaKey || event.ctrlKey;
			modifierPressedRef.current = nextModifierPressed;
			setIsModifierPressed(nextModifierPressed);
		};
		const handleWindowBlur = () => {
			modifierPressedRef.current = false;
			setIsModifierPressed(false);
			draftRef.current = null;
			setDraft(null);
		};
		window.addEventListener("keydown", handleKeyStateChange);
		window.addEventListener("keyup", handleKeyStateChange);
		window.addEventListener("blur", handleWindowBlur);
		return () => {
			window.removeEventListener("keydown", handleKeyStateChange);
			window.removeEventListener("keyup", handleKeyStateChange);
			window.removeEventListener("blur", handleWindowBlur);
		};
	}, []);

	const isLinking = draft !== null;

	useEffect(() => {
		if (!isLinking) {
			if (typeof document !== "undefined") {
				document.body.classList.remove("kb-dependency-link-mode");
			}
			return;
		}

		document.body.classList.add("kb-dependency-link-mode");

		const handleMouseMove = (event: MouseEvent) => {
			const targetTaskId = getTaskIdFromPoint(event.clientX, event.clientY);
			setDraft((current) => {
				if (!current) {
					return current;
				}
				return {
					...current,
					pointerClientX: event.clientX,
					pointerClientY: event.clientY,
					targetTaskId,
				};
			});
		};

		const handleMouseUp = (event: MouseEvent) => {
			const targetTaskId = getTaskIdFromPoint(event.clientX, event.clientY);
			setDraft(() => {
				const current = draftRef.current;
				if (!current) {
					return null;
				}
				const resolvedTargetTaskId = targetTaskId ?? current.targetTaskId;
				if (modifierPressedRef.current && completeDependencyLink(resolvedTargetTaskId ?? null)) {
					return null;
				}
				if (!modifierPressedRef.current) {
					draftRef.current = null;
					return null;
				}
				// Keep link mode active while modifier key is held and no target was completed.
				const nextDraft = {
					...current,
					targetTaskId: resolvedTargetTaskId ?? null,
					pointerClientX: event.clientX,
					pointerClientY: event.clientY,
				};
				draftRef.current = nextDraft;
				return nextDraft;
			});
		};

		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				draftRef.current = null;
				setDraft(null);
			}
		};
		const handleModifierRelease = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey) {
				return;
			}
			modifierPressedRef.current = false;
			draftRef.current = null;
			setDraft(null);
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
		window.addEventListener("keydown", handleEscape);
		window.addEventListener("keyup", handleModifierRelease);
		return () => {
			document.body.classList.remove("kb-dependency-link-mode");
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
			window.removeEventListener("keydown", handleEscape);
			window.removeEventListener("keyup", handleModifierRelease);
		};
	}, [completeDependencyLink, isLinking]);

	const handleDependencyPointerDown = useCallback((taskId: string, event: ReactMouseEvent<HTMLElement>) => {
		const nextModifierPressed = event.metaKey || event.ctrlKey;
		modifierPressedRef.current = nextModifierPressed;
		setIsModifierPressed(nextModifierPressed);
		setDraft((current) => {
			if (current?.sourceTaskId === taskId) {
				draftRef.current = null;
				return null;
			}
			const nextDraft = {
				sourceTaskId: taskId,
				targetTaskId: null,
				pointerClientX: event.clientX,
				pointerClientY: event.clientY,
			};
			draftRef.current = nextDraft;
			return nextDraft;
		});
	}, []);

	const handleDependencyPointerEnter = useCallback((taskId: string) => {
		setDraft((current) => {
			if (!current) {
				return current;
			}
			const nextDraft = {
				...current,
				targetTaskId: taskId,
			};
			draftRef.current = nextDraft;
			return nextDraft;
		});
	}, []);

	return {
		draft,
		isModifierPressed,
		onDependencyPointerDown: handleDependencyPointerDown,
		onDependencyPointerEnter: handleDependencyPointerEnter,
	};
}
