import { sql } from "../../lib/database";
import type { AppNotification, NotificationKind } from "../../schedule/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NotificationRow = {
  id: string | number; recipient_user_id: string | number; kind: string; title: string; body: string;
  actorName: string | null; taskId: string | number | null; taskScope: "USER" | "COMPANY" | null; taskOwnerUserId: string | number | null; is_read: boolean; createdAt: string;
};

async function ensureTable(): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS schedule_notifications (
    id BIGSERIAL PRIMARY KEY,
    recipient_user_id BIGINT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    actor_name TEXT,
    task_id BIGINT,
    task_scope TEXT,
    task_owner_user_id BIGINT,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`ALTER TABLE schedule_notifications ADD COLUMN IF NOT EXISTS task_scope TEXT`;
  await sql`ALTER TABLE schedule_notifications ADD COLUMN IF NOT EXISTS task_owner_user_id BIGINT`;
}

function toNotification(row: NotificationRow): AppNotification {
  return {
    id: Number(row.id), recipientUserId: Number(row.recipient_user_id), kind: row.kind as NotificationKind,
    title: row.title, body: row.body, actorName: row.actorName, taskId: row.taskId === null ? null : Number(row.taskId),
    taskScope: row.taskScope, taskOwnerUserId: row.taskOwnerUserId === null ? null : Number(row.taskOwnerUserId),
    isRead: row.is_read, createdAt: row.createdAt,
  };
}

export async function GET(request: Request) {
  const userId = Number(new URL(request.url).searchParams.get("userId"));
  if (!Number.isSafeInteger(userId) || userId < 1) return Response.json({ error: "A valid user is required." }, { status: 400 });
  await ensureTable();
  const rows = await sql`SELECT id, recipient_user_id, kind, title, body, actor_name AS "actorName", task_id AS "taskId", task_scope AS "taskScope", task_owner_user_id AS "taskOwnerUserId", is_read, created_at AS "createdAt"
    FROM schedule_notifications WHERE recipient_user_id = ${userId} ORDER BY created_at DESC LIMIT 100` as NotificationRow[];
  return Response.json(rows.map(toNotification), { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  let body: { userId?: number; ids?: number[]; all?: boolean };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "Invalid JSON body." }, { status: 400 }); }
  if (!Number.isSafeInteger(body.userId) || body.userId! < 1 || (!body.all && (!Array.isArray(body.ids) || !body.ids.every(Number.isSafeInteger)))) {
    return Response.json({ error: "Invalid notification payload." }, { status: 400 });
  }
  await ensureTable();
  if (body.all) await sql`UPDATE schedule_notifications SET is_read = TRUE WHERE recipient_user_id = ${body.userId}`;
  else for (const id of body.ids ?? []) await sql`UPDATE schedule_notifications SET is_read = TRUE WHERE recipient_user_id = ${body.userId} AND id = ${id}`;
  return Response.json({ ok: true });
}
