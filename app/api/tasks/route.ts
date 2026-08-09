import { NextRequest } from "next/server";

import {
  ensureTasksTable,
  getTaskScopeVersion,
  listTasksByScope,
  replaceTasksForScope,
  type TaskInput,
  type TaskLabel,
  type TaskScope,
  type TaskStatus,
} from "@/lib/tasks-repository";
import { ensureBootstrapAdmin, ensureUsersTable } from "@/lib/users-repository";

export const runtime = "nodejs";

let tasksApiReadyPromise: Promise<void> | null = null;

async function ensureTasksApiReady(): Promise<void> {
  if (!tasksApiReadyPromise) {
    tasksApiReadyPromise = (async () => {
      await ensureUsersTable();
      await ensureBootstrapAdmin();
      await ensureTasksTable();
    })().catch((error) => {
      tasksApiReadyPromise = null;
      throw error;
    });
  }

  await tasksApiReadyPromise;
}

interface ReplaceTasksRequest {
  scope?: unknown;
  ownerUserId?: unknown;
  actorUserId?: unknown;
  tasks?: unknown;
}

interface TaskItemRequest {
  title?: unknown;
  description?: unknown;
  startAt?: unknown;
  endAt?: unknown;
  color?: unknown;
  label?: unknown;
  status?: unknown;
  assignedFromUserId?: unknown;
  createdByUserId?: unknown;
  updatedByUserId?: unknown;
  confirmedByUserIds?: unknown;
}

export async function GET(request: NextRequest) {
  try {
    const scope = parseScope(request.nextUrl.searchParams.get("scope"));
    const ownerUserId = scope === "COMPANY"
      ? undefined
      : parsePositiveInt(request.nextUrl.searchParams.get("ownerUserId"), "ownerUserId");
    const actorUserId = parseOptionalPositiveInt(request.nextUrl.searchParams.get("actorUserId"));

    await ensureTasksApiReady();

    const scopeInput = {
      scope,
      ownerUserId,
      actorUserId: actorUserId ?? ownerUserId ?? 0,
    };

    const [tasks, versionInfo] = await Promise.all([
      listTasksByScope(scopeInput),
      getTaskScopeVersion(scopeInput),
    ]);
    return Response.json({ tasks, version: versionInfo.version }, { status: 200 });
  } catch (error) {
    return Response.json({ error: toErrorMessage(error, "Could not load tasks") }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as ReplaceTasksRequest;
    const scope = parseBodyScope(body.scope);
    const ownerUserId = scope === "COMPANY"
      ? undefined
      : parseBodyUserId(body.ownerUserId, "ownerUserId");
    const actorUserId = parseBodyUserId(body.actorUserId, "actorUserId");
    const tasks = parseTaskList(body.tasks);

    await ensureTasksApiReady();

    const scopeInput = { scope, ownerUserId, actorUserId };

    await replaceTasksForScope(scopeInput, tasks);
    const [saved, versionInfo] = await Promise.all([
      listTasksByScope(scopeInput),
      getTaskScopeVersion(scopeInput),
    ]);

    return Response.json({ tasks: saved, version: versionInfo.version }, { status: 200 });
  } catch (error) {
    return Response.json({ error: toErrorMessage(error, "Could not save tasks") }, { status: 400 });
  }
}

function parseTaskList(value: unknown): TaskInput[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid tasks payload.");
  }
  return value.map(parseTaskItem);
}

function parseTaskItem(value: unknown): TaskInput {
  const item = (value ?? {}) as TaskItemRequest;
  const status = parseStatus(item.status);
  const label = parseLabel(item.label);

  if (typeof item.title !== "string" || item.title.trim().length === 0) {
    throw new Error("Invalid task title.");
  }
  if (typeof item.startAt !== "string" || typeof item.endAt !== "string") {
    throw new Error("Invalid task time range.");
  }

  return {
    title: item.title,
    description: typeof item.description === "string" ? item.description : "",
    startAt: item.startAt,
    endAt: item.endAt,
    color: typeof item.color === "string" && item.color.trim().length > 0 ? item.color : "bg-violet-600",
    label,
    status,
    assignedFromUserId: parseOptionalBodyUserId(item.assignedFromUserId),
    createdByUserId: parseOptionalBodyUserId(item.createdByUserId),
    updatedByUserId: parseOptionalBodyUserId(item.updatedByUserId),
    confirmedByUserIds: parseOptionalNumberList(item.confirmedByUserIds),
  };
}

function parseScope(raw: string | null): TaskScope {
  if (!raw) return "USER";
  return raw === "COMPANY" ? "COMPANY" : "USER";
}

function parseBodyScope(value: unknown): TaskScope {
  return value === "COMPANY" ? "COMPANY" : "USER";
}

function parseStatus(value: unknown): TaskStatus {
  if (value === "PENDING" || value === "IN_PROGRESS" || value === "DONE") {
    return value;
  }
  throw new Error("Invalid task status.");
}

function parseLabel(value: unknown): TaskLabel {
  if (typeof value !== "string") return "DEFAULT";

  const normalized = value.trim().toLowerCase();
  if (normalized === "personal" || normalized === "việc cá nhân" || normalized === "viec ca nhan") {
    return "PERSONAL";
  }

  return "DEFAULT";
}

function parseBodyUserId(value: unknown, fieldName: string): number {
  const id = Number(value);
  if (Number.isNaN(id) || id <= 0) {
    throw new Error(`Invalid ${fieldName}.`);
  }
  return id;
}

function parseOptionalBodyUserId(value: unknown): number | null {
  if (value == null) return null;
  const id = Number(value);
  if (Number.isNaN(id) || id <= 0) {
    return null;
  }
  return id;
}

function parseOptionalNumberList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0);
}

function parsePositiveInt(raw: string | null, fieldName: string): number {
  const parsed = Number(raw);
  if (!raw || Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${fieldName}.`);
  }
  return parsed;
}

function parseOptionalPositiveInt(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error("Invalid actorUserId.");
  }
  return parsed;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
