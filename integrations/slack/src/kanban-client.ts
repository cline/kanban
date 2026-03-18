import { randomUUID } from "node:crypto";

/**
 * Minimal types mirroring the kanban runtime API.
 * We use raw HTTP instead of the typed tRPC client to keep
 * this integration self-contained (no dependency on kanban source).
 */

interface BoardCard {
  id: string;
  prompt: string;
  baseRef: string;
  startInPlanMode: boolean;
  autoReviewEnabled: boolean;
  autoReviewMode: "commit" | "pr" | "move_to_trash";
  createdAt: number;
  updatedAt: number;
}

interface BoardColumn {
  id: string;
  cards: BoardCard[];
}

interface BoardData {
  columns: BoardColumn[];
}

interface WorkspaceState {
  repoPath: string;
  git: {
    currentBranch: string | null;
    defaultBranch: string | null;
    branches: string[];
  };
  board: BoardData;
  sessions: Record<string, unknown>;
  revision: number;
}

/** Result of a tRPC call */
interface TrpcBatchResponse<T> {
  result: { data: T };
}

export interface KanbanTask {
  id: string;
  prompt: string;
  baseRef: string;
  column: string;
}

/** Per-user kanban instance config needed to reach the local kanban board. */
export interface UserConfig {
  kanbanUrl: string;
  workspaceId: string;
}

export interface CreateTaskOptions {
  workspaceId: string;
  prompt: string;
}

export interface KanbanClientOptions {
  baseUrl: string;
}

/**
 * HTTP client for the Kanban runtime API.
 */
export class KanbanClient {
  private readonly baseUrl: string;

  constructor({ baseUrl }: KanbanClientOptions) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async trpcQuery<T>(
    workspaceId: string,
    procedure: string,
    input?: unknown,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/trpc/${procedure}`);
    if (input !== undefined) {
      url.searchParams.set("input", JSON.stringify(input));
    }

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-kanban-workspace-id": workspaceId,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`tRPC query ${procedure} failed (${res.status}): ${text}`);
    }

    const body = (await res.json()) as TrpcBatchResponse<T>;
    return body.result.data;
  }

  private async trpcMutate<T>(
    workspaceId: string | null,
    procedure: string,
    input: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}/api/trpc/${procedure}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (workspaceId) {
      headers["x-kanban-workspace-id"] = workspaceId;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`tRPC mutation ${procedure} failed (${res.status}): ${text}`);
    }

    const body = (await res.json()) as TrpcBatchResponse<T>;
    return body.result.data;
  }

  /**
   * Create a new task in the backlog of the given workspace.
   * Returns the created task with its id, prompt, baseRef, and column.
   */
  async createTask({ workspaceId, prompt }: CreateTaskOptions): Promise<KanbanTask> {
    const state = await this.trpcQuery<WorkspaceState>(
      workspaceId,
      "workspace.getState",
    );

    const baseRef =
      state.git.currentBranch ??
      state.git.defaultBranch ??
      state.git.branches[0] ??
      "main";

    const taskId = randomUUID().slice(0, 7);
    const now = Date.now();
    const newCard: BoardCard = {
      id: taskId,
      prompt,
      baseRef,
      startInPlanMode: false,
      autoReviewEnabled: false,
      autoReviewMode: "commit",
      createdAt: now,
      updatedAt: now,
    };

    const backlogColumn = state.board.columns.find((c) => c.id === "backlog");
    if (!backlogColumn) {
      throw new Error("No backlog column found in workspace board");
    }
    backlogColumn.cards.unshift(newCard);

    await this.trpcMutate(workspaceId, "workspace.saveState", {
      board: state.board,
      sessions: state.sessions,
      expectedRevision: state.revision,
    });

    return { id: taskId, prompt, baseRef, column: "backlog" };
  }

  /**
   * List tasks in the given workspace, optionally filtered by column.
   */
  async listTasks(
    workspaceId: string,
    column?: string,
  ): Promise<KanbanTask[]> {
    const state = await this.trpcQuery<WorkspaceState>(
      workspaceId,
      "workspace.getState",
    );

    const tasks: KanbanTask[] = [];
    for (const col of state.board.columns) {
      if (column && col.id !== column) continue;
      for (const card of col.cards) {
        tasks.push({
          id: card.id,
          prompt: card.prompt,
          baseRef: card.baseRef,
          column: col.id,
        });
      }
    }
    return tasks;
  }
}

/**
 * Check if a user's kanban instance is reachable.
 */
export async function checkConnection(config: UserConfig): Promise<boolean> {
  try {
    // Use projects.list — it doesn't require a workspace ID header and is a
    // reliable indicator that the kanban runtime is up and accepting requests.
    const res = await fetch(`${config.kanbanUrl}/api/trpc/projects.list`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Create a task on a user's kanban board using their UserConfig.
 */
export async function createTask(
  config: UserConfig,
  prompt: string,
): Promise<{ taskId: string }> {
  const client = new KanbanClient({ baseUrl: config.kanbanUrl });
  const task = await client.createTask({ workspaceId: config.workspaceId, prompt });
  return { taskId: task.id };
}

/**
 * List tasks on a user's kanban board using their UserConfig.
 * Pass an optional column name to filter results.
 */
export async function listTasks(
  config: UserConfig,
  column?: string,
): Promise<KanbanTask[]> {
  const client = new KanbanClient({ baseUrl: config.kanbanUrl });
  return client.listTasks(config.workspaceId, column);
}
