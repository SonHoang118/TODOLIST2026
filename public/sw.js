self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(clients.claim()));

self.addEventListener("push", (event) => {
  const payload = event.data ? event.data.json() : { title: "DHS To do", body: "Bạn có thông báo mới.", url: "/schedule" };
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: payload.icon || "/logoApp.png",
    badge: "/logoApp.png",
    data: { url: payload.url || "/schedule" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/schedule", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const existingWindow = windows[0];
    if (existingWindow) {
      if ("navigate" in existingWindow) await existingWindow.navigate(targetUrl);
      return existingWindow.focus();
    }
    return clients.openWindow(targetUrl);
  })());
});
