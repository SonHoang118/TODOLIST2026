import { NextRequest } from "next/server";

import {
  authenticateTempUser,
  ensureBootstrapAdmin,
  ensureUsersTable,
} from "@/lib/users-repository";

export const runtime = "nodejs";

interface LoginRequest {
  userId?: unknown;
  password?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as LoginRequest;
    const parsed = parseLoginPayload(body);

    await ensureUsersTable();
    await ensureBootstrapAdmin();

    const user = await authenticateTempUser(parsed.userId, parsed.password);
    if (!user) {
      return Response.json({ error: "Sai mật khẩu." }, { status: 401 });
    }

    return Response.json({ user }, { status: 200 });
  } catch (error) {
    const message = toErrorMessage(error, "Không thể đăng nhập.");
    const status = message.startsWith("Invalid") ? 400 : 500;
    return Response.json({ error: message }, { status });
  }
}

function parseLoginPayload(body: LoginRequest): { userId: number; password: string } {
  const userId = Number(body.userId);
  if (Number.isNaN(userId) || userId <= 0) {
    throw new Error("Invalid userId.");
  }

  if (typeof body.password !== "string" || body.password.length < 1) {
    throw new Error("Invalid password.");
  }

  return { userId, password: body.password };
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
