export const isMacPlatform =
	typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

export const isTouchDevice =
	typeof navigator !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);

export const MOBILE_BREAKPOINT_PX = 768;

export const modifierKeyLabel = isMacPlatform ? "Cmd" : "Ctrl";
export const optionKeyLabel = isMacPlatform ? "⌥" : "Alt";
export const pasteShortcutLabel = `${modifierKeyLabel}+V`;
