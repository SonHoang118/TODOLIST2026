"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type UserRole = "ADMIN" | "STAFF";

interface PublicUser {
  id: number;
  role: UserRole;
  name: string;
  avatar: string;
  createdAt: string;
}

const STORAGE_KEY = "todo2026.currentUser";

export default function Home() {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [currentUser, setCurrentUser] = useState<PublicUser | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [newRole, setNewRole] = useState<UserRole>("STAFF");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newAvatarFile, setNewAvatarFile] = useState<File | null>(null);

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) ?? null,
    [users, selectedUserId],
  );

  useEffect(() => {
    void loadUsers();
  }, []);

  async function loadUsers() {
    setLoadingUsers(true);
    setLoginError(null);
    try {
      const response = await fetch("/api/users", { cache: "no-store" });
      const data = (await response.json()) as { users?: PublicUser[]; error?: string };

      if (!response.ok || !Array.isArray(data.users)) {
        throw new Error(data.error ?? "Không thể tải danh sách user.");
      }

      const fetchedUsers = data.users;

      setUsers(fetchedUsers);
      setSelectedUserId((prev) => prev ?? fetchedUsers[0]?.id ?? null);

      const rawStored = localStorage.getItem(STORAGE_KEY);
      if (rawStored) {
        const parsed = JSON.parse(rawStored) as { id?: number };
        if (typeof parsed.id === "number") {
          const matched = fetchedUsers.find((u) => u.id === parsed.id) ?? null;
          setCurrentUser(matched);
        }
      }
    } catch (error) {
      setLoginError(toErrorMessage(error, "Không thể tải danh sách user."));
    } finally {
      setLoadingUsers(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUserId) {
      setLoginError("Vui lòng chọn user.");
      return;
    }

    setBusy(true);
    setLoginError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUserId, password }),
      });
      const data = (await response.json()) as { user?: PublicUser; error?: string };
      if (!response.ok || !data.user) {
        throw new Error(data.error ?? "Đăng nhập thất bại.");
      }

      setCurrentUser(data.user);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: data.user.id }));
      setPassword("");
      setMessage(`Xin chào ${data.user.name}`);
    } catch (error) {
      setLoginError(toErrorMessage(error, "Đăng nhập thất bại."));
    } finally {
      setBusy(false);
    }
  }

  function handleLogout() {
    setCurrentUser(null);
    localStorage.removeItem(STORAGE_KEY);
    setSettingsOpen(false);
    setMessage("Đã đăng xuất.");
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentUser || currentUser.role !== "ADMIN") {
      return;
    }
    if (!newAvatarFile) {
      setMessage("Vui lòng chọn avatar để upload lên Cloudinary.");
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const avatarUrl = await uploadAvatarToCloudinary(newAvatarFile);

      const response = await fetch("/api/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-actor-user-id": String(currentUser.id),
        },
        body: JSON.stringify({
          role: newRole,
          name: newName,
          avatar: avatarUrl,
          password: newPassword,
        }),
      });

      const data = (await response.json()) as { user?: PublicUser; error?: string };
      if (!response.ok || !data.user) {
        throw new Error(data.error ?? "Không thể tạo user.");
      }

      setNewName("");
      setNewPassword("");
      setNewAvatarFile(null);
      setNewRole("STAFF");
      setMessage(`Đã tạo ${data.user.role}: ${data.user.name}`);
      await loadUsers();
    } catch (error) {
      setMessage(toErrorMessage(error, "Không thể tạo user."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
        <header className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-5">
          <h1 className="text-2xl font-bold tracking-tight">TodoList 2026</h1>
          <p className="mt-1 text-sm text-zinc-400">Đăng nhập để vào lịch làm việc.</p>
        </header>

        {message && (
          <div className="rounded-2xl border border-emerald-700/40 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-300">
            {message}
          </div>
        )}

        {!currentUser ? (
          <section className="grid gap-5 rounded-3xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h2 className="text-lg font-semibold">Chọn người dùng</h2>

            {loadingUsers ? (
              <p className="text-sm text-zinc-500">Đang tải...</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {users.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => setSelectedUserId(user.id)}
                    className={[
                      "flex items-center gap-3 rounded-2xl border px-3 py-3 text-left transition",
                      selectedUserId === user.id
                        ? "border-violet-500 bg-violet-500/10"
                        : "border-zinc-800 bg-zinc-900 hover:border-zinc-700",
                    ].join(" ")}
                  >
                    <Avatar user={user} />
                    <div>
                      <p className="text-sm font-medium text-zinc-100">{user.name}</p>
                      <p className="text-xs text-zinc-400">{user.role}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <form onSubmit={handleLogin} className="grid gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
              <p className="text-sm text-zinc-300">
                Đăng nhập: <span className="font-semibold text-zinc-100">{selectedUser?.name ?? "Chưa chọn"}</span>
              </p>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Nhập mật khẩu"
                className="h-11 rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm outline-none ring-violet-500 placeholder:text-zinc-500 focus:ring-2"
                required
              />
              {loginError && <p className="text-sm text-rose-400">{loginError}</p>}
              <button
                disabled={busy || !selectedUserId}
                className="h-11 rounded-xl bg-violet-600 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                type="submit"
              >
                {busy ? "Đang đăng nhập..." : "Đăng nhập"}
              </button>
            </form>
          </section>
        ) : (
          <section className="grid gap-5">
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Avatar user={currentUser} />
                  <div>
                    <p className="text-base font-semibold">{currentUser.name}</p>
                    <p className="text-xs text-zinc-400">{currentUser.role}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {currentUser.role === "ADMIN" && (
                    <button
                      onClick={() => setSettingsOpen((v) => !v)}
                      className="h-10 rounded-xl border border-zinc-700 px-4 text-sm font-medium text-zinc-200"
                      type="button"
                    >
                      Cài đặt
                    </button>
                  )}
                  <button
                    onClick={handleLogout}
                    className="h-10 rounded-xl border border-zinc-700 px-4 text-sm font-medium text-zinc-200"
                    type="button"
                  >
                    Đăng xuất
                  </button>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <a href="/schedule" className="flex h-14 items-center justify-center rounded-2xl bg-violet-600 text-sm font-semibold text-white">
                📅 Lịch tuần
              </a>
              <a href="/grid" className="flex h-14 items-center justify-center rounded-2xl bg-zinc-800 text-sm font-semibold text-zinc-200">
                🟪 Grid debug
              </a>
              <a href="/debug" className="flex h-14 items-center justify-center rounded-2xl bg-zinc-800 text-sm font-semibold text-zinc-300">
                🛠 Gesture debug
              </a>
            </div>

            {settingsOpen && currentUser.role === "ADMIN" && (
              <section className="grid gap-4 rounded-3xl border border-zinc-800 bg-zinc-900/60 p-5 lg:grid-cols-[260px_1fr]">
                <aside className="rounded-2xl border border-zinc-700 bg-zinc-950/60 p-4">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Setting Sidebar</p>
                  <div className="mt-3 flex items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900/70 px-3 py-3">
                    <Avatar user={currentUser} />
                    <div>
                      <p className="text-xs text-zinc-400">Tài khoản đang dùng</p>
                      <p className="text-sm font-semibold text-zinc-100">{currentUser.name}</p>
                      <p className="text-xs text-zinc-400">{currentUser.role} · ID {currentUser.id}</p>
                    </div>
                  </div>
                </aside>

                <form onSubmit={handleCreateUser} className="grid gap-3">
                  <h3 className="text-base font-semibold">Tạo user mới</h3>

                  <label className="grid gap-1 text-sm">
                    <span className="text-zinc-300">Role</span>
                    <select
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value as UserRole)}
                      className="h-10 rounded-xl border border-zinc-700 bg-zinc-900 px-3"
                    >
                      <option value="STAFF">STAFF</option>
                      <option value="ADMIN">ADMIN</option>
                    </select>
                  </label>

                  <label className="grid gap-1 text-sm">
                    <span className="text-zinc-300">Tên</span>
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="h-10 rounded-xl border border-zinc-700 bg-zinc-900 px-3"
                      required
                    />
                  </label>

                  <label className="grid gap-1 text-sm">
                    <span className="text-zinc-300">Avatar (upload Cloudinary)</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setNewAvatarFile(e.target.files?.[0] ?? null)}
                      className="block w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
                      required
                    />
                  </label>

                  <label className="grid gap-1 text-sm">
                    <span className="text-zinc-300">Mật khẩu</span>
                    <input
                      type="password"
                      minLength={6}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="h-10 rounded-xl border border-zinc-700 bg-zinc-900 px-3"
                      required
                    />
                  </label>

                  <button
                    disabled={busy}
                    className="h-11 rounded-xl bg-emerald-600 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    type="submit"
                  >
                    {busy ? "Đang tạo..." : "Tạo user"}
                  </button>
                </form>
              </section>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function Avatar({ user }: { user: PublicUser }) {
  if (user.avatar) {
    return <img src={user.avatar} alt={user.name} className="h-11 w-11 rounded-xl object-cover" />;
  }

  const initial = user.name.trim().charAt(0).toUpperCase() || "U";
  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-700 text-sm font-bold text-zinc-100">
      {initial}
    </div>
  );
}

async function uploadAvatarToCloudinary(file: File): Promise<string> {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !uploadPreset) {
    throw new Error("Thiếu NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME hoặc NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET.");
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body: formData,
  });

  const data = (await response.json()) as { secure_url?: string; error?: { message?: string } };
  if (!response.ok || !data.secure_url) {
    throw new Error(data.error?.message ?? "Upload avatar thất bại.");
  }

  return data.secure_url;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
