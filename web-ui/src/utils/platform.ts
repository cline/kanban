export const isMacPlatform =
	typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

export const modifierKeyLabel = isMacPlatform ? "Cmd" : "Ctrl";
export const optionKeyLabel = isMacPlatform ? "⌥" : "Alt";
export const pasteShortcutLabel = `${modifierKeyLabel}+V`;
