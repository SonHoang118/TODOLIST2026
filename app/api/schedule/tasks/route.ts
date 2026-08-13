import * as Ably from "ably";
import { sql } from "../../../lib/database";
import { queuePushNotification } from "../../../lib/push-notifications";
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
  await sql`CREATE TABLE IF NOT EXISTS schedule_notifications (
    id BIGSERIAL PRIMARY KEY, recipient_user_id BIGINT NOT NULL, kind TEXT NOT NULL,
    title TEXT NOT NULL, body TEXT NOT NULL, actor_name TEXT, task_id BIGINT,
    task_scope TEXT, task_owner_user_id BIGINT,
    is_read BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`ALTER TABLE schedule_notifications ADD COLUMN IF NOT EXISTS task_scope TEXT`;
  await sql`ALTER TABLE schedule_notifications ADD COLUMN IF NOT EXISTS task_owner_user_id BIGINT`;
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

async function notify(recipientUserId: number | null, kind: string, title: string, body: string, actorName: string | null, taskId: number, taskScope: ScheduleScope, taskOwnerUserId: number | null): Promise<void> {
  if (!recipientUserId || recipientUserId < 1) return;
  await queuePushNotification(recipientUserId, { title, body, url: "/schedule", kind, actorName, taskId, taskScope, taskOwnerUserId });
}

async function userIdByName(name: string | null): Promise<number | null> {
  if (!name) return null;
  const rows = await sql`SELECT id FROM schedule_users WHERE name = ${name} LIMIT 1` as Array<{ id: string | number }>;
  return rows[0] ? Number(rows[0].id) : null;
}

async function createNotifications(context: { scope: ScheduleScope; ownerId: number | null }, task: Task, previous: Task | null): Promise<void> {
  const actorName = task.updatedByName ?? task.createdByName;
  if (!previous && context.scope === "USER" && context.ownerId !== task.createdByUserId && task.assignedFromName) {
    await notify(context.ownerId, "ASSIGNED", "Bạn có công việc mới", `${task.createdByName ?? "Một đồng nghiệp"} đã giao cho bạn: ${task.title}`, task.createdByName, task.id, context.scope, context.ownerId);
    return;
  }
  if (!previous && context.scope === "COMPANY") {
    const users = await sql`SELECT id FROM schedule_users WHERE id <> ${task.createdByUserId ?? -1}` as Array<{ id: string | number }>;
    await Promise.all(users.map((user) => notify(Number(user.id), "COMPANY_CREATED", "Task mới trên lịch công ty", `${task.createdByName ?? "Một đồng nghiệp"} đã tạo: ${task.title}`, task.createdByName, task.id, context.scope, null)));
    return;
  }
  if (context.scope === "USER" && previous?.status === "PENDING" && task.status === "IN_PROGRESS") {
    await notify(await userIdByName(task.assignedFromName), "ACCEPTED", "Công việc đã được tiếp nhận", `${actorName ?? "Người được giao"} đã chấp nhận: ${task.title}`, actorName, task.id, context.scope, context.ownerId);
  }
  if (context.scope === "USER" && previous?.status !== "DONE" && task.status === "DONE") {
    await notify(await userIdByName(task.assignedFromName), "COMPLETED", "Công việc đã hoàn thành", `${actorName ?? "Người được giao"} đã hoàn thành: ${task.title}`, actorName, task.id, context.scope, context.ownerId);
  }
  if (context.scope === "COMPANY") {
    const newlyConfirmedBy = task.confirmedByUserIds.find((id) => !previous?.confirmedByUserIds.includes(id));
    if (newlyConfirmedBy && newlyConfirmedBy !== task.createdByUserId) {
      const users = await sql`SELECT name FROM schedule_users WHERE id = ${newlyConfirmedBy} LIMIT 1` as Array<{ name: string }>;
      const confirmerName = users[0]?.name ?? "Một đồng nghiệp";
      await notify(task.createdByUserId, "COMPANY_CONFIRMED", "Task lịch công ty đã được xác nhận", `${confirmerName} đã xác nhận: ${task.title}`, confirmerName, task.id, context.scope, null);
    }
  }
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
      const previousRows = previousVersion > 0
        ? await sql`SELECT id, data, version FROM schedule_task_entries WHERE scope_key = ${context.scopeKey} AND id = ${task.id} LIMIT 1` as StoredRow[]
        : [];
      const previous = previousRows[0] ? rowToTask(previousRows[0]) : null;
      const data = { ...task };
      delete data.version;
      if (previousVersion === 0) {
        const rows = (await sql`INSERT INTO schedule_task_entries (scope_key, id, data) VALUES (${context.scopeKey}, ${task.id}, ${JSON.stringify(data)}::jsonb) RETURNING id, data, version`) as StoredRow[];
        const savedTask = rowToTask(rows[0]!);
        saved.push(savedTask);
        await createNotifications(context, savedTask, previous);
      } else {
        const rows = (await sql`UPDATE schedule_task_entries SET data = ${JSON.stringify(data)}::jsonb, version = version + 1, updated_at = NOW() WHERE scope_key = ${context.scopeKey} AND id = ${task.id} AND version = ${previousVersion} RETURNING id, data, version`) as StoredRow[];
        if (rows.length === 0) return Response.json({ error: "Task was changed by another user." }, { status: 409 });
        const savedTask = rowToTask(rows[0]!);
        saved.push(savedTask);
        await createNotifications(context, savedTask, previous);
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
