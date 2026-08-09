import { NextRequest } from "next/server";

import {
  ensureTasksTable,
  getTaskScopeVersion,
  type TaskScope,
} from "@/lib/tasks-repository";
import { ensureBootstrapAdmin, ensureUsersTable } from "@/lib/users-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const VERSION_POLL_INTERVAL_MS = 1500;
const HEARTBEAT_INTERVAL_MS = 15000;

let tasksEventsReadyPromise: Promise<void> | null = null;

async function ensureTasksEventsReady(): Promise<void> {
  if (!tasksEventsReadyPromise) {
    tasksEventsReadyPromise = (async () => {
      await ensureUsersTable();
      await ensureBootstrapAdmin();
      await ensureTasksTable();
    })().catch((error) => {
      tasksEventsReadyPromise = null;
      throw error;
    });
  }

  await tasksEventsReadyPromise;
}

export async function GET(request: NextRequest) {
  try {
    const scope = parseScope(request.nextUrl.searchParams.get("scope"));
    const ownerUserId = scope === "COMPANY"
      ? undefined
      : parsePositiveInt(request.nextUrl.searchParams.get("ownerUserId"), "ownerUserId");
    const actorUserId = parseOptionalPositiveInt(request.nextUrl.searchParams.get("actorUserId"));

    await ensureTasksEventsReady();

    const scopeInput = {
      scope,
      ownerUserId,
      actorUserId: actorUserId ?? ownerUserId ?? 0,
    };

    const encoder = new TextEncoder();
    let closed = false;
    let lastVersion = "";
    let versionTimer: ReturnType<typeof setInterval> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (versionTimer) {
        clearInterval(versionTimer);
        versionTimer = null;
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      streamController?.close();
      streamController = null;
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;

        const sendEvent = (event: string, data: Record<string, unknown>) => {
          if (closed) return;
          controller.enqueue(encoder.encode(`event: ${event}\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        const sendHeartbeat = () => {
          if (closed) return;
          controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
        };

        const pollVersion = async () => {
          if (closed) return;
          try {
            const info = await getTaskScopeVersion(scopeInput);
            if (info.version !== lastVersion) {
              lastVersion = info.version;
              sendEvent("tasks-version", { version: info.version });
            }
          } catch (error) {
            sendEvent("tasks-error", {
              message: toErrorMessage(error, "Could not read task version."),
            });
          }
        };

        void pollVersion();

        versionTimer = setInterval(() => {
          void pollVersion();
        }, VERSION_POLL_INTERVAL_MS);

        heartbeatTimer = setInterval(() => {
          sendHeartbeat();
        }, HEARTBEAT_INTERVAL_MS);

        request.signal.addEventListener("abort", cleanup, { once: true });
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return Response.json({ error: toErrorMessage(error, "Could not open realtime stream") }, { status: 400 });
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
