import { AlertTriangle, X } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useMemo, useState } from "react";

import type { RuntimeTaskSessionSummary } from "@/runtime/types";

const CLINE_BUY_CREDITS_URL = "https://app.cline.bot/";

interface CreditLimitBannerProps {
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
}

/**
 * Board-level banner shown when any task on the board has a credit_limit
 * notification. Renders above the columns and persists until dismissed
 * (or until no sessions carry the credit_limit flag any longer).
 */
export function CreditLimitBanner({ taskSessions }: CreditLimitBannerProps): ReactElement | null {
	const [isDismissed, setIsDismissed] = useState(false);

	const hasCreditLimitTask = useMemo(() => {
		return Object.values(taskSessions).some(
			(session) => session.latestHookActivity?.notificationType === "credit_limit",
		);
	}, [taskSessions]);

	const handleDismiss = useCallback(() => {
		setIsDismissed(true);
	}, []);

	if (!hasCreditLimitTask || isDismissed) {
		return null;
	}

	return (
		<div
			className="flex items-center justify-center gap-2 border-b border-status-orange/30 bg-status-orange/10 px-4 py-2 text-[13px] font-medium text-status-orange"
			role="status"
			aria-live="polite"
		>
			<AlertTriangle size={14} className="shrink-0" />
			<span>Out of Cline credits.</span>
			<a
				href={CLINE_BUY_CREDITS_URL}
				target="_blank"
				rel="noreferrer"
				className="text-accent underline-offset-2 hover:text-accent-hover hover:underline"
			>
				Buy more credits
			</a>
			<button
				type="button"
				onClick={handleDismiss}
				className="ml-1 inline-flex cursor-pointer items-center justify-center rounded p-0.5 text-status-orange/70 hover:text-status-orange"
				aria-label="Dismiss"
			>
				<X size={14} />
			</button>
		</div>
	);
}
