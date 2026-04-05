import Editor, { loader, type OnMount } from "@monaco-editor/react";
import type * as MonacoEditor from "monaco-editor";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { useCallback, useEffect, useRef, useState } from "react";

import { Spinner } from "@/components/ui/spinner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

declare global {
	interface Window {
		MonacoEnvironment?: {
			getWorker: (_workerId: string, label: string) => Worker;
		};
	}
}

const LANGUAGE_MAP: Record<string, string> = {
	bash: "shell",
	c: "c",
	cjs: "javascript",
	cpp: "cpp",
	cs: "csharp",
	css: "css",
	dockerfile: "dockerfile",
	go: "go",
	graphql: "graphql",
	h: "c",
	hpp: "cpp",
	htm: "html",
	html: "html",
	java: "java",
	js: "javascript",
	json: "json",
	jsonc: "json",
	jsx: "javascript",
	kt: "kotlin",
	lua: "lua",
	md: "markdown",
	mdx: "markdown",
	mjs: "javascript",
	php: "php",
	proto: "protobuf",
	py: "python",
	rb: "ruby",
	rs: "rust",
	scss: "scss",
	sh: "shell",
	sql: "sql",
	svelte: "html",
	swift: "swift",
	toml: "ini",
	ts: "typescript",
	tsx: "typescript",
	txt: "plaintext",
	xml: "xml",
	yaml: "yaml",
	yml: "yaml",
	zsh: "shell",
};

const THEME_NAME = "kanban-dark";
let isThemeRegistered = false;
let isLoaderConfigured = false;

function configureMonacoLoader(): void {
	if (isLoaderConfigured || typeof window === "undefined") {
		return;
	}

	window.MonacoEnvironment = {
		getWorker(_workerId, label) {
			switch (label) {
				case "css":
				case "scss":
				case "less":
					return new CssWorker();
				case "html":
				case "handlebars":
				case "razor":
					return new HtmlWorker();
				case "json":
					return new JsonWorker();
				case "typescript":
				case "javascript":
					return new TsWorker();
				default:
					return new EditorWorker();
			}
		},
	};

	loader.config({ monaco });
	isLoaderConfigured = true;
}

function ensureTheme(monacoInstance: typeof monaco): void {
	if (isThemeRegistered) {
		return;
	}

	monacoInstance.editor.defineTheme(THEME_NAME, {
		base: "vs-dark",
		inherit: true,
		rules: [
			{ token: "comment", foreground: "6E7681" },
			{ token: "keyword", foreground: "4C9AFF" },
			{ token: "string", foreground: "3FB950" },
			{ token: "number", foreground: "D29922" },
			{ token: "constant", foreground: "D29922" },
			{ token: "entity.name.function", foreground: "4C9AFF" },
			{ token: "support.function", foreground: "4C9AFF" },
			{ token: "entity.name.type", foreground: "4C9AFF" },
			{ token: "type", foreground: "4C9AFF" },
			{ token: "operator", foreground: "8B949E" },
			{ token: "delimiter", foreground: "8B949E" },
			{ token: "variable", foreground: "E6EDF3" },
			{ token: "identifier", foreground: "E6EDF3" },
			{ token: "attribute.name", foreground: "4C9AFF" },
		],
		colors: {
			"editor.background": "#24292E",
			"editor.foreground": "#E6EDF3",
			"editorLineNumber.foreground": "#6E7681",
			"editorLineNumber.activeForeground": "#8B949E",
			"editor.selectionBackground": "#264F78",
			"editor.lineHighlightBackground": "#2D3339",
			"editorCursor.foreground": "#E6EDF3",
			"editorIndentGuide.background": "#30363D",
			"editorIndentGuide.activeBackground": "#444C56",
			"editorWidget.background": "#24292E",
			"editorWidget.border": "#30363D",
			"editorSuggestWidget.background": "#24292E",
			"editorSuggestWidget.border": "#30363D",
			"editorSuggestWidget.selectedBackground": "#2D3339",
			"editorOverviewRuler.border": "#00000000",
			"editorBracketMatch.background": "#2D333940",
			"editorBracketMatch.border": "#444C56",
			"editorGutter.background": "#24292E",
			"minimap.background": "#1F2428",
			"scrollbarSlider.background": "#3E464E80",
			"scrollbarSlider.hoverBackground": "#3E464EA0",
			"scrollbarSlider.activeBackground": "#3E464EC0",
		},
	});

	isThemeRegistered = true;
}

