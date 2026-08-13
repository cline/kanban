import type { ReactElement, ReactNode } from "react";

import { useI18n } from "@/i18n/i18n-context";

const FILE_REFERENCE_PLACEHOLDER = "{fileReference}";
const IMAGE_SHORTCUT_PLACEHOLDER = "{imageShortcut}";
const PLACEHOLDER_PATTERN = /(\{fileReference\}|\{imageShortcut\})/g;

function code(value: ReactNode, key: string): ReactElement {
	return (
		<code key={key} className="rounded bg-surface-3 px-1 py-px font-mono text-[11px]">
			{value}
		</code>
	);
}

export function TaskFileImageHint({ pasteShortcut }: { pasteShortcut: string }): ReactElement {
	const { t } = useI18n();
	const template = t("task.fileImageHint");
	const parts = template.split(PLACEHOLDER_PATTERN).filter(Boolean);

	return (
		<>
			{parts.map((part, index) => {
				if (part === FILE_REFERENCE_PLACEHOLDER) {
					return code("@file", `file-reference-${index}`);
				}
				if (part === IMAGE_SHORTCUT_PLACEHOLDER) {
					return code(pasteShortcut, `image-shortcut-${index}`);
				}
				return part;
			})}
		</>
	);
}
