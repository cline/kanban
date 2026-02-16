const isSafariRegex = /^((?!chrome|android).)*safari/i;

export function isSafari(): boolean {
	return isSafariRegex.test(navigator.userAgent);
}
