"use client";

import { useEffect, useMemo, useState } from "react";

type UserRole = "ADMIN" | "STAFF";

interface PublicUser {
  id: number;
  role: UserRole;
  name: string;
  avatar: string;
  createdAt: string;
}

const DEMO_USERS: PublicUser[] = [
  { id: 1, role: "ADMIN", name: "Ngô Thế Hiếu", avatar: "", createdAt: new Date().toISOString() },
  { id: 2, role: "STAFF", name: "Nhân viên A", avatar: "", createdAt: new Date().toISOString() },
  { id: 3, role: "STAFF", name: "Nhân viên B", avatar: "", createdAt: new Date().toISOString() },
];

export default function DebugAccountPage() {
  const [selectedUserId, setSelectedUserId] = useState<number | null>(DEMO_USERS[0]?.id ?? null);
  const [password, setPassword] = useState("");
  const [currentUser, setCurrentUser] = useState<PublicUser | null>(DEMO_USERS[0] ?? null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedUser = useMemo(
    () => DEMO_USERS.find((u) => u.id === selectedUserId) ?? null,
    [selectedUserId],
  );

  useEffect(() => {
    if (currentUser) {
      setMessage(`Đang dùng demo: ${currentUser.name}`);
    }
  }, [currentUser]);

  function handleLogin() {
    if (!selectedUser) {
      setMessage("Vui lòng chọn người dùng.");
      return;
    }

    if (!password.trim()) {
      setMessage("Nhập mật khẩu giả để demo.");
      return;
    }

    setCurrentUser(selectedUser);
    setMessage(`Xin chào ${selectedUser.name}. Chế độ client-only đang bật.`);
  }

  function handleLogout() {
    setCurrentUser(null);
    setMessage("Đã thoát khỏi demo user.");
  }

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
        <header className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-5">
          <h1 className="text-2xl font-bold tracking-tight">Demo Account</h1>
          <p className="mt-1 text-sm text-zinc-400">Chế độ client-only: không lưu, không gọi API.</p>
        </header>

        {message && (
          <div className="rounded-2xl border border-emerald-700/40 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-300">
            {message}
          </div>
        )}

        {!currentUser ? (
          <section className="grid gap-5 rounded-3xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h2 className="text-lg font-semibold">Chọn người dùng</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {DEMO_USERS.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => setSelectedUserId(user.id)}
                  className={[
                    "flex items-center gap-3 rounded-2xl border px-3 py-3 text-left transition",
                    selectedUserId === user.id ? "border-violet-500 bg-violet-500/10" : "border-zinc-800 bg-zinc-900",
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

            <div className="grid gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
              <p className="text-sm text-zinc-300">
                Đăng nhập demo: <span className="font-semibold text-zinc-100">{selectedUser?.name ?? "Chưa chọn"}</span>
              </p>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Nhập mật khẩu demo"
                className="h-11 rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm outline-none ring-violet-500 placeholder:text-zinc-500 focus:ring-2"
              />
              <button
                type="button"
                onClick={handleLogin}
                className="h-11 rounded-xl bg-violet-600 text-sm font-semibold text-white"
              >
                Đăng nhập
              </button>
            </div>
          </section>
        ) : (
          <section className="rounded-3xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Avatar user={currentUser} />
                <div>
                  <p className="text-lg font-semibold text-zinc-100">{currentUser.name}</p>
                  <p className="text-sm text-zinc-400">{currentUser.role}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleLogout}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
              >
                Đăng xuất
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function Avatar({ user }: { user: { name: string; avatar: string } }) {
  return user.avatar ? (
    <img src={user.avatar} alt={user.name} className="h-10 w-10 rounded-full object-cover" />
  ) : (
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-600 text-sm font-semibold text-white">
      {user.name.trim().charAt(0).toUpperCase() || "U"}
    </div>
  );
}
