import { getSql } from "@/lib/neon";

export type TaskStatus = "PENDING" | "IN_PROGRESS" | "DONE";
export type TaskLabel = "DEFAULT" | "PERSONAL";
export type TaskScope = "USER" | "COMPANY";

export interface TaskInput {
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  color: string;
  label: TaskLabel;
  status: TaskStatus;
  assignedFromUserId?: number | null;
  createdByUserId?: number | null;
  updatedByUserId?: number | null;
  confirmedByUserIds?: number[];
}

export interface TaskRecord extends TaskInput {
  id: number;
  scope: TaskScope;
  ownerUserId: number;
  assignedFromUserId: number | null;
  assignedFromName: string | null;
  createdByUserId: number | null;
  createdByName: string | null;
  createdByAvatar: string | null;
  updatedByUserId: number | null;
  updatedByName: string | null;
  updatedByAvatar: string | null;
  confirmedByUserIds: number[];
  createdAt: string;
}

type DbTaskRow = {
  id: number;
  schedule_scope: TaskScope;
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
  created_by_user_id: number | null;
  created_by_name: string | null;
  created_by_avatar: string | null;
  updated_by_user_id: number | null;
  updated_by_name: string | null;
  updated_by_avatar: string | null;
  confirmed_by_user_ids: number[];
  created_at: string;
};

export interface TaskScopeInput {
  scope: TaskScope;
  ownerUserId?: number;
  actorUserId: number;
}

const VALID_STATUS = new Set<TaskStatus>(["PENDING", "IN_PROGRESS", "DONE"]);
const DEFAULT_LABEL: TaskLabel = "DEFAULT";
const PERSONAL_LABEL: TaskLabel = "PERSONAL";

function normalizeTaskLabel(value: unknown): TaskLabel {
  if (typeof value !== "string") return DEFAULT_LABEL;

  const normalized = value.trim().toLowerCase();
  if (normalized === "personal" || normalized === "việc cá nhân" || normalized === "viec ca nhan") {
    return PERSONAL_LABEL;
  }

  return DEFAULT_LABEL;
}

