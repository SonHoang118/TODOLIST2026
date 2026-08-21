"use client";

import { useCallback, useEffect, useState } from "react";

const PERMISSION_INTRO_STORAGE_KEY = "dhs-todo:notification-permission-intro-v2";

function fromBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function usePushNotifications(userId: number | null) {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported" | "checking">("checking");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPermissionIntro, setShowPermissionIntro] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      queueMicrotask(() => setPermission("unsupported"));
      return;
    }
    void navigator.serviceWorker.register("/sw.js").then(async (registration) => {
      setPermission(Notification.permission);
      const subscription = await registration.pushManager.getSubscription();
      setIsSubscribed(subscription !== null);
      if (subscription === null && Notification.permission !== "denied" && localStorage.getItem(PERMISSION_INTRO_STORAGE_KEY) !== "true") {
        setShowPermissionIntro(true);
      }
    }).catch(() => setError("Không thể khởi tạo thông báo trên thiết bị này."));
  }, [userId]);

  const enable = useCallback(async () => {
    if (userId === null || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    setIsBusy(true);
    setError(null);
    try {
      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);
      if (nextPermission !== "granted") throw new Error("Bạn chưa cho phép nhận thông báo.");
      const keyResponse = await fetch("/api/push/subscription");
      if (!keyResponse.ok) throw new Error("Dịch vụ thông báo chưa được cấu hình.");
      const { publicKey } = await keyResponse.json() as { publicKey: string };
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(publicKey) });
      const response = await fetch("/api/push/subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, subscription: subscription.toJSON() }) });
      if (!response.ok) throw new Error("Không thể lưu thiết bị nhận thông báo.");
      setIsSubscribed(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể bật thông báo.");
    } finally {
      setIsBusy(false);
    }
  }, [userId]);

  const acceptPermissionIntro = useCallback(() => {
    localStorage.setItem(PERMISSION_INTRO_STORAGE_KEY, "true");
    setShowPermissionIntro(false);
    return enable();
  }, [enable]);

  const dismissPermissionIntro = useCallback(() => {
    localStorage.setItem(PERMISSION_INTRO_STORAGE_KEY, "true");
    setShowPermissionIntro(false);
  }, []);

  const disable = useCallback(async () => {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return setIsSubscribed(false);
    setIsBusy(true);
    try {
      await fetch("/api/push/subscription", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint }) });
      await subscription.unsubscribe();
      setIsSubscribed(false);
    } finally {
      setIsBusy(false);
    }
  }, []);

  const test = useCallback(async () => {
    if (permission !== "granted") return;
    setError(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification("DHS To do", {
        body: "Thông báo trên điện thoại đang hoạt động.",
        icon: "/logoApp.png",
        badge: "/logoApp.png",
      });
    } catch {
      setError("Không thể hiển thị thông báo thử trên thiết bị này.");
    }
  }, [permission]);

  return { permission, isSubscribed, isBusy, error, showPermissionIntro, acceptPermissionIntro, dismissPermissionIntro, enable, disable, test };
}
