import { NextRequest } from "next/server";

import {
  ensureTasksTable,
  listTasksByOwner,
  replaceTasksForOwner,
  type TaskInput,
  type TaskLabel,
  type TaskStatus,
} from "@/lib/tasks-repository";
import { ensureBootstrapAdmin, ensureUsersTable } from "@/lib/users-repository";

export const runtime = "nodejs";

interface ReplaceTasksRequest {
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
}

export async function GET(request: NextRequest) {
  try {
    const ownerUserId = parsePositiveInt(request.nextUrl.searchParams.get("ownerUserId"), "ownerUserId");
    const actorUserId = parseOptionalPositiveInt(request.nextUrl.searchParams.get("actorUserId"));

    await ensureUsersTable();
    await ensureBootstrapAdmin();
    await ensureTasksTable();

    const tasks = await listTasksByOwner(ownerUserId, actorUserId ?? ownerUserId);
    return Response.json({ tasks }, { status: 200 });
  } catch (error) {
    return Response.json({ error: toErrorMessage(error, "Could not load tasks") }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as ReplaceTasksRequest;
    const ownerUserId = parseBodyUserId(body.ownerUserId, "ownerUserId");
    const actorUserId = parseBodyUserId(body.actorUserId, "actorUserId");
    const tasks = parseTaskList(body.tasks);

    await ensureUsersTable();
    await ensureBootstrapAdmin();
    await ensureTasksTable();

    await replaceTasksForOwner(ownerUserId, actorUserId, tasks);
    const saved = await listTasksByOwner(ownerUserId, actorUserId);

    return Response.json({ tasks: saved }, { status: 200 });
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
  };
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
