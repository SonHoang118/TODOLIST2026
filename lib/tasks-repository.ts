import { getSql } from "@/lib/neon";

export type TaskStatus = "PENDING" | "IN_PROGRESS" | "DONE";

export interface TaskInput {
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  color: string;
  label: string;
  status: TaskStatus;
}

export interface TaskRecord extends TaskInput {
  id: number;
  ownerUserId: number;
  assignedFromUserId: number | null;
  assignedFromName: string | null;
  createdAt: string;
}

type DbTaskRow = {
  id: number;
  owner_user_id: number;
  title: string;
  description: string;
  start_at: string;
  end_at: string;
  bg_color: string;
  label: string;
  status: TaskStatus;
  assigned_from_user_id: number | null;
  assigned_from_name: string | null;
  created_at: string;
};

const VALID_STATUS = new Set<TaskStatus>(["PENDING", "IN_PROGRESS", "DONE"]);

export async function ensureTasksTable(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS schedule_tasks (
      id BIGSERIAL PRIMARY KEY,
      owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ NOT NULL,
      bg_color TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING', 'IN_PROGRESS', 'DONE')),
      assigned_from_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function listTasksByOwner(ownerUserId: number): Promise<TaskRecord[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT
      t.id,
      t.owner_user_id,
      t.title,
      t.description,
      t.start_at,
      t.end_at,
      t.bg_color,
      t.label,
      t.status,
      t.assigned_from_user_id,
      u.name AS assigned_from_name,
      t.created_at
    FROM schedule_tasks t
    LEFT JOIN users u ON u.id = t.assigned_from_user_id
    WHERE t.owner_user_id = ${ownerUserId}
    ORDER BY t.start_at ASC
  `;

  return rows.map((row) => toTaskRecord(toDbTaskRow(row)));
}

export async function replaceTasksForOwner(
  ownerUserId: number,
  actorUserId: number,
  tasks: TaskInput[],
): Promise<void> {
  const sql = getSql();

  await sql`DELETE FROM schedule_tasks WHERE owner_user_id = ${ownerUserId}`;

  const assignedFromUserId = actorUserId === ownerUserId ? null : actorUserId;

  for (const task of tasks) {
    validateTaskInput(task);
    await sql`
      INSERT INTO schedule_tasks (
        owner_user_id,
        title,
        description,
        start_at,
        end_at,
        bg_color,
        label,
        status,
        assigned_from_user_id
      )
      VALUES (
        ${ownerUserId},
        ${task.title.trim()},
        ${task.description.trim()},
        ${task.startAt},
        ${task.endAt},
        ${task.color.trim()},
        ${task.label.trim()},
        ${task.status},
        ${assignedFromUserId}
      )
    `;
  }
}

function validateTaskInput(task: TaskInput): void {
  if (!task.title || task.title.trim().length === 0) {
    throw new Error("Invalid task title.");
  }
  if (!task.startAt || !task.endAt) {
    throw new Error("Invalid task time range.");
  }
  if (!VALID_STATUS.has(task.status)) {
    throw new Error("Invalid task status.");
  }
}

function toDbTaskRow(row: Record<string, unknown>): DbTaskRow {
  const status = row.status;
  if (status !== "PENDING" && status !== "IN_PROGRESS" && status !== "DONE") {
    throw new Error("Invalid task status in database.");
  }

  return {
    id: toNumber(row.id),
    owner_user_id: toNumber(row.owner_user_id),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    start_at: toIsoString(row.start_at),
    end_at: toIsoString(row.end_at),
    bg_color: String(row.bg_color ?? ""),
    label: String(row.label ?? ""),
    status,
    assigned_from_user_id: row.assigned_from_user_id == null ? null : toNumber(row.assigned_from_user_id),
    assigned_from_name: row.assigned_from_name == null ? null : String(row.assigned_from_name),
    created_at: toIsoString(row.created_at),
  };
}

function toTaskRecord(row: DbTaskRow): TaskRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    title: row.title,
    description: row.description,
    startAt: row.start_at,
    endAt: row.end_at,
    color: row.bg_color,
    label: row.label,
    status: row.status,
    assignedFromUserId: row.assigned_from_user_id,
    assignedFromName: row.assigned_from_name,
    createdAt: row.created_at,
  };
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error("Invalid numeric value in database.");
  }
  return parsed;
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    return value;
  }
  return String(value ?? "");
}
