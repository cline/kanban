import Prism from "prismjs";
import type { ReactElement, ReactNode } from "react";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-c";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-css";
import "prismjs/components/prism-go";
import "prismjs/components/prism-java";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-php";
import "prismjs/components/prism-python";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-yaml";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/components/ui/cn";

const PRISM_LANGUAGE_ALIASES: Record<string, string> = {
	bash: "bash",
	c: "c",
	cpp: "cpp",
	cs: "csharp",
	css: "css",
	go: "go",
	html: "markup",
	java: "java",
	js: "javascript",
	json: "json",
	jsx: "jsx",
	md: "markdown",
	mdx: "markdown",
	php: "php",
	py: "python",
	rb: "ruby",
	rs: "rust",
	sh: "bash",
	sql: "sql",
	swift: "swift",
	ts: "typescript",
	tsx: "tsx",
	typescript: "typescript",
	xml: "markup",
	yaml: "yaml",
	yml: "yaml",
	zsh: "bash",
};

function normalizeLanguageTag(className: string | undefined): string | null {
	if (!className) {
		return null;
	}
	const match = /language-([A-Za-z0-9_-]+)/.exec(className);
	if (!match?.[1]) {
		return null;
	}
	const requestedLanguage = match[1].toLowerCase();
	const resolvedLanguage = PRISM_LANGUAGE_ALIASES[requestedLanguage] ?? requestedLanguage;
	return Prism.languages[resolvedLanguage] ? resolvedLanguage : null;
}

function toCodeString(children: ReactNode): string {
	const value = String(children ?? "");
	return value.endsWith("\n") ? value.slice(0, -1) : value;
}

const markdownComponents: Components = {
	h1: ({ className, ...props }) => (
		<h1 className={cn("mt-3 text-base font-semibold text-text-primary", className)} {...props} />
	),
	h2: ({ className, ...props }) => (
		<h2 className={cn("mt-3 text-base font-semibold text-text-primary", className)} {...props} />
	),
	h3: ({ className, ...props }) => (
		<h3 className={cn("mt-2 text-sm font-semibold text-text-primary", className)} {...props} />
	),
	p: ({ className, ...props }) => (
		<p className={cn("leading-snug whitespace-pre-wrap text-sm text-text-primary", className)} {...props} />
	),
	ul: ({ className, ...props }) => (
		<ul className={cn("list-disc pl-5 leading-snug text-sm text-text-primary", className)} {...props} />
	),
	ol: ({ className, ...props }) => (
		<ol className={cn("list-decimal pl-5 leading-snug text-sm text-text-primary", className)} {...props} />
	),
	li: ({ className, ...props }) => (
		<li className={cn("leading-snug text-sm text-text-primary", className)} {...props} />
	),
	a: ({ className, ...props }) => (
		<a className={cn("text-accent-2 underline", className)} target="_blank" rel="noreferrer" {...props} />
	),
	blockquote: ({ className, ...props }) => (
		<blockquote
			className={cn("border-l-2 border-border-bright pl-3 text-sm leading-snug text-text-secondary", className)}
			{...props}
		/>
	),
	hr: ({ className, ...props }) => <hr className={cn("border-border", className)} {...props} />,
	code: ({ className, children, ...props }) => {
		const code = toCodeString(children);
		const isInline = !className || !className.includes("language-");
		if (isInline) {
			return (
				<code
					className={cn(
						"rounded bg-surface-2 px-1 py-0.5 font-mono text-xs whitespace-pre-wrap break-all text-text-primary",
						className,
					)}
					{...props}
				>
					{code}
				</code>
			);
		}

		const prismLanguage = normalizeLanguageTag(className);
		const prismGrammar = prismLanguage ? (Prism.languages[prismLanguage] ?? null) : null;
		const highlighted = prismGrammar && prismLanguage ? Prism.highlight(code, prismGrammar, prismLanguage) : null;

		if (highlighted) {
			return (
				<pre className="my-0.5 overflow-x-auto rounded-md border border-border bg-surface-1 px-2 py-1.5 text-xs leading-5 text-text-primary">
					<code className={`language-${prismLanguage}`} dangerouslySetInnerHTML={{ __html: highlighted }} />
				</pre>
			);
		}

		return (
			<pre className="my-0.5 overflow-x-auto rounded-md border border-border bg-surface-1 px-2 py-1.5 text-xs leading-5 text-text-primary">
				<code className={cn("font-mono", className)}>{code}</code>
			</pre>
		);
	},
};

export function ClineMarkdownContent({ content }: { content: string }): ReactElement {
	if (!content.trim()) {
		return <span className="text-text-secondary" />;
	}
	return (
		<div className="kb-markdown min-w-0">
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
				{content}
			</ReactMarkdown>
		</div>
	);
}
