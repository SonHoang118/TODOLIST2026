"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppNotification } from "../types";

export function useNotifications(userId: number | null) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [recentlyReadCount, setRecentlyReadCount] = useState(0);

  const refresh = useCallback(async () => {
    if (userId === null) return;
    const response = await fetch(`/api/notifications?userId=${userId}`, { cache: "no-store" });
    if (response.ok) {
      const next = await response.json() as AppNotification[];
      setNotifications(next);
      if (next.some((item) => !item.isRead)) setRecentlyReadCount(0);
    }
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
    setIsMarkingAllRead(true);
    setRecentlyReadCount(unreadIds.length);
    setNotifications((items) => items.map((item) => ({ ...item, isRead: true })));
    try {
      await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, all: true }) });
    } finally {
      setIsMarkingAllRead(false);
    }
  }, [notifications, userId]);

  const markRead = useCallback(async (notificationId: number) => {
    if (userId === null || notifications.find((item) => item.id === notificationId)?.isRead) return;
    setNotifications((items) => items.map((item) => item.id === notificationId ? { ...item, isRead: true } : item));
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, ids: [notificationId] }),
    });
  }, [notifications, userId]);

  const deleteAll = useCallback(async () => {
    if (userId === null || notifications.length === 0 || isDeletingAll) return;
    const previousNotifications = notifications;
    setIsDeletingAll(true);
    setNotifications([]);
    setRecentlyReadCount(0);
    try {
      const response = await fetch(`/api/notifications?userId=${userId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Không thể xóa thông báo.");
    } catch {
      setNotifications(previousNotifications);
    } finally {
      setIsDeletingAll(false);
    }
  }, [isDeletingAll, notifications, userId]);

  return { notifications, unreadCount: notifications.filter((item) => !item.isRead).length, isMarkingAllRead, isDeletingAll, recentlyReadCount, markAllRead, markRead, deleteAll };
}
