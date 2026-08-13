import * as Ably from "ably";
import { sql } from "../../../lib/database";
import type { ScheduleScope, Task } from "../../../schedule/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StoredRow = { id: string | number; data: Task | string; version: number };
type TaskContext = { scope?: ScheduleScope; ownerId?: number | null };
type MutationBody = TaskContext & { changes?: Task[]; deletedIds?: number[] };

async function ensureTable(): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS schedule_task_entries (
    scope_key TEXT NOT NULL,
    id BIGINT NOT NULL,
    data JSONB NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (scope_key, id)
  )`;
}

function parseContext(value: TaskContext): { scope: ScheduleScope; ownerId: number | null; scopeKey: string } | null {
  if (value.scope === "COMPANY") return { scope: "COMPANY", ownerId: null, scopeKey: "COMPANY" };
  if (value.scope === "USER" && Number.isSafeInteger(value.ownerId) && (value.ownerId as number) > 0) {
    return { scope: "USER", ownerId: value.ownerId as number, scopeKey: `USER:${value.ownerId}` };
  }
  return null;
}

function rowToTask(row: StoredRow): Task {
  const data = typeof row.data === "string" ? (JSON.parse(row.data) as Task) : row.data;
  return { ...data, id: Number(row.id), version: Number(row.version) };
}

function isTask(value: unknown): value is Task {
  return typeof value === "object" && value !== null && Number.isSafeInteger((value as Task).id) && typeof (value as Task).title === "string";
}

function channelName(context: { scope: ScheduleScope; ownerId: number | null }): string {
  return context.scope === "COMPANY" ? "schedule:company" : `schedule:user:${context.ownerId}`;
}

async function publish(context: { scope: ScheduleScope; ownerId: number | null }, tasks: Task[], deletedIds: number[]): Promise<void> {
  const key = process.env.ABLY_API_KEY;
  if (!key) return;
  const client = new Ably.Rest(key);
  await client.channels.get(channelName(context)).publish("tasks.changed", { tasks, deletedIds });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const context = parseContext({ scope: params.get("scope") as ScheduleScope | null ?? undefined, ownerId: params.has("ownerId") ? Number(params.get("ownerId")) : null });
  if (!context) return Response.json({ error: "A valid schedule scope is required." }, { status: 400 });
  await ensureTable();
  const rows = (await sql`SELECT id, data, version FROM schedule_task_entries WHERE scope_key = ${context.scopeKey} ORDER BY id`) as StoredRow[];
  return Response.json(rows.map(rowToTask), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  let body: MutationBody;
  try {
    body = (await request.json()) as MutationBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const context = parseContext(body);
  const changes = body.changes ?? [];
  const deletedIds = body.deletedIds ?? [];
  if (!context || !Array.isArray(changes) || !changes.every(isTask) || !Array.isArray(deletedIds) || !deletedIds.every(Number.isSafeInteger)) {
    return Response.json({ error: "Invalid task payload or schedule scope." }, { status: 400 });
  }

  await ensureTable();
  const saved: Task[] = [];
  try {
    for (const task of changes) {
      const previousVersion = task.version ?? 0;
      const data = { ...task };
      delete data.version;
      if (previousVersion === 0) {
        const rows = (await sql`INSERT INTO schedule_task_entries (scope_key, id, data) VALUES (${context.scopeKey}, ${task.id}, ${JSON.stringify(data)}::jsonb) RETURNING id, data, version`) as StoredRow[];
        saved.push(rowToTask(rows[0]!));
      } else {
        const rows = (await sql`UPDATE schedule_task_entries SET data = ${JSON.stringify(data)}::jsonb, version = version + 1, updated_at = NOW() WHERE scope_key = ${context.scopeKey} AND id = ${task.id} AND version = ${previousVersion} RETURNING id, data, version`) as StoredRow[];
        if (rows.length === 0) return Response.json({ error: "Task was changed by another user." }, { status: 409 });
        saved.push(rowToTask(rows[0]!));
      }
    }
    for (const id of deletedIds) {
      await sql`DELETE FROM schedule_task_entries WHERE scope_key = ${context.scopeKey} AND id = ${id}`;
    }
  } catch (error) {
    if (error instanceof Error && /duplicate key/i.test(error.message)) return Response.json({ error: "Task was changed by another user." }, { status: 409 });
    throw error;
  }

  await publish(context, saved, deletedIds);
  return Response.json({ tasks: saved, deletedIds });
}
