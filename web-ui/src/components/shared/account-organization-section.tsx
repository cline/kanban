// Account & organization switching section for the settings dialog.
// Shows active account, organization dropdown, credit balance, and dashboard link.
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
	fetchClineAccountBalance,
	fetchClineAccountOrganizations,
	switchClineAccount,
} from "@/runtime/runtime-config-query";
import type { RuntimeClineAccountBalanceResponse, RuntimeClineAccountOrganization } from "@/runtime/types";

const BALANCE_REFRESH_INTERVAL_MS = 60_000;

function formatBalance(balance: number | null): string {
	if (balance === null || balance === undefined) {
		return "—";
	}
	return `$${balance.toFixed(2)}`;
}

export function AccountOrganizationSection({
	workspaceId,
	open,
}: {
	workspaceId: string | null;
	open: boolean;
}): React.ReactElement | null {
	const [organizations, setOrganizations] = useState<RuntimeClineAccountOrganization[]>([]);
	const [balanceData, setBalanceData] = useState<RuntimeClineAccountBalanceResponse | null>(null);
	const [isLoadingOrgs, setIsLoadingOrgs] = useState(false);
	const [isLoadingBalance, setIsLoadingBalance] = useState(false);
	const [isSwitching, setIsSwitching] = useState(false);
	const [switchError, setSwitchError] = useState<string | null>(null);

	const refreshBalance = useCallback(async () => {
		setIsLoadingBalance(true);
		try {
			const response = await fetchClineAccountBalance(workspaceId);
			setBalanceData(response);
		} catch {
			// Silently fail balance fetch.
		} finally {
			setIsLoadingBalance(false);
		}
	}, [workspaceId]);

	const refreshOrgs = useCallback(async () => {
		setIsLoadingOrgs(true);
		try {
			const response = await fetchClineAccountOrganizations(workspaceId);
			setOrganizations(response.organizations);
		} catch {
			// Silently fail org fetch.
		} finally {
			setIsLoadingOrgs(false);
		}
	}, [workspaceId]);

	useEffect(() => {
		if (!open) {
			return;
		}
		void refreshOrgs();
		void refreshBalance();
	}, [open, refreshOrgs, refreshBalance]);

	// Auto-refresh balance every 60s while open.
	useEffect(() => {
		if (!open) {
			return;
		}
		const intervalId = window.setInterval(() => {
			void refreshBalance();
		}, BALANCE_REFRESH_INTERVAL_MS);
		return () => {
			window.clearInterval(intervalId);
		};
	}, [open, refreshBalance]);

	const selectedOrgId = balanceData?.activeOrganizationId ?? null;
	const activeLabel = balanceData?.activeAccountLabel ?? null;

	const handleAccountChange = useCallback(
		async (orgId: string) => {
			setSwitchError(null);
			setIsSwitching(true);
			try {
				const organizationId = orgId === "personal" ? null : orgId;
				const response = await switchClineAccount(workspaceId, organizationId);
				if (!response.ok) {
					setSwitchError(response.error ?? "Failed to switch account.");
				} else {
					await refreshBalance();
					await refreshOrgs();
				}
			} catch (error) {
				setSwitchError(error instanceof Error ? error.message : "Failed to switch account.");
			} finally {
				setIsSwitching(false);
			}
		},
		[workspaceId, refreshBalance, refreshOrgs],
	);

	// Don't render if we have no data and no organizations.
	if (!isLoadingOrgs && !isLoadingBalance && organizations.length === 0 && balanceData === null) {
		return null;
	}

	const dropdownValue = selectedOrgId ?? "personal";

	return (
		<div>
			<h6 className="font-semibold text-text-primary mt-4 mb-2">Account</h6>

			{organizations.length > 0 ? (
				<div className="flex items-center gap-2 mb-2">
					<label htmlFor="account-org-select" className="text-[13px] text-text-secondary shrink-0">
						Active account
					</label>
					<select
						id="account-org-select"
						value={dropdownValue}
						disabled={isSwitching || isLoadingOrgs}
						onChange={(event) => {
							void handleAccountChange(event.target.value);
						}}
						className="h-8 flex-1 min-w-0 rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary focus:border-border-focus focus:outline-none disabled:opacity-40"
					>
						<option value="personal">Personal</option>
						{organizations.map((org) => (
							<option key={org.organizationId} value={org.organizationId}>
								{org.name}
							</option>
						))}
					</select>
					{isSwitching ? <Spinner size={14} /> : null}
				</div>
			) : null}

			<div className="flex items-center gap-3 mb-2">
				<div className="flex items-center gap-2">
					<span className="text-[13px] text-text-secondary">Credits:</span>
					{isLoadingBalance && balanceData === null ? (
						<Spinner size={14} />
					) : (
						<span className="text-[13px] text-text-primary font-medium">
							{formatBalance(balanceData?.balance ?? null)}
						</span>
					)}
				</div>
				{activeLabel ? (
					<span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-accent/10 text-accent">
						{activeLabel}
					</span>
				) : null}
			</div>

			{switchError ? <p className="text-status-red text-[13px] mt-0 mb-2">{switchError}</p> : null}

			<Button
				size="sm"
				variant="ghost"
				icon={<ExternalLink size={14} />}
				onClick={() => window.open("https://app.cline.bot/", "_blank")}
			>
				Dashboard &amp; Buy credits
			</Button>
		</div>
	);
}
