// NanoLabs AI Trading - Service Worker for PWA & Web Push Notifications
const SW_VERSION = 'nanolabs-sw-v1.0';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const payload = event.data.json();
    const title = payload.title || 'NanoLabs AI Trading';
    const options = {
      body: payload.body || 'Nueva alerta de mercado',
      icon: payload.icon || '/favicon.ico',
      badge: payload.badge || '/favicon.ico',
      tag: payload.tag || 'nanolabs-trading-alert',
      vibrate: [200, 100, 200],
      data: payload.data || { url: '/' },
      actions: [
        { action: 'open', title: 'Ver Oportunidad' },
        { action: 'dismiss', title: 'Descartar' },
      ],
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch (err) {
    // Plain text fallback
    const text = event.data.text();
    event.waitUntil(
      self.registration.showNotification('NanoLabs AI Trading', {
        body: text,
        icon: '/favicon.ico',
      })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
