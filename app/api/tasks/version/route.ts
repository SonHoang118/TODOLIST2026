import { NextRequest } from "next/server";

import {
  ensureTasksTable,
  getTaskScopeVersion,
  type TaskScope,
} from "@/lib/tasks-repository";
import { ensureBootstrapAdmin, ensureUsersTable } from "@/lib/users-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let tasksVersionReadyPromise: Promise<void> | null = null;

async function ensureTasksVersionReady(): Promise<void> {
  if (!tasksVersionReadyPromise) {
    tasksVersionReadyPromise = (async () => {
      await ensureUsersTable();
      await ensureBootstrapAdmin();
      await ensureTasksTable();
    })().catch((error) => {
      tasksVersionReadyPromise = null;
      throw error;
    });
  }

  await tasksVersionReadyPromise;
}

export async function GET(request: NextRequest) {
  try {
    const scope = parseScope(request.nextUrl.searchParams.get("scope"));
    const ownerUserId = scope === "COMPANY"
      ? undefined
      : parsePositiveInt(request.nextUrl.searchParams.get("ownerUserId"), "ownerUserId");
    const actorUserId = parseOptionalPositiveInt(request.nextUrl.searchParams.get("actorUserId"));

    await ensureTasksVersionReady();

    const versionInfo = await getTaskScopeVersion({
      scope,
      ownerUserId,
      actorUserId: actorUserId ?? ownerUserId ?? 0,
    });

    return Response.json({ version: versionInfo.version }, { status: 200 });
  } catch (error) {
    return Response.json({ error: toErrorMessage(error, "Could not load task version") }, { status: 400 });
  }
}

function parseScope(raw: string | null): TaskScope {
  if (!raw) return "USER";
  return raw === "COMPANY" ? "COMPANY" : "USER";
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
