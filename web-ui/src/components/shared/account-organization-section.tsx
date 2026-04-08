// Account & organization switching section for the settings dialog.
// Shows active account, organization dropdown, credit balance, and dashboard link.
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
	fetchClineAccountBalance,
	fetchClineAccountOrganizations,
	switchClineAccount,
} from "@/runtime/runtime-config-query";
import type { RuntimeClineAccountBalanceResponse, RuntimeClineAccountOrganization } from "@/runtime/types";
import { formatBalance } from "@/utils/format-balance";

const BALANCE_REFRESH_INTERVAL_MS = 60_000;

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
	const [balanceError, setBalanceError] = useState<string | null>(null);
	const [orgsError, setOrgsError] = useState<string | null>(null);
	const [hadAccountContext, setHadAccountContext] = useState(false);
	const balanceGenRef = useRef(0);
	const orgsGenRef = useRef(0);

	const refreshBalance = useCallback(async () => {
		const generation = ++balanceGenRef.current;
		setIsLoadingBalance(true);
		try {
			const response = await fetchClineAccountBalance(workspaceId);
			if (generation !== balanceGenRef.current) return;
			setBalanceData(response);
			setBalanceError(response.error ?? null);
			if (!response.error) {
				setHadAccountContext(true);
			}
		} catch (error) {
			if (generation !== balanceGenRef.current) return;
			setBalanceData(null);
			setBalanceError(error instanceof Error ? error.message : "Failed to load account balance.");
		} finally {
			if (generation === balanceGenRef.current) {
				setIsLoadingBalance(false);
			}
		}
	}, [workspaceId]);

	const refreshOrgs = useCallback(async () => {
		const generation = ++orgsGenRef.current;
		setIsLoadingOrgs(true);
		try {
			const response = await fetchClineAccountOrganizations(workspaceId);
			if (generation !== orgsGenRef.current) return;
			setOrganizations(response.organizations);
			setOrgsError(response.error ?? null);
			if (response.organizations.length > 0) {
				setHadAccountContext(true);
			}
		} catch (error) {
			if (generation !== orgsGenRef.current) return;
			setOrgsError(error instanceof Error ? error.message : "Failed to load organizations.");
		} finally {
			if (generation === orgsGenRef.current) {
				setIsLoadingOrgs(false);
			}
		}
	}, [workspaceId]);

	useEffect(() => {
		if (!open) {
			return;
		}
		setBalanceError(null);
		setOrgsError(null);
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

	// Don't render if we've never had data and nothing is loading.
	if (
		!isLoadingOrgs &&
		!isLoadingBalance &&
		organizations.length === 0 &&
		balanceData === null &&
		!hadAccountContext
	) {
		return null;
	}

	const dropdownValue = selectedOrgId ?? "personal";
	const showSelector = balanceData !== null || organizations.length > 0 || hadAccountContext;
	const loadError = balanceError ?? orgsError;

	return (
		<div>
			<h6 className="font-semibold text-text-primary mt-4 mb-2">Account</h6>

			{showSelector ? (
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

			{loadError ? (
				<p role="alert" className="text-status-orange text-[13px] mt-0 mb-2">
					{loadError}
				</p>
			) : null}
			{switchError ? (
				<p role="alert" className="text-status-red text-[13px] mt-0 mb-2">
					{switchError}
				</p>
			) : null}

			<Button
				size="sm"
				variant="ghost"
				icon={<ExternalLink size={14} />}
				onClick={() => window.open("https://app.cline.bot/", "_blank")}
			>
				Dashboard & Buy credits
			</Button>
		</div>
	);
}
