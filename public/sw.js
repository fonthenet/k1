/* Rawdatik service worker — web push delivery.
   Kept deliberately tiny: it must keep working for a device that installed it
   months ago, so it holds no app logic and no cached routes. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Rawdatik", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Rawdatik";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-badge.png",
    // Same tag replaces an earlier alert about the same thing instead of stacking.
    tag: payload.tag || payload.type || "rawdatik",
    data: { url: payload.url || "/" },
    dir: "auto",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Reuse an open tab when there is one, rather than piling up windows.
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
