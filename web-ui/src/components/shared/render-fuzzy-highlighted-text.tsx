import type { CSSProperties, ReactNode } from "react";

export function renderFuzzyHighlightedText(
	value: string,
	positions: Set<number> | undefined,
	matchedTextStyle: CSSProperties,
): ReactNode {
	if (!positions || positions.size === 0) {
		return value;
	}

	const fragments: ReactNode[] = [];
	let currentText = "";
	let currentIsMatch: boolean | null = null;
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];
		if (character == null) {
			continue;
		}
		const isMatch = positions.has(index);
		if (currentIsMatch === null) {
			currentText = character;
			currentIsMatch = isMatch;
			continue;
		}
		if (isMatch === currentIsMatch) {
			currentText += character;
			continue;
		}
		fragments.push(
			<span
				key={`${index}:${currentIsMatch ? "match" : "plain"}`}
				style={currentIsMatch ? matchedTextStyle : undefined}
			>
				{currentText}
			</span>,
		);
		currentText = character;
		currentIsMatch = isMatch;
	}

	if (currentIsMatch === null) {
		return value;
	}

	fragments.push(
		<span key="end" style={currentIsMatch ? matchedTextStyle : undefined}>
			{currentText}
		</span>,
	);

	return fragments;
}
