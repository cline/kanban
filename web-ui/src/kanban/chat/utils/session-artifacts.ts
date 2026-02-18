import type { ChatTimelineEntry } from "@/kanban/chat/types";

export interface SessionDiffEntry {
	id: string;
	path: string;
	oldText: string | null;
	newText: string;
	timestamp: number;
	toolTitle: string;
}

export interface FileTreeNode {
	name: string;
	path: string;
	type: "file" | "directory";
	children: FileTreeNode[];
}

export function extractDiffEntries(timeline: ChatTimelineEntry[]): SessionDiffEntry[] {
	const diffEntries: SessionDiffEntry[] = [];

	for (const entry of timeline) {
		if (entry.type !== "tool_call") {
			continue;
		}

		for (const [contentIndex, content] of (entry.toolCall.content ?? []).entries()) {
			if (content.type !== "diff") {
				continue;
			}
			diffEntries.push({
				id: `${entry.id}-${contentIndex}`,
				path: content.path,
				oldText: content.oldText,
				newText: content.newText,
				timestamp: entry.timestamp,
				toolTitle: entry.toolCall.title,
			});
		}
	}

	return diffEntries.sort((a, b) => a.timestamp - b.timestamp);
}

export function extractReferencedPaths(timeline: ChatTimelineEntry[]): string[] {
	const paths = new Set<string>();

	for (const entry of timeline) {
		if (entry.type !== "tool_call") {
			continue;
		}

		for (const location of entry.toolCall.locations ?? []) {
			paths.add(location.path);
		}

		for (const content of entry.toolCall.content ?? []) {
			if (content.type === "diff") {
				paths.add(content.path);
			}
		}
	}

	return Array.from(paths).sort((a, b) => a.localeCompare(b));
}

export function buildFileTree(paths: string[]): FileTreeNode[] {
	const root: FileTreeNode[] = [];

	for (const rawPath of paths) {
		const parts = rawPath.split("/").filter(Boolean);
		let currentLevel = root;
		let currentPath = "";

		for (const [index, part] of parts.entries()) {
			currentPath = currentPath ? `${currentPath}/${part}` : part;
			const isLeaf = index === parts.length - 1;

			let node = currentLevel.find((candidate) => candidate.name === part);
			if (!node) {
				node = {
					name: part,
					path: currentPath,
					type: isLeaf ? "file" : "directory",
					children: [],
				};
				currentLevel.push(node);
			}

			if (!isLeaf) {
				currentLevel = node.children;
			}
		}
	}

	function sortNodes(nodes: FileTreeNode[]): FileTreeNode[] {
		return nodes
			.map((node) => ({ ...node, children: sortNodes(node.children) }))
			.sort((a, b) => {
				if (a.type === b.type) {
					return a.name.localeCompare(b.name);
				}
				return a.type === "directory" ? -1 : 1;
			});
	}

	return sortNodes(root);
}
