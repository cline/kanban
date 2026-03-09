export interface FileTreeNode {
	name: string;
	path: string;
	type: "file" | "directory";
	children: FileTreeNode[];
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
