self.addEventListener('push', event => {
    let payload = { title: 'New update', body: 'You have an update.' };
    try { payload = event.data.json(); } catch (e) { }

    event.waitUntil(
        self.registration.showNotification(payload.title || 'New update', {
            body: payload.body || '',
            icon: '/assets/icon-192.png',
            badge: '/assets/icon-192.png',
            data: { url: payload.url || '/' }
        })
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if ('focus' in client) { client.navigate(url); return client.focus(); }
            }
            if (clients.openWindow) return clients.openWindow(url);
        })
    );
});

// Installable app: pages always come from the network (so nobody ever sees a stale panel),
// with a simple offline screen when there's no connection. API calls and assets are not
// touched here; assets are already cached by the browser via their hashed URLs.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#F6F6F7;color:#111216}
main{max-width:360px;padding:24px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{color:#50535C;margin:0 0 18px;line-height:1.5}
button{font:inherit;font-weight:600;border:0;border-radius:8px;padding:10px 18px;background:#111216;color:#fff;cursor:pointer}
@media (prefers-color-scheme:dark){body{background:#0C0D10;color:#EDEDF0}p{color:#A2A4AD}button{background:#EDEDF0;color:#0C0D10}}</style></head>
<body><main><h1>You're offline</h1><p>The panel needs a connection. It'll work again as soon as you're back online.</p><button onclick="location.reload()">Try again</button></main></body></html>`;

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.mode !== 'navigate' || req.method !== 'GET') return;
    event.respondWith(fetch(req).catch(() => new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