function getMonacoLanguage(filePath: string): string {
	const normalizedName = filePath.slice(filePath.lastIndexOf("/") + 1).toLowerCase();
	if (normalizedName === "dockerfile" || normalizedName.startsWith("dockerfile.")) {
		return "dockerfile";
	}
	if (normalizedName === "makefile" || normalizedName === "gnumakefile") {
		return "makefile";
	}
	if (normalizedName.endsWith(".d.ts")) {
		return "typescript";
	}

	const lastDotIndex = normalizedName.lastIndexOf(".");
	if (lastDotIndex === -1) {
		return "plaintext";
	}

	const extension = normalizedName.slice(lastDotIndex + 1);
	return LANGUAGE_MAP[extension] ?? "plaintext";
}

function createGitGutterDecorations(
	changes: Awaited<
		ReturnType<ReturnType<typeof getRuntimeTrpcClient>["workspace"]["getFileGitLineStatus"]["query"]>
	>["changes"],
): MonacoEditor.editor.IModelDeltaDecoration[] {
	return changes.map((change) => {
		const className =
			change.type === "added"
				? "kb-monaco-gutter-added"
				: change.type === "deleted"
					? "kb-monaco-gutter-deleted"
					: "kb-monaco-gutter-modified";
		const endLine = change.lineCount === 0 ? change.startLine : change.startLine + change.lineCount - 1;

		return {
			range: new monaco.Range(change.startLine, 1, endLine, 1),
			options: {
				isWholeLine: true,
				linesDecorationsClassName: className,
			},
		};
	});
}

function ensureGutterStyles(): void {
	if (typeof document === "undefined" || document.getElementById("kb-monaco-gutter-styles")) {
		return;
	}

	const styleElement = document.createElement("style");
	styleElement.id = "kb-monaco-gutter-styles";
	styleElement.textContent = `
		.kb-monaco-gutter-added { border-left: 3px solid #3FB950 !important; margin-left: 2px; }
		.kb-monaco-gutter-modified { border-left: 3px solid #4C9AFF !important; margin-left: 2px; }
		.kb-monaco-gutter-deleted { border-left: 3px solid #F85149 !important; margin-left: 2px; }
	`;
	document.head.appendChild(styleElement);
}

function createEditorOptions(
	settings: EditorSettings | undefined,
	isSaving: boolean,
): MonacoEditor.editor.IStandaloneEditorConstructionOptions {
	return {
		automaticLayout: true,
		fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
		fontSize: settings?.fontSize ?? 12,
		lineNumbersMinChars: 3,
		minimap: { enabled: true },
		padding: { top: 12, bottom: 12 },
		readOnly: isSaving,
		renderWhitespace: "selection",
		scrollBeyondLastLine: false,
		smoothScrolling: true,
		tabSize: 2,
		wordWrap: settings?.wordWrap ? "on" : "off",
	};
}

export interface EditorSettings {
	fontSize: number;
	wordWrap: boolean;
}

interface FileContent {
	path: string;
	content: string | null;
	size: number;
	isBinary: boolean;
	error?: string;
}

