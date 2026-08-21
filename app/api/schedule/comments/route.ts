import * as Ably from "ably";
import { after } from "next/server";
import { sql } from "../../../lib/database";
import { dispatchDuePushNotifications, queuePushNotification } from "../../../lib/push-notifications";
import type { ScheduleScope, Task, TaskComment } from "../../../schedule/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CommentRow = {
  id: string | number;
  task_id: string | number;
  author_user_id: string | number;
  author_name: string;
  author_avatar: string;
  content: string;
  created_at: string | Date;
};

function parseContext(value: { scope?: unknown; ownerId?: unknown }): { scope: ScheduleScope; ownerId: number | null; scopeKey: string } | null {
  if (value.scope === "COMPANY") return { scope: "COMPANY", ownerId: null, scopeKey: "COMPANY" };
  const ownerId = Number(value.ownerId);
  if (value.scope === "USER" && Number.isSafeInteger(ownerId) && ownerId > 0) return { scope: "USER", ownerId, scopeKey: `USER:${ownerId}` };
  return null;
}

function relatedUserIds(task: Task, context: { scope: ScheduleScope; ownerId: number | null }, authorUserId: number): number[] {
  const ids = context.scope === "COMPANY"
    ? [task.createdByUserId, ...task.confirmedByUserIds]
    : [context.ownerId, task.createdByUserId];
  return [...new Set(ids.filter((id): id is number => Number.isSafeInteger(id) && id !== null && id > 0 && id !== authorUserId))];
}

function commentPreview(content: string): string {
  return content.length > 120 ? `${content.slice(0, 117)}...` : content;
}

function channelName(context: { scope: ScheduleScope; ownerId: number | null }): string {
  return context.scope === "COMPANY" ? "schedule:company" : `schedule:user:${context.ownerId}`;
}

async function publishCommentChange(context: { scope: ScheduleScope; ownerId: number | null }, taskId: number): Promise<void> {
  const key = process.env.ABLY_API_KEY;
  if (!key) return;
  const client = new Ably.Rest(key);
  await client.channels.get(channelName(context)).publish("comments.changed", { taskId });
}

async function ensureTables() {
  await sql`CREATE TABLE IF NOT EXISTS schedule_task_entries (
    scope_key TEXT NOT NULL, id BIGINT NOT NULL, data JSONB NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (scope_key, id)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS schedule_task_comments (
    id BIGSERIAL PRIMARY KEY,
    scope_key TEXT NOT NULL,
    task_id BIGINT NOT NULL,
    author_user_id BIGINT NOT NULL,
    author_name TEXT NOT NULL,
    author_avatar TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (scope_key, task_id) REFERENCES schedule_task_entries(scope_key, id) ON DELETE CASCADE
  )`;
  await sql`CREATE INDEX IF NOT EXISTS schedule_task_comments_task_idx ON schedule_task_comments(scope_key, task_id, created_at DESC)`;
}

function toComment(row: CommentRow): TaskComment {
  return {
    id: Number(row.id),
    taskId: Number(row.task_id),
    authorUserId: Number(row.author_user_id),
    authorName: row.author_name,
    authorAvatar: row.author_avatar,
    content: row.content,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const taskId = Number(params.get("taskId"));
  const context = parseContext({ scope: params.get("scope") as ScheduleScope | null, ownerId: params.get("ownerId") });
  if (!context || !Number.isSafeInteger(taskId) || taskId < 1) return Response.json({ error: "Invalid comment context." }, { status: 400 });
  await ensureTables();
  const rows = await sql`SELECT id, task_id, author_user_id, author_name, author_avatar, content, created_at
    FROM schedule_task_comments WHERE scope_key = ${context.scopeKey} AND task_id = ${taskId}
    ORDER BY created_at DESC, id DESC` as CommentRow[];
  return Response.json(rows.map(toComment), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let body: { scope?: ScheduleScope; ownerId?: number | null; taskId?: number; authorUserId?: number; content?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const context = parseContext(body);
  const content = body.content?.trim() ?? "";
  if (!context || !Number.isSafeInteger(body.taskId) || body.taskId! < 1 || !Number.isSafeInteger(body.authorUserId) || body.authorUserId! < 1 || !content || content.length > 2000) {
    return Response.json({ error: "Invalid comment payload." }, { status: 400 });
  }
  await ensureTables();
  const users = await sql`SELECT name, avatar FROM schedule_users WHERE id = ${body.authorUserId} LIMIT 1` as Array<{ name: string; avatar: string }>;
  if (!users[0]) return Response.json({ error: "User not found." }, { status: 404 });
  const tasks = await sql`SELECT id, data FROM schedule_task_entries WHERE scope_key = ${context.scopeKey} AND id = ${body.taskId} LIMIT 1` as Array<{ id: string | number; data: Task | string }>;
  if (!tasks[0]) return Response.json({ error: "Task not found." }, { status: 404 });
  const task = typeof tasks[0].data === "string" ? JSON.parse(tasks[0].data) as Task : tasks[0].data;
  const rows = await sql`INSERT INTO schedule_task_comments (scope_key, task_id, author_user_id, author_name, author_avatar, content)
    VALUES (${context.scopeKey}, ${body.taskId}, ${body.authorUserId}, ${users[0].name}, ${users[0].avatar}, ${content})
    RETURNING id, task_id, author_user_id, author_name, author_avatar, content, created_at` as CommentRow[];
  try {
    await publishCommentChange(context, body.taskId!);
  } catch (error) {
    console.error("Unable to publish comment change.", error);
  }
  const recipients = relatedUserIds(task, context, body.authorUserId!);
  if (recipients.length > 0) {
    const title = `Tin nhắn mới trong: ${task.title}`;
    const notificationBody = `${users[0].name}: ${commentPreview(content)}`;
    await Promise.all(recipients.map((recipientUserId) => queuePushNotification(recipientUserId, {
      title,
      body: notificationBody,
      url: "/schedule",
      kind: "COMMENTED",
      actorName: users[0].name,
      taskId: body.taskId!,
      taskScope: context.scope,
      taskOwnerUserId: context.ownerId,
    }, 0)));
    after(async () => {
      try {
        await dispatchDuePushNotifications();
      } catch (error) {
        console.error("Unable to dispatch comment push notification after the response.", error);
      }
    });
  }
  return Response.json(toComment(rows[0]!), { status: 201 });
}

export async function DELETE(request: Request) {
  let body: { scope?: ScheduleScope; ownerId?: number | null; taskId?: number; commentId?: number; authorUserId?: number };
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const context = parseContext(body);
  if (!context || !Number.isSafeInteger(body.taskId) || body.taskId! < 1 || !Number.isSafeInteger(body.commentId) || body.commentId! < 1 || !Number.isSafeInteger(body.authorUserId) || body.authorUserId! < 1) {
    return Response.json({ error: "Invalid comment payload." }, { status: 400 });
  }
  await ensureTables();
  const deleted = await sql`DELETE FROM schedule_task_comments
    WHERE id = ${body.commentId} AND scope_key = ${context.scopeKey} AND task_id = ${body.taskId} AND author_user_id = ${body.authorUserId}
    RETURNING id` as Array<{ id: string | number }>;
  if (!deleted[0]) return Response.json({ error: "Comment not found or cannot be deleted." }, { status: 404 });
  try {
    await publishCommentChange(context, body.taskId!);
  } catch (error) {
    console.error("Unable to publish comment deletion.", error);
  }
  return Response.json({ deletedId: Number(deleted[0].id) });
}
