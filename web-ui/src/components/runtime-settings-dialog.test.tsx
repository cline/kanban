import type { ReactNode } from "react";
import { act, createContext, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RuntimeSettingsDialog } from "@/components/runtime-settings-dialog";
import type { RuntimeConfigResponse } from "@/runtime/types";

/*
 * Radix Select depends on pointer-capture APIs that jsdom lacks.
 * Replace it with a minimal native <select> so the theme-picker tests
 * can exercise onValueChange without fighting jsdom limitations.
 */
const RadixSelectCtx = createContext<{
	value: string;
	onValueChange: (v: string) => void;
}>({ value: "", onValueChange: () => {} });

vi.mock("@radix-ui/react-select", () => ({
	Root: ({
		value,
		onValueChange,
		children,
	}: {
		value: string;
		onValueChange: (v: string) => void;
		children: ReactNode;
	}) => {
		const open = false;
		return (
			<RadixSelectCtx.Provider value={{ value, onValueChange }}>
				<div data-radix-select-root="" data-state={open ? "open" : "closed"} data-open-setter={String(open)}>
					{typeof children === "function" ? null : children}
				</div>
			</RadixSelectCtx.Provider>
		);
	},
	Trigger: ({ children, ...props }: { children: ReactNode; "aria-label"?: string }) => {
		return (
			<button type="button" {...props} data-radix-select-trigger="">
				{children}
			</button>
		);
	},
	Value: ({ placeholder }: { placeholder?: string }) => {
		const ctx = useContext(RadixSelectCtx);
		return <span>{ctx.value || placeholder}</span>;
	},
	Icon: ({ children }: { children: ReactNode }) => <span>{children}</span>,
	Portal: ({ children }: { children: ReactNode }) => <>{children}</>,
	Content: ({ children }: { children: ReactNode }) => <div data-radix-select-content="">{children}</div>,
	ScrollUpButton: () => null,
	ScrollDownButton: () => null,
	Viewport: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	Group: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	Label: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	Separator: () => <hr />,
	Item: ({ value, children, ...rest }: { value: string; children: ReactNode }) => {
		const ctx = useContext(RadixSelectCtx);
		return (
			<button
				type="button"
				role="option"
				aria-label={value}
				data-radix-select-item=""
				onClick={() => ctx.onValueChange(value)}
				{...rest}
			>
				{children}
			</button>
		);
	},
	ItemText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
	ItemIndicator: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

const resetLayoutCustomizationsMock = vi.hoisted(() => vi.fn());
const clineSetupSectionOnSavedRef = vi.hoisted(() => ({
	onSaved: null as null | (() => void),
}));

vi.mock("@runtime-agent-catalog", () => ({
	getRuntimeAgentCatalogEntry: vi.fn((agentId: string) => ({
		id: agentId,
		installUrl: null,
		autonomousArgs: [],
	})),
	getRuntimeLaunchSupportedAgentCatalog: vi.fn(() => [
		{ id: "cline", label: "Cline", binary: "cline" },
		{ id: "claude", label: "Claude Code", binary: "claude" },
	]),
}));

vi.mock("@runtime-shortcuts", () => ({
	areRuntimeProjectShortcutsEqual: vi.fn(() => true),
}));

vi.mock("@/components/shared/cline-setup-section", () => ({
	ClineSetupSection: ({ onSaved }: { onSaved?: () => void }) => {
		clineSetupSectionOnSavedRef.onSaved = onSaved ?? null;
		return null;
	},
}));

vi.mock("@/hooks/use-runtime-settings-cline-controller", () => ({
	useRuntimeSettingsClineController: () => ({
		currentProviderSettings: {
			providerId: "anthropic",
			modelId: "claude-3-7-sonnet",
			baseUrl: null,
			reasoningEffort: null,
			apiKeyConfigured: true,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		},
		hasUnsavedChanges: false,
		providerId: "anthropic",
		saveProviderSettings: vi.fn(async () => ({ ok: true })),
	}),
}));

vi.mock("@/hooks/use-runtime-settings-cline-mcp-controller", () => ({
	useRuntimeSettingsClineMcpController: () => ({
		hasUnsavedChanges: false,
		saveMcpSettings: vi.fn(async () => ({ ok: true })),
	}),
}));

vi.mock("@/resize/layout-customizations", () => ({
	useLayoutCustomizations: () => ({
		layoutResetNonce: 0,
		resetLayoutCustomizations: resetLayoutCustomizationsMock,
	}),
}));

vi.mock("@/runtime/use-runtime-config", () => ({
	useRuntimeConfig: (_open: boolean, _workspaceId: string | null, initialConfig?: RuntimeConfigResponse | null) => ({
		config: initialConfig ?? null,
		isLoading: false,
		isSaving: false,
		refresh: vi.fn(),
		save: vi.fn(async () => true),
	}),
}));

vi.mock("@/runtime/runtime-config-query", () => ({
	openFileOnHost: vi.fn(async () => undefined),
}));

vi.mock("@/utils/notification-permission", () => ({
	getBrowserNotificationPermission: () => "unsupported",
	requestBrowserNotificationPermission: vi.fn(async () => "unsupported"),
}));

function findButtonByText(container: ParentNode, text: string): HTMLButtonElement | null {
	return (Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === text) ??
		null) as HTMLButtonElement | null;
}

function findButtonByAriaLabel(container: ParentNode, ariaLabel: string): HTMLButtonElement | null {
	return (Array.from(container.querySelectorAll("button")).find(
		(button) => button.getAttribute("aria-label") === ariaLabel,
	) ?? null) as HTMLButtonElement | null;
}

const savedClineOauthConfig = {
	selectedAgentId: "cline",
	selectedShortcutLabel: null,
	agentAutonomousModeEnabled: true,
	readyForReviewNotificationsEnabled: false,
	effectiveCommand: "cline",
	detectedCommands: [],
	shortcuts: [],
	commitPromptTemplate: "",
	openPrPromptTemplate: "",
	commitPromptTemplateDefault: "",
	openPrPromptTemplateDefault: "",
	globalConfigPath: null,
	projectConfigPath: null,
	agents: [
		{
			id: "cline",
			label: "Cline",
			binary: "cline",
			command: "cline",
			installed: true,
		},
		{
			id: "claude",
			label: "Claude Code",
			binary: "claude",
			command: "claude",
			installed: true,
		},
	],
	clineProviderSettings: {
		providerId: null,
		modelId: "cline-sonnet",
		baseUrl: null,
		reasoningEffort: null,
		apiKeyConfigured: false,
		oauthProvider: "cline",
		oauthAccessTokenConfigured: true,
		oauthRefreshTokenConfigured: true,
		oauthAccountId: "acc-1",
		oauthExpiresAt: 1_800_000_000_000,
	},
} as unknown as RuntimeConfigResponse;

describe("RuntimeSettingsDialog", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		resetLayoutCustomizationsMock.mockReset();
		clineSetupSectionOnSavedRef.onSaved = null;
		window.localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		document.body.innerHTML = "";
		window.localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("does not render support actions inside settings", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedClineOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		expect(findButtonByText(document.body, "Send feedback")).toBeNull();
		expect(findButtonByText(document.body, "Report issue")).toBeNull();
	});

	it("calls the layout reset callback when reset layout is clicked", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedClineOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		const resetButton = findButtonByText(document.body, "Reset layout");
		expect(resetButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			resetButton?.click();
		});

		expect(resetLayoutCustomizationsMock).toHaveBeenCalledTimes(1);
	});

	it("enables save on theme change and reverts preview on cancel", async () => {
		const handleOpenChange = vi.fn();
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedClineOauthConfig}
					onOpenChange={handleOpenChange}
				/>,
			);
		});

		const saveButton = findButtonByText(document.body, "Save");
		const cancelButton = findButtonByText(document.body, "Cancel");
		const themeSelectTrigger = findButtonByAriaLabel(document.body, "Theme");

		expect(saveButton).toBeInstanceOf(HTMLButtonElement);
		expect(cancelButton).toBeInstanceOf(HTMLButtonElement);
		expect(themeSelectTrigger).toBeInstanceOf(HTMLButtonElement);
		expect(saveButton?.disabled).toBe(true);
		expect(themeSelectTrigger?.className).toContain("cursor-pointer");
		expect(themeSelectTrigger?.parentElement?.parentElement?.className).toContain("w-1/2");

		// The mock Radix Select renders items as buttons with role="option".
		// Click the Graphite option to trigger onValueChange.
		const graphiteOption = Array.from(document.querySelectorAll('[role="option"]')).find((el) =>
			el.textContent?.includes("Graphite"),
		) as HTMLElement | undefined;
		expect(graphiteOption).toBeTruthy();
		await act(async () => {
			graphiteOption?.click();
		});

		expect(document.documentElement.getAttribute("data-theme")).toBe("graphite");
		expect(saveButton?.disabled).toBe(false);
		expect(window.localStorage.getItem("kanban.theme")).toBeNull();

		await act(async () => {
			cancelButton?.click();
		});

		expect(handleOpenChange).toHaveBeenCalledWith(false);
		expect(window.localStorage.getItem("kanban.theme")).toBeNull();
		expect(document.documentElement.getAttribute("data-theme")).toBeNull();
	});

	it("persists theme selection only after clicking save", async () => {
		const handleOpenChange = vi.fn();
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedClineOauthConfig}
					onOpenChange={handleOpenChange}
				/>,
			);
		});

		const saveButton = findButtonByText(document.body, "Save");

		expect(saveButton).toBeInstanceOf(HTMLButtonElement);

		// Click the Graphite option to trigger onValueChange.
		const graphiteOption = Array.from(document.querySelectorAll('[role="option"]')).find((el) =>
			el.textContent?.includes("Graphite"),
		) as HTMLElement | undefined;
		expect(graphiteOption).toBeTruthy();
		await act(async () => {
			graphiteOption?.click();
		});

		expect(window.localStorage.getItem("kanban.theme")).toBeNull();

		await act(async () => {
			saveButton?.click();
		});

		expect(handleOpenChange).toHaveBeenCalledWith(false);
		expect(window.localStorage.getItem("kanban.theme")).toBe("graphite");
		expect(document.documentElement.getAttribute("data-theme")).toBe("graphite");
	});

	it("forwards cline setup saves to the dialog onSaved callback", async () => {
		const handleSaved = vi.fn();
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedClineOauthConfig}
					onOpenChange={() => {}}
					onSaved={handleSaved}
				/>,
			);
		});

		expect(clineSetupSectionOnSavedRef.onSaved).toBeTypeOf("function");

		await act(async () => {
			clineSetupSectionOnSavedRef.onSaved?.();
		});

		expect(handleSaved).toHaveBeenCalledTimes(1);
	});
});
