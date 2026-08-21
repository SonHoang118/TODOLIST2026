import * as Ably from "ably";
import { sql } from "../../lib/database";
import type { SessionUser } from "../../schedule/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UserRow = { id: string | number; name: string; role: "ADMIN" | "STAFF"; avatar: string };

let usersTableReady: Promise<void> | null = null;

async function setupUsersTable(): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS schedule_users (
    id BIGINT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('ADMIN', 'STAFF')),
    avatar TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`INSERT INTO schedule_users (id, name, role) VALUES
    (1, 'Ngô Thế Hiếu', 'ADMIN'),
    (2, 'Nhân viên A', 'STAFF'),
    (3, 'Nhân viên B', 'STAFF')
    ON CONFLICT (id) DO NOTHING`;
}

async function ensureUsersTable(): Promise<void> {
  usersTableReady ??= setupUsersTable().catch((error) => { usersTableReady = null; throw error; });
  await usersTableReady;
}

function toUser(row: UserRow): SessionUser {
  return { id: Number(row.id), name: row.name, role: row.role, avatar: row.avatar };
}

async function publishUsersChanged(): Promise<void> {
  const key = process.env.ABLY_API_KEY;
  if (!key) return;
  await new Ably.Rest(key).channels.get("users").publish("users.changed", {});
}

export async function GET() {
  await ensureUsersTable();
  const rows = (await sql`SELECT id, name, role, avatar FROM schedule_users ORDER BY id`) as UserRow[];
  return Response.json(rows.map(toUser), { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  let body: { id?: number; name?: string; avatar?: string };
  try {
    body = (await request.json()) as { id?: number; name?: string; avatar?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!Number.isSafeInteger(body.id) || body.id! < 1 || (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim())) || (body.avatar !== undefined && typeof body.avatar !== "string")) {
    return Response.json({ error: "Invalid user payload." }, { status: 400 });
  }
  await ensureUsersTable();
  const rows = (await sql`UPDATE schedule_users SET
    name = COALESCE(${body.name?.trim() ?? null}, name),
    avatar = COALESCE(${body.avatar ?? null}, avatar),
    updated_at = NOW()
    WHERE id = ${body.id} RETURNING id, name, role, avatar`) as UserRow[];
  if (!rows[0]) return Response.json({ error: "User not found." }, { status: 404 });
  await publishUsersChanged();
  return Response.json(toUser(rows[0]));
}
