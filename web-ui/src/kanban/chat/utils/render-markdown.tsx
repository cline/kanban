import ReactMarkdown, {
	defaultUrlTransform,
	type Components,
	type UrlTransform,
} from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

const protocolPattern = /^[a-z][a-z\d+\-.]*:/i;

const safeUrlTransform: UrlTransform = (url) => {
	if (!protocolPattern.test(url)) {
		return defaultUrlTransform(url);
	}

	const normalized = url.toLowerCase();
	if (
		normalized.startsWith("http:") ||
		normalized.startsWith("https:") ||
		normalized.startsWith("mailto:") ||
		normalized.startsWith("tel:")
	) {
		return defaultUrlTransform(url);
	}

	return "#";
};

const markdownComponents: Components = {
	p: ({ className, ...props }) => (
		<p className={cn("break-words leading-relaxed [&:not(:first-child)]:mt-2", className)} {...props} />
	),
	a: ({ className, ...props }) => (
		<a
			className={cn("break-all text-blue-400 underline hover:text-blue-300", className)}
			target="_blank"
			rel="noreferrer noopener"
			{...props}
		/>
	),
	code: ({ className, ...props }) => {
		const isBlock = className?.includes("language-");
		if (isBlock) {
			return <code className={cn("font-mono text-xs leading-relaxed", className)} {...props} />;
		}
		return (
			<code
				className={cn("break-all rounded bg-zinc-900 px-1 py-0.5 font-mono text-xs", className)}
				{...props}
			/>
		);
	},
	pre: ({ className, ...props }) => (
		<pre
			className={cn(
				"my-2 min-w-0 overflow-x-auto whitespace-pre-wrap break-words rounded bg-zinc-900 p-3 font-mono text-xs leading-relaxed",
				className,
			)}
			{...props}
		/>
	),
	ul: ({ className, ...props }) => (
		<ul className={cn("my-2 list-disc space-y-1 pl-5", className)} {...props} />
	),
	ol: ({ className, ...props }) => (
		<ol className={cn("my-2 list-decimal space-y-1 pl-5", className)} {...props} />
	),
	li: ({ className, ...props }) => <li className={cn("leading-relaxed", className)} {...props} />,
};

export function renderMarkdown(text: string): React.ReactElement {
	return (
		<ReactMarkdown
			remarkPlugins={[remarkGfm]}
			components={markdownComponents}
			skipHtml
			urlTransform={safeUrlTransform}
		>
			{text}
		</ReactMarkdown>
	);
}
