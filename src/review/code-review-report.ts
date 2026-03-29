import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const CODE_REVIEW_FILENAME = "CODE_REVIEW.md";

export type CodeReviewDecision = "pass" | "changes_requested";
export type CodeReviewFindingSeverity = "critical" | "important" | "minor";

export interface CodeReviewFinding {
	severity: CodeReviewFindingSeverity;
	title: string;
	file: string | null;
	detail: string;
}

export interface CodeReviewRound {
	round: number;
	reviewerAgentId: string;
	reviewedRef: string | null;
	decision: CodeReviewDecision;
	summary: string;
	findings: CodeReviewFinding[];
	nextStep: string;
}

export interface CodeReviewDocument {
	taskId: string;
	runId: string;
	rounds: CodeReviewRound[];
}

export interface AppendCodeReviewRoundInput {
	workspacePath: string;
	taskId: string;
	runId: string;
	round: CodeReviewRound;
}

function normalizeDecision(value: string | null | undefined): CodeReviewDecision | null {
	const normalized = value?.trim().toUpperCase();
	if (normalized === "PASS") {
		return "pass";
	}
	if (normalized === "CHANGES_REQUESTED") {
		return "changes_requested";
	}
	return null;
}

function normalizeSeverity(value: string | null | undefined): CodeReviewFindingSeverity {
	const normalized = value?.trim().toLowerCase();
	if (normalized === "critical" || normalized === "important") {
		return normalized;
	}
	return "minor";
}

function trimTrailingWhitespace(value: string): string {
	return value
		.split("\n")
		.map((line) => line.replace(/\s+$/g, ""))
		.join("\n")
		.trim();
}

function renderMultilineListValue(label: string, value: string): string {
	const normalized = trimTrailingWhitespace(value);
	const [firstLine = "", ...remainingLines] = normalized.split("\n");
	return [
		`   - ${label}: ${firstLine}`,
		...remainingLines.map((line) => `     ${line}`),
	].join("\n");
}

function parseMetadataValue(markdown: string, label: string): string | null {
	const pattern = new RegExp(`^- ${label}:\\s*(.+)$`, "im");
	const match = markdown.match(pattern);
	return match?.[1]?.trim() || null;
}

