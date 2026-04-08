import { AlertTriangle, X } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Link } from "@/components/ui/link";
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
			(session) =>
				(session.state === "awaiting_review" || session.state === "failed") &&
				session.latestHookActivity?.notificationType === "credit_limit",
		);
	}, [taskSessions]);

	useEffect(() => {
		if (hasCreditLimitTask) {
			setIsDismissed(false);
		}
	}, [hasCreditLimitTask]);

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
			<Link href={CLINE_BUY_CREDITS_URL} external>
				Buy more credits
			</Link>
			<Button
				variant="ghost"
				size="sm"
				onClick={handleDismiss}
				className="ml-1 inline-flex cursor-pointer items-center justify-center rounded p-0.5 text-status-orange/70 hover:text-status-orange"
				aria-label="Dismiss"
			>
				<X size={14} />
			</Button>
		</div>
	);
}
