import { compare, hash } from "bcryptjs";

import { getSql } from "@/lib/neon";

export type UserRole = "ADMIN" | "STAFF";

export interface CreateUserInput {
  role: UserRole;
  name: string;
  avatar: string;
  password: string;
}

export interface PublicUser {
  id: number;
  role: UserRole;
  name: string;
  avatar: string;
  createdAt: string;
}

type DbPublicUser = {
  id: number;
  role: UserRole;
  name: string;
  avatar: string;
  created_at: string;
};

type DbAuthUser = DbPublicUser & {
  password: string;
};

const DEFAULT_ADMIN = {
  role: "ADMIN" as const,
  name: "Ng\u00f4 Th\u1ebf Hi\u1ebfu",
  avatar: "",
  password: "123456",
};

const VALID_ROLES = new Set<UserRole>(["ADMIN", "STAFF"]);

export async function ensureUsersTable(): Promise<void> {
  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      role VARCHAR(10) NOT NULL CHECK (role IN ('ADMIN', 'STAFF')),
      name TEXT NOT NULL,
      avatar TEXT NOT NULL,
      password TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function ensureBootstrapAdmin(): Promise<void> {
  const sql = getSql();

  const existing = await sql`
    SELECT id
    FROM users
    WHERE role = 'ADMIN'
    LIMIT 1
  `;

  if (existing.length > 0) {
    return;
  }

  const passwordHash = await hash(DEFAULT_ADMIN.password, 10);
  await sql`
    INSERT INTO users (role, name, avatar, password)
    VALUES (${DEFAULT_ADMIN.role}, ${DEFAULT_ADMIN.name}, ${DEFAULT_ADMIN.avatar}, ${passwordHash})
  `;
}

export async function createTempUser(input: CreateUserInput): Promise<PublicUser> {
  const sql = getSql();

  if (!VALID_ROLES.has(input.role)) {
    throw new Error("Invalid role. Use ADMIN or STAFF.");
  }

  const passwordHash = await hash(input.password, 10);

  const rows = await sql`
    INSERT INTO users (role, name, avatar, password)
    VALUES (${input.role}, ${input.name}, ${input.avatar}, ${passwordHash})
    RETURNING id, role, name, avatar, created_at
  `;

  const created = rows[0];
  if (!created) {
    throw new Error("Could not create user.");
  }

  return mapPublicUser(toDbPublicUser(created));
}

export async function listTempUsers(): Promise<PublicUser[]> {
  const sql = getSql();

  const rows = await sql`
    SELECT id, role, name, avatar, created_at
    FROM users
    ORDER BY CASE WHEN role = 'ADMIN' THEN 0 ELSE 1 END, created_at ASC
  `;

  return rows.map((row) => mapPublicUser(toDbPublicUser(row)));
}

export async function authenticateTempUser(userId: number, password: string): Promise<PublicUser | null> {
  const sql = getSql();

  const rows = await sql`
    SELECT id, role, name, avatar, password, created_at
    FROM users
    WHERE id = ${userId}
    LIMIT 1
  `;

  const rawUser = rows[0];
  if (!rawUser) {
    return null;
  }

  const user = toDbAuthUser(rawUser);
  if (!user) {
    return null;
  }

  const ok = await compare(password, user.password);
  if (!ok) {
    return null;
  }

  return mapPublicUser(user);
}

export async function assertAdminUser(userId: number): Promise<void> {
  const sql = getSql();

  const rows = await sql`
    SELECT id
    FROM users
    WHERE id = ${userId} AND role = 'ADMIN'
    LIMIT 1
  `;

  if (rows.length === 0) {
    throw new Error("Forbidden. Only ADMIN can create users.");
  }
}

export async function updateUserAvatar(userId: number, avatar: string): Promise<PublicUser> {
  const sql = getSql();

  const rows = await sql`
    UPDATE users
    SET avatar = ${avatar}
    WHERE id = ${userId}
    RETURNING id, role, name, avatar, created_at
  `;

  const updated = rows[0];
  if (!updated) {
    throw new Error("User not found.");
  }

  return mapPublicUser(toDbPublicUser(updated));
}

function mapPublicUser(user: DbPublicUser): PublicUser {
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    avatar: user.avatar,
    createdAt: user.created_at,
  };
}

function toDbPublicUser(row: Record<string, unknown>): DbPublicUser {
  const role = row.role;
  if (role !== "ADMIN" && role !== "STAFF") {
    throw new Error("Invalid user role in database.");
  }

  return {
    id: toNumber(row.id),
    role,
    name: String(row.name ?? ""),
    avatar: String(row.avatar ?? ""),
    created_at: toIsoString(row.created_at),
  };
}

function toDbAuthUser(row: Record<string, unknown>): DbAuthUser | null {
  if (typeof row.password !== "string") {
    return null;
  }

  return {
    ...toDbPublicUser(row),
    password: row.password,
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
