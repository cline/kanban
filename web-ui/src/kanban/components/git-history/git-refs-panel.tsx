import { Classes, Colors, Icon, InputGroup, NonIdealState, Tag } from "@blueprintjs/core";
import { Fzf } from "fzf";
import { useMemo, useState } from "react";

import type { RuntimeGitRef } from "@/kanban/runtime/types";

const ROW_HEIGHT = 30;
const MATCHED_TEXT_STYLE = {
	color: "var(--bp-typography-color-primary-rest)",
	fontWeight: 600,
} as const;

function renderHighlightedText(value: string, positions: Set<number> | undefined): React.ReactNode {
	if (!positions || positions.size === 0) {
		return value;
	}

	const fragments: React.ReactNode[] = [];
	let currentText = "";
	let currentIsMatch: boolean | null = null;
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];
		if (character == null) {
			continue;
		}
		const isMatch = positions.has(index);
		if (currentIsMatch === null) {
			currentText = character;
			currentIsMatch = isMatch;
			continue;
		}
		if (currentIsMatch === isMatch) {
			currentText += character;
			continue;
		}
		fragments.push(
			<span
				key={`${index}:${currentIsMatch ? "match" : "plain"}`}
				style={currentIsMatch ? MATCHED_TEXT_STYLE : undefined}
			>
				{currentText}
			</span>,
		);
		currentText = character;
		currentIsMatch = isMatch;
	}

	if (currentIsMatch === null) {
		return value;
	}

	fragments.push(
		<span
			key="end"
			style={currentIsMatch ? MATCHED_TEXT_STYLE : undefined}
		>
			{currentText}
		</span>,
	);

	return fragments;
}

function AheadBehindIndicator({ ahead, behind }: { ahead?: number; behind?: number }): React.ReactElement | null {
	if (!ahead && !behind) {
		return null;
	}
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 3,
				fontSize: "var(--bp-typography-size-body-x-small)",
				color: "var(--bp-palette-gray-3)",
				flexShrink: 0,
			}}
		>
			{ahead ? (
				<span style={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
					<Icon icon="arrow-up" size={9} />
					{ahead}
				</span>
			) : null}
			{behind ? (
				<span style={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
					<Icon icon="arrow-down" size={9} />
					{behind}
				</span>
			) : null}
		</span>
	);
}