function getRoundBlocks(markdown: string): Array<{ round: number; content: string }> {
	const matches = [...markdown.matchAll(/^### Round (\d+)\s*$/gm)];
	if (matches.length === 0) {
		return [];
	}

	return matches.map((match, index) => {
		const round = Number.parseInt(match[1] ?? "0", 10);
		const start = match.index ?? 0;
		const end = index + 1 < matches.length ? (matches[index + 1]?.index ?? markdown.length) : markdown.length;
		return {
			round,
			content: markdown.slice(start, end),
		};
	});
}

function extractSection(content: string, heading: string): string {
	const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const headingPattern = new RegExp(`^#### ${escapedHeading}\\s*$`, "m");
	const match = headingPattern.exec(content);
	if (!match) {
		return "";
	}
	const sectionStart = (match.index ?? 0) + match[0].length;
	const remainder = content.slice(sectionStart).replace(/^\n+/u, "");
	const nextSectionIndex = remainder.search(/^(?:####\s+|###\s+Round\s+\d+\s*$)/m);
	return trimTrailingWhitespace(nextSectionIndex === -1 ? remainder : remainder.slice(0, nextSectionIndex));
}

function parseFindingsSection(section: string): CodeReviewFinding[] {
	const trimmed = trimTrailingWhitespace(section);
	if (!trimmed || /^no findings\b/i.test(trimmed)) {
		return [];
	}

	const itemMatches = [...trimmed.matchAll(/^\d+\.\s*\[([^\]]+)\]\s*(.+)$/gm)];
	if (itemMatches.length === 0) {
		return [];
	}

	return itemMatches.map((match, index) => {
		const start = match.index ?? 0;
		const end = index + 1 < itemMatches.length ? (itemMatches[index + 1]?.index ?? trimmed.length) : trimmed.length;
		const block = trimmed.slice(start, end);
		const fileMatch = block.match(/^\s*-\s*File:\s*(.+)$/im);
		const detailMatch = block.match(/^\s*-\s*Detail:\s*([\s\S]+)$/im);
		return {
			severity: normalizeSeverity(match[1]),
			title: trimTrailingWhitespace(match[2] ?? ""),
			file: fileMatch?.[1]?.trim() === "N/A" ? null : fileMatch?.[1]?.trim() || null,
			detail: trimTrailingWhitespace(detailMatch?.[1] ?? ""),
		};
	});
}

function parseRound(content: string, roundNumber: number): CodeReviewRound | null {
	const reviewerAgentId = parseMetadataValue(content, "Reviewer Agent");
	const decision = normalizeDecision(parseMetadataValue(content, "Decision"));
	if (!reviewerAgentId || !decision) {
		return null;
	}

	const reviewedRef = parseMetadataValue(content, "Reviewed Ref");
	return {
		round: roundNumber,
		reviewerAgentId,
		reviewedRef,
		decision,
		summary: extractSection(content, "Summary"),
		findings: parseFindingsSection(extractSection(content, "Findings")),
		nextStep: extractSection(content, "Next Step"),
	};
}

function renderFindings(findings: readonly CodeReviewFinding[]): string {
	if (findings.length === 0) {
		return "No findings";
	}

	return findings
		.map((finding, index) => {
			const file = finding.file?.trim() || "N/A";
			return [
				`${index + 1}. [${finding.severity}] ${finding.title.trim()}`,
				`   - File: ${file}`,
				renderMultilineListValue("Detail", finding.detail),
			].join("\n");
		})
		.join("\n\n");
}

function renderRound(round: CodeReviewRound): string {
	const decision = round.decision === "pass" ? "PASS" : "CHANGES_REQUESTED";
	return trimTrailingWhitespace(`
### Round ${round.round}

- Reviewer Agent: ${round.reviewerAgentId}
- Reviewed Ref: ${round.reviewedRef?.trim() || "HEAD"}
- Decision: ${decision}

#### Summary

${round.summary.trim()}

#### Findings

${renderFindings(round.findings)}

#### Next Step

${round.nextStep.trim()}
`);
}

export function getCodeReviewReportPath(workspacePath: string): string {
	return join(workspacePath, CODE_REVIEW_FILENAME);
}

export function createCodeReviewDocument(taskId: string, runId: string, rounds: readonly CodeReviewRound[]): CodeReviewDocument {
	return {
		taskId: taskId.trim(),
		runId: runId.trim(),
		rounds: [...rounds].sort((left, right) => left.round - right.round),
	};
}

export function renderCodeReviewDocument(document: CodeReviewDocument): string {
	const renderedRounds =
		document.rounds.length > 0 ? document.rounds.map((round) => renderRound(round)).join("\n\n") : "";

	return `${trimTrailingWhitespace(`
# Code Review

## Metadata

- Task: ${document.taskId}
- Run: ${document.runId}

## Round History

${renderedRounds}
`)}\n`;
}

export function parseCodeReviewDocument(markdown: string): CodeReviewDocument | null {
	const taskId = parseMetadataValue(markdown, "Task");
	const runId = parseMetadataValue(markdown, "Run");
	if (!taskId || !runId) {
		return null;
	}

	const rounds = getRoundBlocks(markdown)
		.map((block) => parseRound(block.content, block.round))
		.filter((round): round is CodeReviewRound => round !== null);

	return createCodeReviewDocument(taskId, runId, rounds);
}

export async function readCodeReviewDocument(workspacePath: string): Promise<CodeReviewDocument | null> {
	try {
		const markdown = await readFile(getCodeReviewReportPath(workspacePath), "utf8");
		return parseCodeReviewDocument(markdown);
	} catch {
		return null;
	}
}

export async function ensureCodeReviewDocument(workspacePath: string, taskId: string, runId: string): Promise<string> {
	const reportPath = getCodeReviewReportPath(workspacePath);
	await mkdir(dirname(reportPath), { recursive: true });

	const existing = await readCodeReviewDocument(workspacePath);
	if (existing && existing.taskId === taskId && existing.runId === runId) {
		return reportPath;
	}

	const initialDocument = createCodeReviewDocument(taskId, runId, []);
	await writeFile(reportPath, renderCodeReviewDocument(initialDocument), "utf8");
	return reportPath;
}

export async function appendCodeReviewRound(input: AppendCodeReviewRoundInput): Promise<CodeReviewDocument> {
	const reportPath = await ensureCodeReviewDocument(input.workspacePath, input.taskId, input.runId);
	const existing = (await readCodeReviewDocument(input.workspacePath)) ?? createCodeReviewDocument(input.taskId, input.runId, []);
	const nextRounds = existing.rounds.filter((round) => round.round !== input.round.round);
	nextRounds.push(input.round);
	const nextDocument = createCodeReviewDocument(input.taskId, input.runId, nextRounds);
	await writeFile(reportPath, renderCodeReviewDocument(nextDocument), "utf8");
	return nextDocument;
}
