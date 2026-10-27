// v66.08: lucky-badge counting (lucky is a flag, not a rarity) + RP caps
// raised so quest claims pay the RP the board displays.
// v70.00: portal launch — the game moved to /game.html and the site lives at
// the root. Network-first page strategy already covers the site pages.
// v70.01: Global Challenge rewards popup (rank/contribution/plots/EB + claim),
// per-round payout staging, and the count() fallback that made every EB prize 0.
// v70.02: daily quest claims use a server-owned ledger (fixes "claimed but
// never paid" — the optimistic sync poisoned the client-writable flag).
// v71.03: mine clock bootstrap (frozen 00:10:00 mine) + empty achievements
// adoption (stale badges after a server-side reset).
// v71.04: tactical buy-land UX — camera auto-focus above the modal, tile
// D-Pad, and smart hop navigation over owned tiles.
// v71.05: remove-friend confirmation dialog (accidental taps wiped friends).
// v71.06: capsule mirror (plant button learns cloud state) + truthful
// stronghold status text.
// v71.07: Turnstile human gate active on sign-in (bot sign-up defense).
// v71.08: Firebase App Check (reCAPTCHA Enterprise) attestation — monitor mode.
// v72.00: Buddy System — Gen-0 buddy collection, wild spawns, turn-based
// battles, taming/feasting and trainer XP (js/buddy*.js, js/player-xp.js).
// v79.00: Buddy healing (berries + passive regen + post-battle floor); fix
// voodoo idle twitching by tracking the resolved animation clip.
const CACHE_NAME = 'elden-EARTH-v79.00';

const ASSETS_TO_CACHE = [
    './',
    './game.html',
    './manifest.json',
    './models/CesiumMan.glb',
    './models/Fox.glb',
    './models/Soldier.glb',
    './models/Xbot.glb',
    './css/style.css',
    './js/main.js',
    './js/foliage.js',
    './js/friends.js',
    './js/loading.js',
    './js/leaderboard.js',
    './js/achievements.js',
    './js/wheel.js',
    './js/diamonds.js',
    './js/auth.js',
    './js/age.js',
    './js/anticheat.js',
    './js/storage.js',
    './js/multiplier.js',
    './js/grid.js',
    './js/geo.js',
    './js/treasury.js',
    './js/feed.js',
    './js/config.js',
    './js/character.js',
    './js/citadels.js',
    './js/elden-stops.js',
    './js/chat.js',
    './js/pool.js',
    './js/referrals.js',
    './js/server-anticheat.js',
    './js/pet.js',
    './js/buddy-data.js',
    './js/buddy-engine.js',
    './js/buddy-preview.js',
    './js/buddy-companion.js',
    './js/player-xp.js',
    './js/buddy-battle.js',
    './js/buddy.js',
    './js/profanity-filter.js',
    './js/format.js',
    './assets/trophy.png',
    './assets/mine-extractor.png',
    './assets/daily.png',
    './assets/pet-hud.png',
    './assets/diamond-spawn.png',
    './assets/ruler.png',
    './assets/pool.png',
    './assets/20x.png',
    './assets/50x.png',
    './assets/2eb-boost.png',
    './assets/models/RedMushroom.glb'
];

// 1. Force Immediate Activation without waiting for tabs to close
self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // Cache assets individually: one failed fetch must not abort the
            // whole install (cache.addAll() is all-or-nothing).
            return Promise.all(
                ASSETS_TO_CACHE.map((url) =>
                    cache.add(url).catch((err) => {
                        console.warn(`[SW] Could not precache ${url}:`, err);
                    })
                )
            );
        })
    );
});

// 2. Instant Cache Purge & Force-Refresh All Open Tabs
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((oldCache) => {
                    if (oldCache !== CACHE_NAME) {
                        console.log(`[SW] Deleting stale cache: ${oldCache}`);
                        return caches.delete(oldCache);
                    }
                })
            );
        }).then(() => {
            // Take control of all open clients/tabs immediately
            return self.clients.claim();
        }).then(() => {
            // Send a reload broadcast to all active open tabs
            return self.clients.matchAll({ type: 'window' });
        }).then((clients) => {
            clients.forEach((client) => {
                client.postMessage({ type: 'SW_UPDATED', version: CACHE_NAME });
            });
        })
    );
});

// Allow clients to trigger skipWaiting manually if needed
self.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// 3. Cache-First for immutable binaries, Network-First for everything else
self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;
    if (!e.request.url.startsWith(self.location.origin)) return;

    // Immutable binary assets only change when CACHE_NAME is bumped on deploy,
    // so they never need a network round-trip on every page load.
    const path = new URL(e.request.url).pathname;
    if (/\.(glb|gltf|woff2?|ttf|png|jpg|jpeg|webp|avif|mp3|wasm)$/.test(path)) {
        e.respondWith(
            caches.match(e.request).then((cached) => {
                if (cached) return cached;
                return fetch(e.request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        const responseClone = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(e.request, responseClone);
                        });
                    }
                    return networkResponse;
                });
            })
        );
        return;
    }

    e.respondWith(
        fetch(e.request, { cache: 'no-store' })
            .then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(e.request, responseClone);
                    });
                }
                return networkResponse;
            })
            .catch(() => {
                return caches.match(e.request);
            })
    );
});