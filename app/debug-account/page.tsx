"use client";

import { useEffect, useMemo, useState } from "react";
import { ACTIVE_USER_STORAGE_KEY } from "../schedule/lib/session";

type PublicUser = { id: number; role: "ADMIN" | "STAFF"; name: string; avatar: string };

export default function DebugAccountPage() {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [currentUser, setCurrentUser] = useState<PublicUser | null>(null);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("Đang tải tài khoản từ Neon...");

  useEffect(() => {
    void fetch("/api/users", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const nextUsers = (await response.json()) as PublicUser[];
        setUsers(nextUsers);
        const savedId = Number(window.localStorage.getItem(ACTIVE_USER_STORAGE_KEY));
        const savedUser = nextUsers.find((user) => user.id === savedId) ?? null;
        setSelectedUserId(savedUser?.id ?? nextUsers[0]?.id ?? null);
        setCurrentUser(savedUser);
        setMessage(savedUser ? `Đang dùng: ${savedUser.name}` : "Chọn tài khoản để đăng nhập.");
      })
      .catch(() => setMessage("Không thể tải tài khoản từ Neon."));
  }, []);

  const selectedUser = useMemo(() => users.find((user) => user.id === selectedUserId) ?? null, [selectedUserId, users]);

  function handleLogin() {
    if (!selectedUser) return setMessage("Vui lòng chọn người dùng.");
    if (!password.trim()) return setMessage("Nhập mật khẩu tạm để xác nhận.");
    window.localStorage.setItem(ACTIVE_USER_STORAGE_KEY, String(selectedUser.id));
    setCurrentUser(selectedUser);
    setPassword("");
    setMessage(`Đã chuyển sang ${selectedUser.name}. Mở trang lịch để dùng tài khoản này.`);
  }

  function handleSwitch() {
    setCurrentUser(null);
    setPassword("");
    setMessage("Chọn tài khoản khác.");
  }

  return <div className="min-h-dvh bg-zinc-950 text-zinc-100"><main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
    <header className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-5"><h1 className="text-2xl font-bold">Tài khoản thử nghiệm</h1><p className="mt-1 text-sm text-zinc-400">Danh sách người dùng lấy từ Neon.</p></header>
    <div className="rounded-2xl border border-emerald-700/40 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-300">{message}</div>
    {currentUser ? <section className="rounded-3xl border border-zinc-800 bg-zinc-900/50 p-5"><div className="flex items-center justify-between gap-4"><div className="flex items-center gap-3"><Avatar user={currentUser}/><div><p className="text-lg font-semibold">{currentUser.name}</p><p className="text-sm text-zinc-400">{currentUser.role}</p></div></div><button type="button" onClick={handleSwitch} className="rounded-xl border border-zinc-700 px-3 py-2 text-sm">Đổi tài khoản</button></div></section> : <section className="grid gap-5 rounded-3xl border border-zinc-800 bg-zinc-900/50 p-5"><h2 className="text-lg font-semibold">Chọn người dùng</h2><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{users.map((user) => <button key={user.id} type="button" onClick={() => setSelectedUserId(user.id)} className={`flex items-center gap-3 rounded-2xl border px-3 py-3 text-left ${selectedUserId === user.id ? "border-violet-500 bg-violet-500/10" : "border-zinc-800 bg-zinc-900"}`}><Avatar user={user}/><div><p className="text-sm font-medium">{user.name}</p><p className="text-xs text-zinc-400">{user.role}</p></div></button>)}</div><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Nhập mật khẩu tạm" className="h-11 rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm"/><button type="button" onClick={handleLogin} className="h-11 rounded-xl bg-violet-600 text-sm font-semibold">Đăng nhập</button></section>}
  </main></div>;
}

function Avatar({ user }: { user: { name: string; avatar: string } }) { return user.avatar ? <img src={user.avatar} alt={user.name} className="h-10 w-10 rounded-full object-cover"/> : <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-600 text-sm font-semibold">{user.name.trim().charAt(0).toUpperCase() || "U"}</div>; }
