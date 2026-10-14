/* WCA 個人成績ビューア — Service Worker
 * - アプリ本体（HTML・アイコン）をキャッシュし、電波がないときも起動できるようにする
 * - 成績データは「ネット優先・失敗したらキャッシュ」で取得し、一度見た選手はオフラインでも表示できる
 * index.html を更新したら VERSION を上げると、古いキャッシュが確実に入れ替わります。
 */
const VERSION = "v3";
const SHELL = `wca-stats-shell-${VERSION}`;
const DATA = "wca-stats-data";
const FONTS = "wca-stats-fonts";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/favicon.svg"
];
const DATA_HOSTS = ["raw.githubusercontent.com", "www.worldcubeassociation.org"];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
const MAX_DATA_ENTRIES = 600;

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, DATA, FONTS]);
    for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function networkFirst(req, cacheName, trim) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      cache.put(req, res.clone());
      if (trim) trimCache(cache);
    }
    return res;
  } catch (e) {
    const hit = await cache.match(req, {ignoreVary: true});
    if (hit) return hit;
    throw e;
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
  return res;
}

async function trimCache(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_DATA_ENTRIES; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // アプリ本体：ネット優先（更新をすぐ反映）、オフライン時はキャッシュ
  if (url.origin === self.location.origin) {
    if (req.mode === "navigate") {
      event.respondWith(networkFirst(req, SHELL).catch(async () =>
        (await caches.match("./index.html")) || (await caches.match("./"))));
    } else {
      event.respondWith(networkFirst(req, SHELL));
    }
    return;
  }
  // 成績データ（GitHubミラー・WCA公式API）
  if (DATA_HOSTS.includes(url.hostname)) {
    event.respondWith(networkFirst(req, DATA, true));
    return;
  }
  // Google Fonts
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req, FONTS));
  }
});
