/**
 * Feature Plan Parser
 * 
 * Parses feature plan markdown files from the `.cline_task_plan` directory.
 * Files should have YAML frontmatter with title and optional priority,
 * followed by the feature description as the task prompt.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface FeaturePlan {
  title: string;
  prompt: string;
  priority: "high" | "medium" | "low";
  sourceFile: string;
}

export interface ParseFeaturePlanResult {
  success: boolean;
  plan?: FeaturePlan;
  error?: string;
}

/**
 * Parse a feature plan file
 */
export async function parseFeaturePlan(filePath: string): Promise<ParseFeaturePlanResult> {
  try {
    const content = await readFile(filePath, "utf-8");
    return parseFeaturePlanContent(content, filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to read file: ${message}`,
    };
  }
}

/**
 * Parse feature plan from string content
 */
export function parseFeaturePlanContent(content: string, sourceFile: string): ParseFeaturePlanResult {
  // Check for frontmatter
  if (!content.startsWith("---")) {
    // No frontmatter - treat entire content as prompt, use filename as title
    const title = extractTitleFromFilename(sourceFile);
    const prompt = content.trim();
    
    if (!prompt) {
      return {
        success: false,
        error: "Empty file - no prompt content found",
      };
    }
    
    return {
      success: true,
      plan: {
        title,
        prompt,
        priority: "medium",
        sourceFile,
      },
    };
  }

  // Find the end of frontmatter
  const frontmatterEnd = content.indexOf("---", 3);
  if (frontmatterEnd === -1) {
    return {
      success: false,
      error: "Invalid frontmatter - missing closing ---",
    };
  }

  const frontmatter = content.substring(3, frontmatterEnd).trim();
  const body = content.substring(frontmatterEnd + 3).trim();

  // Parse YAML-like frontmatter
  const fields: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim().toLowerCase();
      const value = line.substring(colonIndex + 1).trim();
      fields[key] = value;
    }
  }

  const title = fields.title?.trim();
  const priorityRaw = fields.priority?.trim().toLowerCase();

  if (!title) {
    return {
      success: false,
      error: "Missing required 'title' in frontmatter",
    };
  }

  let priority: "high" | "medium" | "low" = "medium";
  if (priorityRaw === "high" || priorityRaw === "low") {
    priority = priorityRaw;
  }

  // Use body as prompt, or fallback to title if body is empty
  const prompt = body || title;

  if (!prompt) {
    return {
      success: false,
      error: "No prompt content found in file body",
    };
  }

  return {
    success: true,
    plan: {
      title,
      prompt,
      priority,
      sourceFile,
    },
  };
}

/**
 * Extract a title from a filename
 */
function extractTitleFromFilename(filePath: string): string {
  const basename = filePath.split("/").pop() ?? "Untitled";
  // Remove .md extension and replace hyphens/underscores with spaces
  return basename.replace(/\.md$/, "").replace(/[-_]/g, " ");
}

/**
 * Get the feature plan directory path for a workspace
 */
export function getFeaturePlanDir(workspacePath: string): string {
  return join(workspacePath, ".cline_task_plan");
}
