import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { getRuntimeAgentCatalogEntry } from "@runtime-agent-catalog";
import { Check } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import { ClineSetupSection } from "@/components/shared/cline-setup-section";
import { cn } from "@/components/ui/cn";
import { isClineProviderAuthenticated } from "@/runtime/native-agent";
import { useRuntimeSettingsClineController } from "@/hooks/use-runtime-settings-cline-controller";
import type {
	RuntimeAgentDefinition,
	RuntimeAgentId,
	RuntimeClineProviderSettings,
	RuntimeConfigResponse,
} from "@/runtime/types";

interface OnboardingSlide {
	title: string;
	description: string;
	assetVideoUrl?: string;
	assetImageUrl?: string;
	assetStemPath?: string;
	assetAlt?: string;
	assetWidthPx?: number;
	assetHeightPx?: number;
	assetFrameWidthPx?: number;
	assetFrameHeightPx?: number;
	assetObjectFit?: "contain" | "cover";
}

interface AgentSelectionResult {
	ok: boolean;
	message?: string;
}

interface OnboardingDoneResult {
	ok: boolean;
	message?: string;
}

export const TASK_START_ONBOARDING_SLIDES: OnboardingSlide[] = [
	{
		title: "Auto commit and link",
		description:
			"Create dependency chains of linked tasks that start one another automatically. Agents can auto commit their work as they finish, so you can orchestrate tasks in order and watch the board burn them down automatically.",
		assetVideoUrl: "https://github.com/user-attachments/assets/c9c7d9b2-8511-4676-8c9e-8014b4c4b091",
		assetAlt: "Linking task cards in Cline Kanban",
		assetWidthPx: 976,
		assetHeightPx: 720,
	},
	{
		title: "Review changes with comments",
		description:
			"Your workflow will feel like writing tickets, reviewing code, and shipping. Watch the agent work next to real-time diffs, then click lines to leave comments like you're reviewing a PR.",
		assetVideoUrl: "https://github.com/user-attachments/assets/17992035-c1ca-449a-a48b-bb094007f0a1",
		assetAlt: "Leaving comments on code diffs in Cline Kanban",
		assetWidthPx: 1076,
		assetHeightPx: 720,
		assetFrameWidthPx: 976,
		assetFrameHeightPx: 720,
		assetObjectFit: "cover",
	},
	{
		title: "Choose your agent",
		description:
			"Set up an agent to start tasks. Cline is the default for new users, and you can also use Claude Code or OpenAI Codex.",
	},
];

const ONBOARDING_AGENT_IDS: readonly RuntimeAgentId[] = ["cline", "claude", "codex"];
const FALLBACK_ONBOARDING_SLIDE: OnboardingSlide = {
	title: "",
	description: "",
};

function AgentStatusBadge({ label, statusClassName }: { label: string; statusClassName: string }): ReactElement {
	return (
		<span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium", statusClassName)}>
			{label}
		</span>
	);
}