export async function ensureTasksTable(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS schedule_tasks (
      id BIGSERIAL PRIMARY KEY,
      schedule_scope VARCHAR(20) NOT NULL DEFAULT 'USER' CHECK (schedule_scope IN ('USER', 'COMPANY')),
      owner_user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ NOT NULL,
      bg_color TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING', 'IN_PROGRESS', 'DONE')),
      assigned_from_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      confirmed_by_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`ALTER TABLE schedule_tasks ALTER COLUMN owner_user_id DROP NOT NULL`;
  await sql`ALTER TABLE schedule_tasks ADD COLUMN IF NOT EXISTS schedule_scope VARCHAR(20) NOT NULL DEFAULT 'USER'`;
  await sql`ALTER TABLE schedule_tasks ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE schedule_tasks ADD COLUMN IF NOT EXISTS updated_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE schedule_tasks ADD COLUMN IF NOT EXISTS confirmed_by_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb`;
  await sql`
    UPDATE schedule_tasks
    SET schedule_scope = 'USER'
    WHERE schedule_scope IS NULL
  `;
  await sql`
    DO $$
    BEGIN
      BEGIN
        ALTER TABLE schedule_tasks
        ADD CONSTRAINT schedule_tasks_owner_required
        CHECK (
          (schedule_scope = 'COMPANY' AND owner_user_id IS NULL)
          OR (schedule_scope = 'USER' AND owner_user_id IS NOT NULL)
        );
      EXCEPTION
        WHEN duplicate_object THEN
          NULL;
      END;
    END
    $$;
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_schedule_tasks_scope_start
    ON schedule_tasks(schedule_scope, start_at)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_schedule_tasks_user_owner_start
    ON schedule_tasks(schedule_scope, owner_user_id, start_at)
  `;
}

export async function listTasksByScope(params: TaskScopeInput): Promise<TaskRecord[]> {
  const sql = getSql();
  const rows = params.scope === "COMPANY"
    ? await sql`
        SELECT
          t.id,
          t.schedule_scope,
          COALESCE(t.owner_user_id, 0) AS owner_user_id,
          t.title,
          t.description,
          t.start_at,
          t.end_at,
          t.bg_color,
          t.label,
          t.status,
          t.assigned_from_user_id,
          assignee.name AS assigned_from_name,
          t.created_by_user_id,
          creator.name AS created_by_name,
          creator.avatar AS created_by_avatar,
          t.updated_by_user_id,
          editor.name AS updated_by_name,
          editor.avatar AS updated_by_avatar,
          t.confirmed_by_user_ids,
          t.created_at
        FROM schedule_tasks t
        LEFT JOIN users assignee ON assignee.id = t.assigned_from_user_id
        LEFT JOIN users creator ON creator.id = t.created_by_user_id
        LEFT JOIN users editor ON editor.id = t.updated_by_user_id
        WHERE t.schedule_scope = 'COMPANY'
        ORDER BY t.start_at ASC
      `
    : await sql`
        SELECT
          t.id,
          t.schedule_scope,
          t.owner_user_id,
          t.title,
          t.description,
          t.start_at,
          t.end_at,
          t.bg_color,
          t.label,
          t.status,
          t.assigned_from_user_id,
          assignee.name AS assigned_from_name,
          t.created_by_user_id,
          creator.name AS created_by_name,
          creator.avatar AS created_by_avatar,
          t.updated_by_user_id,
          editor.name AS updated_by_name,
          editor.avatar AS updated_by_avatar,
          t.confirmed_by_user_ids,
          t.created_at
        FROM schedule_tasks t
        LEFT JOIN users assignee ON assignee.id = t.assigned_from_user_id
        LEFT JOIN users creator ON creator.id = t.created_by_user_id
        LEFT JOIN users editor ON editor.id = t.updated_by_user_id
        WHERE t.schedule_scope = 'USER'
          AND t.owner_user_id = ${params.ownerUserId ?? 0}
          AND (${params.actorUserId} = ${params.ownerUserId ?? 0} OR UPPER(t.label) <> 'PERSONAL')
        ORDER BY t.start_at ASC
      `;

  return rows.map((row) => toTaskRecord(toDbTaskRow(row)));
}

export async function replaceTasksForScope(
  input: TaskScopeInput,
  tasks: TaskInput[],
): Promise<void> {
  const sql = getSql();

  const isCompanyScope = input.scope === "COMPANY";
  const ownerUserId = input.ownerUserId ?? null;
  const actorUserId = input.actorUserId;
  const assignedFromUserId = !isCompanyScope && ownerUserId !== null && actorUserId === ownerUserId
    ? null
    : actorUserId;
  const canManagePersonal = !isCompanyScope && ownerUserId !== null && actorUserId === ownerUserId;
  const lockKey = isCompanyScope ? 91_000_001 : 92_000_000 + Number(ownerUserId ?? 0);

  await sql`BEGIN`;

  try {
    // Serialize full-replace writes per scope to prevent concurrent delete/insert races.
    await sql`SELECT pg_advisory_xact_lock(${lockKey})`;

    if (isCompanyScope) {
      await sql`DELETE FROM schedule_tasks WHERE schedule_scope = 'COMPANY'`;
    } else if (canManagePersonal) {
      await sql`
        DELETE FROM schedule_tasks
        WHERE schedule_scope = 'USER'
          AND owner_user_id = ${ownerUserId}
      `;
    } else {
      await sql`
        DELETE FROM schedule_tasks
        WHERE schedule_scope = 'USER'
          AND owner_user_id = ${ownerUserId}
          AND UPPER(label) <> 'PERSONAL'
      `;
    }

    for (const task of tasks) {
      validateTaskInput(task);
      const normalizedLabel = canManagePersonal ? task.label : DEFAULT_LABEL;
      const confirmedByUserIds = normalizeConfirmedUserIds(task.confirmedByUserIds);
      const createdByUserId = isCompanyScope ? (task.createdByUserId ?? actorUserId) : null;
      const updatedByUserId = isCompanyScope ? (task.updatedByUserId ?? actorUserId) : null;
      const assignedBy = task.assignedFromUserId ?? assignedFromUserId;
      await sql`
        INSERT INTO schedule_tasks (
          schedule_scope,
          owner_user_id,
          title,
          description,
          start_at,
          end_at,
          bg_color,
          label,
          status,
          assigned_from_user_id,
          created_by_user_id,
          updated_by_user_id,
          confirmed_by_user_ids
        )
        VALUES (
          ${input.scope},
          ${isCompanyScope ? null : ownerUserId},
          ${task.title.trim()},
          ${task.description.trim()},
          ${task.startAt},
          ${task.endAt},
          ${task.color.trim()},
          ${normalizedLabel},
          ${task.status},
          ${assignedBy},
          ${createdByUserId},
          ${updatedByUserId},
          ${JSON.stringify(confirmedByUserIds)}::jsonb
        )
      `;
    }

    await sql`COMMIT`;
  } catch (error) {
    await sql`ROLLBACK`;
    throw error;
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
  if (normalizeTaskLabel(task.label) !== task.label) {
    throw new Error("Invalid task label.");
  }
}

function normalizeConfirmedUserIds(value: number[] | undefined): number[] {
  const raw = Array.isArray(value) ? value : [];
  const unique = new Set<number>(raw);
  return Array.from(unique).filter((id) => Number.isFinite(id) && id > 0);
}

function toDbTaskRow(row: Record<string, unknown>): DbTaskRow {
  const scope = row.schedule_scope;
  if (scope !== "USER" && scope !== "COMPANY") {
    throw new Error("Invalid task scope in database.");
  }

  const status = row.status;
  if (status !== "PENDING" && status !== "IN_PROGRESS" && status !== "DONE") {
    throw new Error("Invalid task status in database.");
  }

  return {
    id: toNumber(row.id),
    schedule_scope: scope,
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
    created_by_user_id: row.created_by_user_id == null ? null : toNumber(row.created_by_user_id),
    created_by_name: row.created_by_name == null ? null : String(row.created_by_name),
    created_by_avatar: row.created_by_avatar == null ? null : String(row.created_by_avatar),
    updated_by_user_id: row.updated_by_user_id == null ? null : toNumber(row.updated_by_user_id),
    updated_by_name: row.updated_by_name == null ? null : String(row.updated_by_name),
    updated_by_avatar: row.updated_by_avatar == null ? null : String(row.updated_by_avatar),
    confirmed_by_user_ids: toNumberArray(row.confirmed_by_user_ids),
    created_at: toIsoString(row.created_at),
  };
}

function toTaskRecord(row: DbTaskRow): TaskRecord {
  return {
    id: row.id,
    scope: row.schedule_scope,
    ownerUserId: row.owner_user_id,
    title: row.title,
    description: row.description,
    startAt: row.start_at,
    endAt: row.end_at,
    color: row.bg_color,
    label: normalizeTaskLabel(row.label),
    status: row.status,
    assignedFromUserId: row.assigned_from_user_id,
    assignedFromName: row.assigned_from_name,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name,
    createdByAvatar: row.created_by_avatar,
    updatedByUserId: row.updated_by_user_id,
    updatedByName: row.updated_by_name,
    updatedByAvatar: row.updated_by_avatar,
    confirmedByUserIds: row.confirmed_by_user_ids,
    createdAt: row.created_at,
  };
}

function toNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item > 0);
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return toNumberArray(parsed);
    } catch {
      return [];
    }
  }

  return [];
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
