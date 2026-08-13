"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppNotification } from "../types";

export function useNotifications(userId: number | null) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const refresh = useCallback(async () => {
    if (userId === null) return;
    const response = await fetch(`/api/notifications?userId=${userId}`, { cache: "no-store" });
    if (response.ok) setNotifications(await response.json() as AppNotification[]);
  }, [userId]);

  useEffect(() => {
    if (userId === null) return;
    void refresh();
    const intervalId = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(intervalId);
  }, [refresh, userId]);

  const markAllRead = useCallback(async () => {
    if (userId === null) return;
    const unreadIds = notifications.filter((item) => !item.isRead).map((item) => item.id);
    if (unreadIds.length === 0) return;
    setNotifications((items) => items.map((item) => ({ ...item, isRead: true })));
    await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, all: true }) });
  }, [notifications, userId]);

  return { notifications, unreadCount: notifications.filter((item) => !item.isRead).length, markAllRead };
}
