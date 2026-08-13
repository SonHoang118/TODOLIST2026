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
  event.waitUntil(clients.openWindow(event.notification.data?.url || "/schedule"));
});
