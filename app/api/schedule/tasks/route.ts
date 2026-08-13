import * as Ably from "ably";
import { sql } from "../../../lib/database";
import type { Task } from "../../../schedule/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StoredRow = { id: string | number; data: Task | string; version: number };
type MutationBody = { changes?: Task[]; deletedIds?: number[] };

async function ensureTable(): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS schedule_tasks (
    id BIGINT PRIMARY KEY,
    data JSONB NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
}

function rowToTask(row: StoredRow): Task {
  const data = typeof row.data === "string" ? (JSON.parse(row.data) as Task) : row.data;
  return { ...data, id: Number(row.id), version: Number(row.version) };
}

function isTask(value: unknown): value is Task {
  return typeof value === "object" && value !== null && Number.isSafeInteger((value as Task).id) && typeof (value as Task).title === "string";
}

async function publish(tasks: Task[], deletedIds: number[]): Promise<void> {
  const key = process.env.ABLY_API_KEY;
  if (!key) return;
  const client = new Ably.Rest(key);
  await client.channels.get("schedule:tasks").publish("tasks.changed", { tasks, deletedIds });
}

export async function GET() {
  await ensureTable();
  const rows = (await sql`SELECT id, data, version FROM schedule_tasks ORDER BY id`) as StoredRow[];
  return Response.json(rows.map(rowToTask), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  let body: MutationBody;
  try {
    body = (await request.json()) as MutationBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const changes = body.changes ?? [];
  const deletedIds = body.deletedIds ?? [];
  if (!Array.isArray(changes) || !changes.every(isTask) || !Array.isArray(deletedIds) || !deletedIds.every(Number.isSafeInteger)) {
    return Response.json({ error: "Invalid task payload." }, { status: 400 });
  }

  await ensureTable();
  const saved: Task[] = [];
  try {
    for (const task of changes) {
      const previousVersion = task.version ?? 0;
      const data = { ...task };
      delete data.version;
      if (previousVersion === 0) {
        const rows = (await sql`INSERT INTO schedule_tasks (id, data) VALUES (${task.id}, ${JSON.stringify(data)}::jsonb) RETURNING id, data, version`) as StoredRow[];
        saved.push(rowToTask(rows[0]!));
      } else {
        const rows = (await sql`UPDATE schedule_tasks SET data = ${JSON.stringify(data)}::jsonb, version = version + 1, updated_at = NOW() WHERE id = ${task.id} AND version = ${previousVersion} RETURNING id, data, version`) as StoredRow[];
        if (rows.length === 0) return Response.json({ error: "Task was changed by another user." }, { status: 409 });
        saved.push(rowToTask(rows[0]!));
      }
    }
    for (const id of deletedIds) {
      await sql`DELETE FROM schedule_tasks WHERE id = ${id}`;
    }
  } catch (error) {
    if (error instanceof Error && /duplicate key/i.test(error.message)) {
      return Response.json({ error: "Task was changed by another user." }, { status: 409 });
    }
    throw error;
  }

  await publish(saved, deletedIds);
  return Response.json({ tasks: saved, deletedIds });
}
