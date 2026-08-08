import { NextRequest } from "next/server";

import {
  assertAdminUser,
  createTempUser,
  ensureBootstrapAdmin,
  ensureUsersTable,
  listTempUsers,
  type UserRole,
} from "@/lib/users-repository";

export const runtime = "nodejs";

interface CreateUserRequest {
  role?: unknown;
  name?: unknown;
  avatar?: unknown;
  password?: unknown;
}

export async function GET() {
  try {
    await ensureUsersTable();
    await ensureBootstrapAdmin();
    const users = await listTempUsers();
    return Response.json({ users }, { status: 200 });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Could not load users") },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const actorId = parseActorUserId(request.headers.get("x-actor-user-id"));
    const body = (await request.json()) as CreateUserRequest;
    const parsed = parseCreateUserPayload(body);

    await ensureUsersTable();
    await ensureBootstrapAdmin();
    await assertAdminUser(actorId);
    const user = await createTempUser(parsed);

    return Response.json({ user }, { status: 201 });
  } catch (error) {
    const message = toErrorMessage(error, "Could not create user");
    const status =
      message.startsWith("Invalid") ? 400
      : message.startsWith("Forbidden") ? 403
      : 500;

    return Response.json({ error: message }, { status });
  }
}

function parseActorUserId(raw: string | null): number {
  const actorId = Number(raw);
  if (!raw || Number.isNaN(actorId) || actorId <= 0) {
    throw new Error("Invalid actor id. x-actor-user-id is required.");
  }
  return actorId;
}

function parseCreateUserPayload(body: CreateUserRequest): {
  role: UserRole;
  name: string;
  avatar: string;
  password: string;
} {
  if (body.role !== "ADMIN" && body.role !== "STAFF") {
    throw new Error("Invalid role. Use ADMIN or STAFF.");
  }

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    throw new Error("Invalid name. Name is required.");
  }

  if (typeof body.avatar !== "string" || body.avatar.trim().length === 0) {
    throw new Error("Invalid avatar. Avatar is required.");
  }

  if (typeof body.password !== "string" || body.password.length < 6) {
    throw new Error("Invalid password. Password must be at least 6 characters.");
  }

  return {
    role: body.role,
    name: body.name.trim(),
    avatar: body.avatar.trim(),
    password: body.password,
  };
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
