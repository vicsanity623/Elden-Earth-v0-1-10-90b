// Elden Earth — Service Worker REMOVED (self-destruct script).
//
// The old cache-first service worker caused "phantom save / rollback" bugs:
// players ran stale cached client code and stale local state that raced
// Firebase and overwrote fresh cloud saves. The game now ALWAYS fetches the
// latest client from the network — no offline cache, no SW fetch interception.
//
// This file exists ONLY to clean up zombie workers already installed on
// players' devices: it deletes every cache, unregisters itself, and reloads
// open tabs onto the fresh network copy.
//
// KEEP THIS FILE DEPLOYED for 1–2 weeks so every existing player's device
// cleans itself up. After that it can be deleted from Firebase Hosting.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    // 1. Delete all old offline caches
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    }).then(() => {
      // 2. Take control of any open tabs so they can be reloaded
      return self.clients.claim();
    }).then(() => {
      // 3. Unregister this service worker permanently
      return self.registration.unregister();
    }).then(() => {
      // 4. Force reload all open tabs to fresh network
      return self.clients.matchAll({ type: 'window' });
    }).then((clients) => {
      clients.forEach((client) => {
        Promise.resolve(client.navigate(client.url)).catch(() => {});
      });
    })
  );
});

// Intentionally NO fetch handler and NO caching: every request goes straight
// to the network while this worker lives out its last seconds.
