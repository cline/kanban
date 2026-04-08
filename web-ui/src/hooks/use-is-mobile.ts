import { useMedia } from "@/utils/react-use";

const MOBILE_BREAKPOINT = "(max-width: 768px)";

export function useIsMobile(): boolean {
	return useMedia(MOBILE_BREAKPOINT, false);
}
