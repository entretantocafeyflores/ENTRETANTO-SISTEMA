// Service worker mínimo: permite instalar la app y siempre trae la versión más nueva (sin caché).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
