"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppNotification } from "../types";

export function useNotifications(userId: number | null) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [recentlyReadCount, setRecentlyReadCount] = useState(0);
  const activeMutationCountRef = useRef(0);
  const mutationVersionRef = useRef(0);

  const refresh = useCallback(async () => {
    if (userId === null || activeMutationCountRef.current > 0) return;
    const requestVersion = mutationVersionRef.current;
    const response = await fetch(`/api/notifications?userId=${userId}`, { cache: "no-store" });
    if (response.ok && activeMutationCountRef.current === 0 && requestVersion === mutationVersionRef.current) {
      const next = await response.json() as AppNotification[];
      setNotifications(next);
      if (next.some((item) => !item.isRead)) setRecentlyReadCount(0);
    }
  }, [userId]);

  useEffect(() => {
    if (userId === null) return;
    const initialRefreshId = window.setTimeout(() => void refresh(), 0);
    const intervalId = window.setInterval(() => void refresh(), 2_000);
    return () => {
      window.clearTimeout(initialRefreshId);
      window.clearInterval(intervalId);
    };
  }, [refresh, userId]);

  const markAllRead = useCallback(async () => {
    if (userId === null || isMarkingAllRead || isDeletingAll) return;
    const unreadIds = notifications.filter((item) => !item.isRead).map((item) => item.id);
    if (unreadIds.length === 0) return;
    const previousNotifications = notifications;
    mutationVersionRef.current += 1;
    activeMutationCountRef.current += 1;
    setIsMarkingAllRead(true);
    setRecentlyReadCount(unreadIds.length);
    setNotifications((items) => items.map((item) => ({ ...item, isRead: true })));
    try {
      const response = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, all: true }) });
      if (!response.ok) throw new Error("Không thể đánh dấu thông báo.");
    } catch {
      setNotifications(previousNotifications);
      setRecentlyReadCount(0);
    } finally {
      activeMutationCountRef.current -= 1;
      setIsMarkingAllRead(false);
    }
  }, [isDeletingAll, isMarkingAllRead, notifications, userId]);

  const markRead = useCallback(async (notificationId: number) => {
    if (userId === null || notifications.find((item) => item.id === notificationId)?.isRead) return;
    mutationVersionRef.current += 1;
    activeMutationCountRef.current += 1;
    setNotifications((items) => items.map((item) => item.id === notificationId ? { ...item, isRead: true } : item));
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ids: [notificationId] }),
      });
    } finally {
      activeMutationCountRef.current -= 1;
    }
  }, [notifications, userId]);

  const deleteAll = useCallback(async () => {
    if (userId === null || notifications.length === 0 || isDeletingAll) return;
    mutationVersionRef.current += 1;
    activeMutationCountRef.current += 1;
    setIsDeletingAll(true);
    try {
      const response = await fetch(`/api/notifications?userId=${userId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Không thể xóa thông báo.");
      setNotifications([]);
      setRecentlyReadCount(0);
    } catch {
      // Keep the existing list when the server cannot delete it.
    } finally {
      activeMutationCountRef.current -= 1;
      setIsDeletingAll(false);
    }
  }, [isDeletingAll, notifications, userId]);

  return { notifications, unreadCount: notifications.filter((item) => !item.isRead).length, isMarkingAllRead, isDeletingAll, recentlyReadCount, markAllRead, markRead, deleteAll };
}
