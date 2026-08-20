// PlayVerse recruitment - push notification service worker.
//
// This file must be served from the SAME ORIGIN as index.html, at the site
// root (e.g. https://your-frontend-domain/sw.js), because the browser
// Push API requires the service worker's scope to cover the page that
// registered it. It does not need to live on the API server.

self.addEventListener('push', event => {
    let payload = { title: 'PlayVerse', body: 'You have an update.' };
    try { payload = event.data.json(); } catch (e) { }

    event.waitUntil(
        self.registration.showNotification(payload.title || 'PlayVerse', {
            body: payload.body || '',
            icon: '/favicon.ico',
            badge: '/favicon.ico',
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