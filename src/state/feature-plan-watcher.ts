/**
 * Feature Plan Watcher
 * 
 * Watches the `.cline_task_plan` directory for new feature plan files
 * and automatically imports them as tasks in the Kanban backlog.
 */

import { readdir, stat, rename } from "node:fs/promises";
import { join } from "node:path";
import { parseFeaturePlan, type FeaturePlan } from "./feature-plan-parser";
import { mutateWorkspaceState } from "./workspace-state";
import { addTaskToColumn } from "../core/task-board-mutations";

export interface FeaturePlanWatcherOptions {
  /**
   * Polling interval in milliseconds
   * @default 5000
   */
  pollIntervalMs?: number;
  
  /**
   * Callback when a feature plan is successfully imported
   */
  onImport?: (plan: FeaturePlan, taskId: string) => void;
  
  /**
   * Callback when a feature plan fails to import
   */
  onError?: (filePath: string, error: string) => void;
}

/**
 * Create a feature plan watcher for a workspace
 */
export function createFeaturePlanWatcher(options: FeaturePlanWatcherOptions = {}) {
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  
  let workspacePath: string | null = null;
  let intervalId: NodeJS.Timeout | null = null;
  const processedFiles = new Set<string>();
  let isRunning = false;

  /**
   * Start watching the `.cline_task_plan` directory
   */
  function start(path: string): void {
    if (isRunning) {
      return;
    }
    
    workspacePath = path;
    isRunning = true;
    
    // Initial scan
    scanAndImport();
    
    // Set up polling
    intervalId = setInterval(scanAndImport, pollIntervalMs);
  }

  /**
   * Stop watching
   */
  async function stop(): Promise<void> {
    isRunning = false;
    
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    
    workspacePath = null;
  }

  /**
   * Scan the directory and import any new feature plans
   */
  async function scanAndImport(): Promise<void> {
    if (!workspacePath || !isRunning) {
      return;
    }

    const planDir = join(workspacePath, ".cline_task_plan");
    
    try {
      // Check if directory exists
      await stat(planDir);
    } catch {
      // Directory doesn't exist yet - that's ok, we'll check again on next poll
      return;
    }

    try {
      const files = await readdir(planDir);
      
      for (const file of files) {
        // Skip already processed files and non-markdown files
        if (!file.endsWith(".md") || file.endsWith(".processed")) {
          continue;
        }
        
        const filePath = join(planDir, file);
        
        // Skip if already processed in this session
        if (processedFiles.has(filePath)) {
          continue;
        }
        
        // Check if it's a file (not a directory)
        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) {
          continue;
        }

        // Mark as processed immediately to avoid duplicates
        processedFiles.add(filePath);
        
        // Parse and import
        await processFile(filePath);
      }
    } catch (error) {
      console.error("[FeaturePlanWatcher] Error scanning directory:", error);
    }
  }

  /**
   * Process a single feature plan file
   */
  async function processFile(filePath: string): Promise<void> {
    if (!workspacePath) {
      return;
    }

    const parseResult = await parseFeaturePlan(filePath);
    
    if (!parseResult.success || !parseResult.plan) {
      const error = parseResult.error ?? "Unknown parse error";
      console.warn(`[FeaturePlanWatcher] Failed to parse ${filePath}: ${error}`);
      options.onError?.(filePath, error);
      return;
    }

    const plan = parseResult.plan;
    
    try {
      // Import the feature plan as a task in the backlog
      const result = await mutateWorkspaceState(
        workspacePath,
        (state) => {
          // Get the baseRef from the workspace git state
          const baseRef = state.git.currentBranch ?? state.git.defaultBranch ?? "main";
          
          const created = addTaskToColumn(
            state.board,
            "backlog",
            {
              title: plan.title,
              prompt: plan.prompt,
              baseRef,
            },
            () => crypto.randomUUID(),
          );
          
          return {
            board: created.board,
            value: {
              success: true,
              taskId: created.task.id,
              taskTitle: created.task.title,
            },
          };
        },
      );

      if (result.success) {
        console.log(
          `[FeaturePlanWatcher] Imported "${plan.title}" as task ${result.value.taskId}`,
        );
        
        // Mark file as processed by renaming it
        try {
          await rename(filePath, `${filePath}.processed`);
        } catch {
          // Renaming failed - file might be locked, but import succeeded
          console.warn(`[FeaturePlanWatcher] Could not rename processed file: ${filePath}`);
        }
        
        options.onImport?.(plan, result.value.taskId);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[FeaturePlanWatcher] Failed to import ${filePath}:`, errorMessage);
      options.onError?.(filePath, errorMessage);
      
      // Remove from processed set so we can retry
      processedFiles.delete(filePath);
    }
  }

  return {
    start,
    stop,
  };
}

export type FeaturePlanWatcher = ReturnType<typeof createFeaturePlanWatcher>;