export function CodeViewer({
	workspaceId,
	filePath,
	onDirtyChange,
	editorSettings,
}: {
	workspaceId: string | null;
	filePath: string | null;
	onDirtyChange?: (path: string, isDirty: boolean) => void;
	editorSettings?: EditorSettings;
}): React.ReactElement {
	const [fileContent, setFileContent] = useState<FileContent | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const editorRef = useRef<MonacoEditor.editor.IStandaloneCodeEditor | null>(null);
	const decorationsRef = useRef<MonacoEditor.editor.IEditorDecorationsCollection | null>(null);
	const loadingPathRef = useRef<string | null>(null);
	const originalContentRef = useRef("");
	const currentContentRef = useRef("");

	configureMonacoLoader();

	const loadFile = useCallback(
		async (path: string) => {
			if (!workspaceId) {
				return;
			}

			loadingPathRef.current = path;
			setIsLoading(true);
			try {
				const client = getRuntimeTrpcClient(workspaceId);
				const response = await client.workspace.readFile.query({ path });
				if (loadingPathRef.current !== path) {
					return;
				}
				setFileContent(response);
				originalContentRef.current = response.content ?? "";
				currentContentRef.current = response.content ?? "";
			} catch (error) {
				if (loadingPathRef.current !== path) {
					return;
				}
				setFileContent({
					path,
					content: null,
					size: 0,
					isBinary: false,
					error: error instanceof Error ? error.message : String(error),
				});
			} finally {
				if (loadingPathRef.current === path) {
					setIsLoading(false);
				}
			}
		},
		[workspaceId],
	);

	const loadGitDecorations = useCallback(
		async (path: string) => {
			if (!workspaceId || !editorRef.current) {
				return;
			}
			try {
				ensureGutterStyles();
				const client = getRuntimeTrpcClient(workspaceId);
				const response = await client.workspace.getFileGitLineStatus.query({ path });
				decorationsRef.current?.clear();
				if (response.changes.length === 0) {
					return;
				}
				decorationsRef.current = editorRef.current.createDecorationsCollection(
					createGitGutterDecorations(response.changes),
				);
			} catch {
				decorationsRef.current?.clear();
			}
		},
		[workspaceId],
	);

	useEffect(() => {
		if (!filePath) {
			setFileContent(null);
			loadingPathRef.current = null;
			decorationsRef.current?.clear();
			return;
		}
		void loadFile(filePath);
		void loadGitDecorations(filePath);
	}, [filePath, loadFile, loadGitDecorations]);

	const saveFile = useCallback(async () => {
		if (!workspaceId || !filePath || isSaving) {
			return;
		}
		setIsSaving(true);
		try {
			const client = getRuntimeTrpcClient(workspaceId);
			const response = await client.workspace.writeFile.mutate({
				path: filePath,
				content: currentContentRef.current,
			});
			if (response.ok) {
				originalContentRef.current = currentContentRef.current;
				onDirtyChange?.(filePath, false);
				void loadGitDecorations(filePath);
				return;
			}
			setFileContent((current) =>
				current
					? {
							...current,
							error: response.error ?? "Could not save file.",
						}
					: current,
			);
		} finally {
			setIsSaving(false);
		}
	}, [filePath, isSaving, loadGitDecorations, onDirtyChange, workspaceId]);

	const handleEditorMount: OnMount = useCallback(
		(editorInstance, monacoInstance) => {
			editorRef.current = editorInstance;
			ensureTheme(monacoInstance);
			monacoInstance.editor.setTheme(THEME_NAME);
			monacoInstance.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
				noSemanticValidation: true,
				noSyntaxValidation: true,
				noSuggestionDiagnostics: true,
			});
			monacoInstance.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
				noSemanticValidation: true,
				noSyntaxValidation: true,
				noSuggestionDiagnostics: true,
			});

			editorInstance.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
				void saveFile();
			});

			if (filePath) {
				void loadGitDecorations(filePath);
			}
		},
		[filePath, loadGitDecorations, saveFile],
	);

	const handleEditorChange = useCallback(
		(value: string | undefined) => {
			const nextContent = value ?? "";
			currentContentRef.current = nextContent;
			if (!filePath) {
				return;
			}
			onDirtyChange?.(filePath, nextContent !== originalContentRef.current);
		},
		[filePath, onDirtyChange],
	);

	if (!filePath) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center text-sm text-text-tertiary">
				Select a file to view its contents
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center">
				<Spinner size={24} />
			</div>
		);
	}

	if (fileContent?.isBinary) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-text-tertiary">
				This file is binary and cannot be shown in the Monaco viewer.
			</div>
		);
	}

	if (!fileContent || fileContent.error) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-status-red">
				{fileContent?.error ?? "Could not load file."}
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col bg-surface-1">
			<div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-[11px] text-text-tertiary">
				<span className="truncate">{fileContent.path}</span>
				<span>{Math.round(fileContent.size / 1024)} KB</span>
			</div>
			<div className="min-h-0 flex-1">
				<Editor
					height="100%"
					path={fileContent.path}
					defaultLanguage={getMonacoLanguage(fileContent.path)}
					language={getMonacoLanguage(fileContent.path)}
					value={fileContent.content ?? ""}
					onMount={handleEditorMount}
					onChange={handleEditorChange}
					options={createEditorOptions(editorSettings, isSaving)}
				/>
			</div>
		</div>
	);
}