function OnboardingMedia({
	assetStemPath,
	assetVideoUrl,
	assetImageUrl,
	assetWidthPx,
	assetHeightPx,
	assetFrameWidthPx,
	assetFrameHeightPx,
	assetObjectFit,
	alt,
}: {
	assetStemPath?: string;
	assetVideoUrl?: string;
	assetImageUrl?: string;
	assetWidthPx?: number;
	assetHeightPx?: number;
	assetFrameWidthPx?: number;
	assetFrameHeightPx?: number;
	assetObjectFit?: "contain" | "cover";
	alt: string;
}): ReactElement {
	const [assetMode, setAssetMode] = useState<"video" | "image" | "missing">("video");
	const videoPath = assetVideoUrl ?? (assetStemPath ? `${assetStemPath}.mp4` : null);
	const imagePath = assetImageUrl ?? (assetStemPath ? `${assetStemPath}.gif` : null);
	const mediaWidth = assetWidthPx;
	const mediaHeight = assetHeightPx;
	const frameWidth = assetFrameWidthPx ?? assetWidthPx;
	const frameHeight = assetFrameHeightPx ?? assetHeightPx;
	const objectFitClassName = assetObjectFit === "cover" ? "object-cover" : "object-contain";
	const hasFrameSize = typeof frameWidth === "number" && typeof frameHeight === "number";
	const mediaContainerStyle =
		hasFrameSize
			? {
					aspectRatio: `${frameWidth} / ${frameHeight}`,
					maxWidth: `${frameWidth}px`,
					width: "100%",
				}
			: typeof frameWidth === "number"
				? {
						maxWidth: `${frameWidth}px`,
						width: "100%",
					}
				: {
						width: "100%",
					};
	const missingStateStyle =
		typeof frameWidth === "number" && typeof frameHeight === "number"
			? {
					maxHeight: `${frameHeight}px`,
					maxWidth: `${frameWidth}px`,
					width: "100%",
				}
			: typeof frameHeight === "number"
				? {
						maxHeight: `${frameHeight}px`,
						maxWidth: "100%",
						width: "auto",
					}
			: {
					width: "100%",
				};

	useEffect(() => {
		setAssetMode("video");
	}, [imagePath, videoPath]);

	if (assetMode === "missing") {
		return (
			<div className="flex w-full justify-center">
				<div
					className="flex min-h-[180px] w-full items-center justify-center rounded-md border border-dashed border-border-bright bg-surface-1 p-4 text-center"
					style={missingStateStyle}
				>
					<p className="m-0 text-xs text-text-secondary">
						Add onboarding media by setting a valid slide video or gif source.
					</p>
				</div>
			</div>
		);
	}

	if (assetMode === "video") {
		if (!videoPath) {
			if (!imagePath) {
				return (
					<div className="flex w-full justify-center">
						<div
							className="flex min-h-[180px] w-full items-center justify-center rounded-md border border-dashed border-border-bright bg-surface-1 p-4 text-center"
							style={mediaContainerStyle}
						>
							<p className="m-0 text-xs text-text-secondary">
								Add onboarding media by setting a valid slide video or gif source.
							</p>
						</div>
					</div>
				);
			}
			return (
				<div className="flex w-full justify-center">
					<div className="relative w-full overflow-hidden rounded-md bg-surface-1" style={mediaContainerStyle}>
						<img
							src={imagePath}
							alt={alt}
							onError={() => setAssetMode("missing")}
							width={mediaWidth}
							height={mediaHeight}
							className={cn("h-full w-full", objectFitClassName)}
						/>
					</div>
				</div>
			);
		}
		return (
			<div className="flex w-full justify-center">
				<div className="relative w-full overflow-hidden rounded-md bg-surface-1" style={mediaContainerStyle}>
					<video
						src={videoPath}
						autoPlay
						loop
						muted
						playsInline
						preload="auto"
						width={mediaWidth}
						height={mediaHeight}
						onError={() => setAssetMode(imagePath ? "image" : "missing")}
						className={cn("h-full w-full", objectFitClassName)}
					/>
				</div>
			</div>
		);
	}

	if (!imagePath) {
		return (
			<div className="flex w-full justify-center">
				<div
					className="flex min-h-[180px] w-full items-center justify-center rounded-md border border-dashed border-border-bright bg-surface-1 p-4 text-center"
					style={mediaContainerStyle}
				>
					<p className="m-0 text-xs text-text-secondary">
						Add onboarding media by setting a valid slide video or gif source.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex w-full justify-center">
			<div className="relative w-full overflow-hidden rounded-md bg-surface-1" style={mediaContainerStyle}>
				<img
					src={imagePath}
					alt={alt}
					onError={() => setAssetMode("missing")}
					width={mediaWidth}
					height={mediaHeight}
					className={cn("h-full w-full", objectFitClassName)}
				/>
			</div>
		</div>
	);
}

function resolveInstallInstructions(agentId: RuntimeAgentId): string {
	if (agentId === "cline") {
		return "Install: npm install -g cline";
	}
	if (agentId === "claude") {
		return "Anthropics coding agent with access to Claude models.";
	}
	if (agentId === "codex") {
		return "OpenAI coding agent with access to the latest GPT models.";
	}
	return "Install from the official docs.";
}

function getInstallLinkLabel(agentId: RuntimeAgentId): string {
	if (agentId === "claude") {
		return "Learn more";
	}
	if (agentId === "codex") {
		return "Learn more";
	}
	return "Install guide";
}

export function TaskStartAgentOnboardingCarousel({
	open,
	workspaceId,
	runtimeConfig,
	selectedAgentId,
	agents,
	clineProviderSettings,
	activeSlideIndex,
	onSelectAgent,
	onClineSetupSaved,
	onDoneActionChange,
}: {
	open: boolean;
	workspaceId: string | null;
	runtimeConfig: RuntimeConfigResponse | null;
	selectedAgentId: RuntimeAgentId | null;
	agents: RuntimeAgentDefinition[];
	clineProviderSettings: RuntimeClineProviderSettings | null;
	activeSlideIndex: number;
	onSelectAgent?: (agentId: RuntimeAgentId) => Promise<AgentSelectionResult>;
	onClineSetupSaved?: () => void;
	onDoneActionChange?: (action: (() => Promise<OnboardingDoneResult>) | null) => void;
}): ReactElement {
	const [activeAgentId, setActiveAgentId] = useState<RuntimeAgentId | null>(selectedAgentId);
	const [selectionError, setSelectionError] = useState<string | null>(null);
	const [clineSetupError, setClineSetupError] = useState<string | null>(null);
	const selectionSavePromiseRef = useRef<Promise<AgentSelectionResult> | null>(null);
	const preloadedVideoUrlsRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		setActiveAgentId(selectedAgentId);
	}, [selectedAgentId]);

	useEffect(() => {
		if (!open || typeof document === "undefined") {
			return;
		}

		for (const slide of TASK_START_ONBOARDING_SLIDES) {
			if (!slide.assetVideoUrl || preloadedVideoUrlsRef.current.has(slide.assetVideoUrl)) {
				continue;
			}

			const preloadVideo = document.createElement("video");
			preloadVideo.preload = "auto";
			preloadVideo.muted = true;
			preloadVideo.playsInline = true;
			preloadVideo.src = slide.assetVideoUrl;
			preloadVideo.load();
			preloadedVideoUrlsRef.current.add(slide.assetVideoUrl);
		}
	}, [open]);

	const currentSlide =
		TASK_START_ONBOARDING_SLIDES[activeSlideIndex] ??
		TASK_START_ONBOARDING_SLIDES[0] ??
		FALLBACK_ONBOARDING_SLIDE;
	const clineAuthenticated = isClineProviderAuthenticated(clineProviderSettings);
	const clineSettings = useRuntimeSettingsClineController({
		open,
		workspaceId,
		selectedAgentId: activeAgentId ?? selectedAgentId ?? "cline",
		config: runtimeConfig,
	});

	const onboardingAgents = useMemo(
		() =>
			ONBOARDING_AGENT_IDS.map((agentId) => {
				const configuredAgent = agents.find((agent) => agent.id === agentId) ?? null;
				const catalogEntry = getRuntimeAgentCatalogEntry(agentId);
				return {
					id: agentId,
					label: catalogEntry?.label ?? configuredAgent?.label ?? agentId,
					installUrl: catalogEntry?.installUrl ?? null,
					installed: configuredAgent?.installed ?? false,
				};
			}),
		[agents],
	);

	const handleAgentSelect = (agentId: RuntimeAgentId) => {
		if (activeAgentId === agentId) {
			return;
		}
		setActiveAgentId(agentId);
		setSelectionError(null);
		if (!onSelectAgent) {
			return;
		}
		const savePromise = onSelectAgent(agentId);
		selectionSavePromiseRef.current = savePromise;
		void savePromise
			.then((result) => {
				if (selectionSavePromiseRef.current !== savePromise) {
					return;
				}
				if (!result.ok) {
					setSelectionError(result.message ?? "Could not switch agents. Try again.");
					setActiveAgentId(selectedAgentId);
				}
			})
			.catch((error: unknown) => {
				if (selectionSavePromiseRef.current !== savePromise) {
					return;
				}
				const message = error instanceof Error ? error.message : String(error);
				setSelectionError(message || "Could not switch agents. Try again.");
				setActiveAgentId(selectedAgentId);
			})
			.finally(() => {
				if (selectionSavePromiseRef.current === savePromise) {
					selectionSavePromiseRef.current = null;
				}
			});
	};

	const handleDoneAction = useCallback(async (): Promise<OnboardingDoneResult> => {
		if (selectionSavePromiseRef.current) {
			const selectionResult = await selectionSavePromiseRef.current.catch((error: unknown) => ({
				ok: false,
				message: error instanceof Error ? error.message : String(error),
			}));
			if (!selectionResult.ok) {
				const message = selectionResult.message ?? "Could not switch agents. Try again.";
				setSelectionError(message);
				return { ok: false, message };
			}
		}
		if (activeAgentId !== "cline") {
			return { ok: true };
		}
		if (!clineSettings.hasUnsavedChanges) {
			return { ok: true };
		}
		setClineSetupError(null);
		const saveResult = await clineSettings.saveProviderSettings();
		if (!saveResult.ok) {
			const message = saveResult.message ?? "Could not save Cline provider settings.";
			setClineSetupError(message);
			return { ok: false, message };
		}
		onClineSetupSaved?.();
		return { ok: true };
	}, [activeAgentId, clineSettings, onClineSetupSaved]);

	useEffect(() => {
		onDoneActionChange?.(handleDoneAction);
		return () => {
			onDoneActionChange?.(null);
		};
	}, [handleDoneAction, onDoneActionChange]);

	return (
		<div className="space-y-3">
			<div>
				<h4 className="m-0 text-[15px] font-semibold text-text-primary">{currentSlide?.title}</h4>
				<p className="mt-1 mb-0 text-[13px] text-text-secondary">{currentSlide?.description}</p>
			</div>

			{activeSlideIndex < 2 && currentSlide.assetAlt ? (
				<OnboardingMedia
					assetStemPath={currentSlide.assetStemPath}
					assetVideoUrl={currentSlide.assetVideoUrl}
					assetImageUrl={currentSlide.assetImageUrl}
					assetWidthPx={currentSlide.assetWidthPx}
					assetHeightPx={currentSlide.assetHeightPx}
					assetFrameWidthPx={currentSlide.assetFrameWidthPx}
					assetFrameHeightPx={currentSlide.assetFrameHeightPx}
					assetObjectFit={currentSlide.assetObjectFit}
					alt={currentSlide.assetAlt}
				/>
			) : null}

			{activeSlideIndex === 2 ? (
				<div className="space-y-2">
					{onboardingAgents.map((agent) => (
						<div
							key={agent.id}
							className={cn(
								"rounded-md border bg-surface-1 p-3",
								activeAgentId === agent.id ? "border-accent" : "border-border",
							)}
						>
							<div
								role="button"
								tabIndex={0}
								onClick={() => handleAgentSelect(agent.id)}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										handleAgentSelect(agent.id);
									}
								}}
								className="flex cursor-pointer items-center justify-between gap-3"
							>
								<span className="flex items-center gap-2">
									<RadixCheckbox.Root
										checked={activeAgentId === agent.id}
										onCheckedChange={(checked) => {
											if (checked === true) {
												handleAgentSelect(agent.id);
											}
										}}
										className="flex h-4 w-4 items-center justify-center rounded border border-border-bright bg-surface-2 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
									>
										<RadixCheckbox.Indicator>
											<Check size={12} className="text-white" />
										</RadixCheckbox.Indicator>
									</RadixCheckbox.Root>
									<span className="text-[13px] text-text-primary">{agent.label}</span>
								</span>
								{agent.id === "cline" ? (
									clineAuthenticated ? (
										<AgentStatusBadge
											label="Authenticated"
											statusClassName="bg-status-green/10 text-status-green"
										/>
									) : null
								) : agent.installed ? (
									<AgentStatusBadge
										label="Detected"
										statusClassName="bg-status-green/10 text-status-green"
									/>
								) : (
									<AgentStatusBadge
										label="Not installed"
										statusClassName="bg-surface-3 text-text-secondary"
									/>
								)}
							</div>
							<p className="mt-2 mb-0 text-[12px] text-text-secondary">
								{resolveInstallInstructions(agent.id)}
								{agent.id !== "cline" && agent.installUrl ? (
									<>
										{" "}
										<a
											href={agent.installUrl}
											target="_blank"
											rel="noreferrer"
											className="text-accent hover:underline"
										>
											{getInstallLinkLabel(agent.id)}
										</a>
									</>
								) : null}
							</p>
							{agent.id === "cline" ? (
								<div className="mt-2">
									<ClineSetupSection
										controller={clineSettings}
										controlsDisabled={!workspaceId}
										showHeading={false}
										onError={setClineSetupError}
										onSaved={onClineSetupSaved}
									/>
									{clineSetupError ? (
										<div className="mt-2 rounded-md border border-status-red/30 bg-status-red/5 p-2 text-[12px] text-text-primary">
											{clineSetupError}
										</div>
									) : null}
								</div>
							) : null}
						</div>
					))}
					{selectionError ? (
						<div className="rounded-md border border-status-red/30 bg-status-red/5 p-2 text-[12px] text-text-primary">
							{selectionError}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
