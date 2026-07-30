/* TinyPhone service worker — สำหรับยิงแจ้งเตือน OS บนมือถือ (Android/Chrome ห้าม new Notification()) */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// กดแจ้งเตือน → โฟกัสแท็บ SillyTavern (หรือเปิดใหม่ถ้าไม่มี)
self.addEventListener("notificationclick", (e) => {
    e.notification.close();
    e.waitUntil(
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
            for (const c of cs) {
                if ("focus" in c) return c.focus();
            }
            if (self.clients.openWindow) return self.clients.openWindow("/");
        })
    );
});
