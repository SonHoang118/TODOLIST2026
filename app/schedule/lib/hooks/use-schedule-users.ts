"use client";

import * as Ably from "ably";
import { useEffect, useState } from "react";
import type { SessionUser } from "../types";

async function loadUsers(): Promise<SessionUser[]> {
  const response = await fetch("/api/users", { cache: "no-store" });
  if (!response.ok) throw new Error("Không thể tải nhân viên.");
  return (await response.json()) as SessionUser[];
}

export function useScheduleUsers() {
  const [users, setUsers] = useState<SessionUser[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const cached = JSON.parse(localStorage.getItem("dhs-todo:users-cache") ?? "[]") as SessionUser[];
      return Array.isArray(cached) ? cached : [];
    } catch { return []; }
  });

  useEffect(() => {
    let active = true;
    const apply = (next: SessionUser[]) => {
      if (active) {
        setUsers(next);
        try { localStorage.setItem("dhs-todo:users-cache", JSON.stringify(next)); } catch {}
      }
    };
    void loadUsers().then(apply).catch(() => undefined);

    const client = new Ably.Realtime({ authUrl: "/api/realtime/token" });
    const channel = client.channels.get("users");
    const onChanged = () => void loadUsers().then(apply).catch(() => undefined);
    channel.subscribe("users.changed", onChanged);
    const pollId = window.setInterval(() => void loadUsers().then(apply).catch(() => undefined), 5_000);

    return () => {
      active = false;
      window.clearInterval(pollId);
      void channel.unsubscribe("users.changed", onChanged);
      client.close();
    };
  }, []);

  return users;
}