export function GitRefsPanel({
	refs,
	selectedRefName,
	isLoading,
	errorMessage,
	workingCopyChanges,
	isWorkingCopySelected,
	onSelectRef,
	onSelectWorkingCopy,
	onCheckoutRef,
}: {
	refs: RuntimeGitRef[];
	selectedRefName: string | null;
	isLoading: boolean;
	errorMessage?: string | null;
	workingCopyChanges: number | null;
	isWorkingCopySelected?: boolean;
	onSelectRef: (ref: RuntimeGitRef) => void;
	onSelectWorkingCopy?: () => void;
	onCheckoutRef?: (branchName: string) => void;
}): React.ReactElement {
	const [searchQuery, setSearchQuery] = useState("");

	const detachedRef = refs.find((r) => r.type === "detached");
	const branchRefs = refs.filter((r) => r.type === "branch");
	const headBranch = branchRefs.find((r) => r.isHead);
	const otherBranches = branchRefs.filter((r) => !r.isHead);
	const branchFinder = useMemo(
		() => new Fzf(otherBranches, { selector: (ref) => ref.name }),
		[otherBranches],
	);

	const fuzzyBranchResults = useMemo(() => {
		if (!searchQuery.trim()) {
			return [] as ReturnType<Fzf<typeof otherBranches>["find"]>;
		}
		return branchFinder.find(searchQuery);
	}, [branchFinder, searchQuery]);
	const filteredOtherBranches = useMemo(() => {
		if (!searchQuery.trim()) {
			return otherBranches;
		}
		return fuzzyBranchResults.map((result) => result.item);
	}, [fuzzyBranchResults, otherBranches, searchQuery]);
	const fuzzyBranchResultsByName = useMemo(
		() => new Map(fuzzyBranchResults.map((result) => [result.item.name, result])),
		[fuzzyBranchResults],
	);

	const showSearch = otherBranches.length > 0;

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width: 220,
				minWidth: 180,
				maxWidth: 280,
				overflow: "hidden",
				background: Colors.DARK_GRAY2,
			}}
		>
			<div style={{ overflowY: "auto", overscrollBehavior: "contain", padding: "8px 6px" }}>
				{isLoading ? (
					<div style={{ padding: "4px 6px" }}>
						<div className={Classes.SKELETON} style={{ height: ROW_HEIGHT - 4, width: "100%", borderRadius: 3, marginBottom: 4 }} />
						<div className={Classes.SKELETON} style={{ height: ROW_HEIGHT - 4, width: "100%", borderRadius: 3, marginBottom: 4 }} />
						<div className={Classes.SKELETON} style={{ height: ROW_HEIGHT - 4, width: "100%", borderRadius: 3 }} />
					</div>
				) : errorMessage ? (
					<div className="kb-empty-state-center" style={{ minHeight: 180, padding: 12 }}>
						<NonIdealState
							icon="error"
							title="Could not load refs"
							description={errorMessage}
						/>
					</div>
				) : (
					<>
						<div
							style={{
								padding: "2px 6px 8px",
								fontSize: "var(--bp-typography-size-body-x-small)",
								color: "var(--bp-palette-gray-3)",
								lineHeight: 1.4,
							}}
						>
							Select a branch to browse its history. Double-click a branch to switch the workspace branch.
						</div>
						{workingCopyChanges !== null && onSelectWorkingCopy ? (
							<RefRow
								isSelected={isWorkingCopySelected ?? false}
								selectedClassName="kb-git-ref-row-selected-warning"
								onSelect={onSelectWorkingCopy}
							>
								<Icon icon="document" size={12} color={Colors.GOLD4} />
								<span style={{ flex: 1 }}>Working Copy</span>
								<Tag minimal round style={{ fontSize: "var(--bp-typography-size-body-x-small)" }}>
									{workingCopyChanges}
								</Tag>
							</RefRow>
						) : null}

						{detachedRef ? (
							<RefRow
								isSelected={!isWorkingCopySelected && selectedRefName === detachedRef.name}
								onSelect={() => onSelectRef(detachedRef)}
							>
								<Icon icon="locate" size={12} />
								<span className="kb-line-clamp-1" style={{ flex: 1 }}>HEAD ({detachedRef.name})</span>
							</RefRow>
						) : null}

						{headBranch ? (
							<RefRow
								isSelected={!isWorkingCopySelected && (selectedRefName === headBranch.name || (selectedRefName === null && headBranch.isHead))}
								onSelect={() => onSelectRef(headBranch)}
							>
								<Icon icon="git-branch" size={12} />
								<span className="kb-line-clamp-1" style={{ flex: 1 }}>{headBranch.name}</span>
								<AheadBehindIndicator ahead={headBranch.ahead} behind={headBranch.behind} />
								<Tag minimal round intent="primary" style={{ fontSize: "var(--bp-typography-size-body-x-small)" }}>
									HEAD
								</Tag>
							</RefRow>
						) : null}

						{showSearch ? (
							<div style={{ padding: "6px 0 4px" }}>
								<InputGroup
									leftIcon="search"
									placeholder="Filter branches..."
									size="small"
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									style={{ fontSize: "var(--bp-typography-size-body-small)" }}
								/>
							</div>
						) : null}

						{filteredOtherBranches.map((ref) => (
							<RefRow
								key={ref.name}
								isSelected={!isWorkingCopySelected && selectedRefName === ref.name}
								onSelect={() => onSelectRef(ref)}
								onDoubleClick={onCheckoutRef ? () => onCheckoutRef(ref.name) : undefined}
							>
								<Icon icon="git-branch" size={12} />
								<span className="kb-line-clamp-1" style={{ flex: 1 }}>
									{renderHighlightedText(ref.name, fuzzyBranchResultsByName.get(ref.name)?.positions)}
								</span>
								<AheadBehindIndicator ahead={ref.ahead} behind={ref.behind} />
							</RefRow>
						))}

						{searchQuery && filteredOtherBranches.length === 0 ? (
							<div
								style={{
									padding: "8px 8px",
									fontSize: "var(--bp-typography-size-body-small)",
									color: "var(--bp-palette-gray-3)",
									textAlign: "center",
								}}
							>
								No matching branches
							</div>
						) : null}
					</>
				)}
			</div>
		</div>
	);
}

function RefRow({
	isSelected,
	selectedClassName,
	onSelect,
	onDoubleClick,
	children,
}: {
	isSelected: boolean;
	selectedClassName?: string;
	onSelect: () => void;
	onDoubleClick?: () => void;
	children: React.ReactNode;
}): React.ReactElement {
	const resolvedSelectedClass = selectedClassName ?? "kb-git-ref-row-selected";
	return (
		<div
			className={isSelected ? `kb-git-ref-row ${resolvedSelectedClass}` : "kb-git-ref-row"}
			style={{
				display: "flex",
				alignItems: "center",
				gap: 6,
				width: "100%",
				height: ROW_HEIGHT,
				paddingLeft: 8,
				paddingRight: 4,
				overflow: "hidden",
				borderRadius: "var(--bp-surface-border-radius)",
				color: isSelected ? "var(--bp-palette-light-gray-5)" : "var(--bp-palette-gray-4)",
			}}
		>
			<button
				type="button"
				onClick={onSelect}
				onDoubleClick={onDoubleClick}
				className="kb-git-ref-row-main"
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					flex: 1,
					minWidth: 0,
					height: "100%",
					padding: 0,
					border: "none",
					background: "transparent",
					color: "inherit",
					textAlign: "left",
					fontFamily: "inherit",
					fontSize: "var(--bp-typography-size-body-small)",
					cursor: "pointer",
				}}
			>
				{children}
			</button>
		</div>
	);
}
