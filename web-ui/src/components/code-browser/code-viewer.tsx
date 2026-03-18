import Editor, { type OnMount } from "@monaco-editor/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

const LANGUAGE_MAP: Record<string, string> = {
	ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
	json: "json", jsonc: "json", md: "markdown", mdx: "markdown",
	css: "css", scss: "scss", less: "less", html: "html", htm: "html",
	xml: "xml", yaml: "yaml", yml: "yaml", toml: "ini",
	py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
	kt: "kotlin", c: "c", cpp: "cpp", h: "c", hpp: "cpp", cs: "csharp",
	swift: "swift", sh: "shell", bash: "shell", zsh: "shell",
	sql: "sql", graphql: "graphql", proto: "protobuf",
	dockerfile: "dockerfile", makefile: "makefile",
	lua: "lua", php: "php", dart: "dart", vue: "html", svelte: "html",
	env: "ini", gitignore: "ini",
};

function getMonacoLanguage(filePath: string): string {
	const name = filePath.slice(filePath.lastIndexOf("/") + 1).toLowerCase();
	if (name === "dockerfile" || name.startsWith("dockerfile.")) return "dockerfile";
	if (name === "makefile" || name === "gnumakefile") return "makefile";
	if (name.endsWith(".d.ts")) return "typescript";
	const dotIndex = name.lastIndexOf(".");
	if (dotIndex === -1) return "plaintext";
	const ext = name.slice(dotIndex + 1);
	return LANGUAGE_MAP[ext] ?? "plaintext";
}

export interface EditorSettings {
	fontSize: number;
	wordWrap: boolean;
	minimap: boolean;
	lineNumbers: boolean;
}

interface FileContent {
	path: string;
	content: string | null;
	size: number;
	isBinary: boolean;
	error?: string;
}

export function CodeViewer({
	workspaceId, filePath, onDirtyChange, editorSettings,
}: {
	workspaceId: string | null;
	filePath: string | null;
	onDirtyChange?: (path: string, isDirty: boolean) => void;
	editorSettings?: EditorSettings;
}): React.ReactElement {
	const [fileContent, setFileContent] = useState<FileContent | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const loadingPathRef = useRef<string | null>(null);
	const originalContentRef = useRef<string>("");
	const currentContentRef = useRef<string>("");
	const editorRef = useRef<any>(null);

	const loadFile = useCallback(async (path: string) => {
		if (!workspaceId) return;
		loadingPathRef.current = path;
		setIsLoading(true);
		try {
			const client = getRuntimeTrpcClient(workspaceId);
			const result = await client.workspace.readFile.query({ path });
			if (loadingPathRef.current !== path) return;
			setFileContent(result as FileContent);
			originalContentRef.current = result.content ?? "";
			currentContentRef.current = result.content ?? "";
		} catch (err) {
			if (loadingPathRef.current !== path) return;
			setFileContent({ path, content: null, size: 0, isBinary: false, error: err instanceof Error ? err.message : String(err) });
		} finally {
			if (loadingPathRef.current === path) setIsLoading(false);
		}
	}, [workspaceId]);

	useEffect(() => {
		if (!filePath) { setFileContent(null); loadingPathRef.current = null; return; }
		void loadFile(filePath);
	}, [filePath, loadFile]);

	const saveFile = useCallback(async () => {
		if (!workspaceId || !filePath || isSaving) return;
		const content = currentContentRef.current;
		setIsSaving(true);
		try {
			const client = getRuntimeTrpcClient(workspaceId);
			const result = await client.workspace.writeFile.mutate({ path: filePath, content });
			if (result.ok) { originalContentRef.current = content; onDirtyChange?.(filePath, false); }
		} finally { setIsSaving(false); }
	}, [workspaceId, filePath, isSaving, onDirtyChange]);

	const handleEditorMount: OnMount = useCallback((editor, monaco) => {
		editorRef.current = editor;
		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { void saveFile(); });
	}, [saveFile]);

	const handleEditorChange = useCallback((value: string | undefined) => {
		const newContent = value ?? "";
		currentContentRef.current = newContent;
		if (filePath) onDirtyChange?.(filePath, newContent !== originalContentRef.current);
	}, [filePath, onDirtyChange]);

	if (!filePath) return <div className="flex flex-1 items-center justify-center min-h-0 text-text-tertiary text-sm">Select a file to view its contents</div>;
	if (isLoading) return <div className="flex flex-1 items-center justify-center min-h-0"><Spinner size={24} /></div>;
	if (!fileContent) return <div />;
	if (fileContent.error) return <div className="flex flex-1 items-center justify-center min-h-0 text-text-tertiary text-sm">Cannot read file: {fileContent.error}</div>;
	if (fileContent.isBinary) return <div className="flex flex-1 items-center justify-center min-h-0 text-text-tertiary text-sm">Binary file: {fileContent.path}</div>;

	const content = fileContent.content ?? "";
	const language = getMonacoLanguage(fileContent.path);

	return (
		<div className="flex flex-col flex-1 min-h-0 min-w-0 relative">
			{isSaving && <div className="absolute top-1 right-3 z-10 text-[11px] text-text-tertiary">Saving…</div>}
			<div className="flex-1 min-h-0 min-w-0">
				<Editor
					key={filePath}
					defaultValue={content}
					language={language}
					theme="vs-dark"
					onMount={handleEditorMount}
					onChange={handleEditorChange}
					options={{
						minimap: { enabled: editorSettings?.minimap ?? true },
						scrollBeyondLastLine: false,
						fontSize: editorSettings?.fontSize ?? 10,
						lineNumbers: (editorSettings?.lineNumbers ?? true) ? "on" : "off",
						renderLineHighlight: "line",
						folding: true,
						wordWrap: (editorSettings?.wordWrap ?? false) ? "on" : "off",
						automaticLayout: true,
						contextmenu: true,
						overviewRulerLanes: 0,
						hideCursorInOverviewRuler: true,
						scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
						padding: { top: 8 },
					}}
					loading={<Spinner size={24} />}
				/>
			</div>
		</div>
	);
}