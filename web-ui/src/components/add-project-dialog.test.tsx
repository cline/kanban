import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AddProjectDialog } from "@/components/add-project-dialog";

const { addProject } = vi.hoisted(() => ({
	addProject: vi.fn(async () => ({ ok: false, requiresGitInitialization: true })),
}));
vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		projects: {
			listDirectoryContents: { query: async () => ({ ok: true, rootPath: "/workspace" }) },
			add: { mutate: addProject },
		},
	}),
}));
vi.mock("@/components/directory-autocomplete", () => ({
	DirectoryAutocomplete: ({ onChange }: { onChange: (value: string) => void }) => (
		<button type="button" onClick={() => onChange("/other-path")}>
			Change path
		</button>
	),
}));
vi.mock("@/components/ui/dialog", () => ({
	Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DialogHeader: () => <div />,
	DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

beforeEach(() => {
	(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	addProject.mockClear();
});
afterEach(() => {
	delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

it("preserves git initialization across tabs but clears it for a changed path or reopened dialog", async () => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const render = (open: boolean, initialGitInitPath: string | null = null) =>
		root.render(
			<AddProjectDialog
				open={open}
				onOpenChange={() => {}}
				onProjectAdded={() => {}}
				currentProjectId={null}
				initialGitInitPath={initialGitInitPath}
			/>,
		);
	const button = (text: string) => {
		const result = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
		if (!result) throw new Error(`Missing button: ${text}`);
		return result;
	};
	try {
		await act(async () => render(true));
		await act(async () => button("Change path").click());
		await act(async () => button("Add Project").click());
		expect(addProject).toHaveBeenLastCalledWith({ path: "/workspace/other-path", initializeGit: false });
		expect(container.textContent).toContain("Initialize Git Repository");
		await act(async () => button("Git Clone").click());
		expect(container.textContent).not.toContain("Initialize Git Repository");
		await act(async () => button("Server Path").click());
		expect(container.textContent).toContain("Initialize Git Repository");
		expect(addProject).toHaveBeenCalledTimes(1);
		await act(async () => button("Change path").click());
		expect(container.textContent).not.toContain("Initialize Git Repository");
		await act(async () => render(false));
		await act(async () => render(true, "/workspace/native-picker-path"));
		expect(container.textContent).toContain("Initialize Git Repository");
		await act(async () => button("Git Clone").click());
		await act(async () => button("Server Path").click());
		expect(container.textContent).toContain("Initialize Git Repository");
		await act(async () => render(false));
		await act(async () => render(true));
		expect(container.textContent).not.toContain("Initialize Git Repository");
	} finally {
		await act(async () => root.unmount());
		container.remove();
	}
});
