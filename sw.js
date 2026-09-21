/* NorthVenture service worker
 *
 * - App pages (landing, 2D, 3D):  serve from cache instantly, refresh in the background.
 * - Map libraries (Leaflet, MapLibre, jsPDF, fonts): cached once, served from cache.
 * - Map tiles:  cached as you browse (up to MAX_TILES), so viewed areas work offline.
 * - Search (Nominatim) and weather (Open-Meteo): always go to the network.
 *
 * To ship an update to the app pages, change VERSION below.
 */
const VERSION = "v2";
const SHELL = `nv-shell-${VERSION}`;
const LIBS = `nv-libs-${VERSION}`;
const TILES = "nv-tiles"; // not versioned: viewed map areas survive app updates
const MAX_TILES = 4000;

const SHELL_URLS = [
  "./",
  "./index.html",
  "./index_2D.html",
  "./index_3D.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./favicon-32.png",
  "./logo.png",
  "./card-2d.jpg",
  "./card-3d.jpg",
];

// Everything the two maps load from a CDN.
const LIB_URLS = [
  // 2D (Leaflet)
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet-src.js",
  "https://unpkg.com/leaflet-image@0.4.0/leaflet-image.js",
  "https://unpkg.com/leaflet-rotate@0.2.8/dist/leaflet-rotate-src.js",
  // 3D (MapLibre)
  "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css",
  "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js",
  // both
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  // landing page fonts
  "https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@600;700&display=swap",
];

const LIB_HOSTS = new Set([
  "unpkg.com",
  "cdn.jsdelivr.net",
  "cdnjs.cloudflare.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
]);

function isTile(url) {
  const h = url.hostname;
  return (
    h === "server.arcgisonline.com" ||
    h.endsWith(".tile.opentopomap.org") ||
    h.endsWith(".tile.openstreetmap.org") ||
    h.endsWith(".basemaps.cartocdn.com") ||
    (h === "s3.amazonaws.com" && url.pathname.startsWith("/elevation-tiles-prod/"))
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL);
      await shell.addAll(SHELL_URLS);
      // Best effort: if a CDN is unreachable now, it is cached on first use instead.
      const libs = await caches.open(LIBS);
      await Promise.allSettled(
        LIB_URLS.map(async (u) => {
          const res = await fetch(u, { mode: "cors", credentials: "omit" });
          if (res.ok) await libs.put(u, res);
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, LIBS, TILES]);
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("nv-") && !keep.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(appPage(event));
  } else if (isTile(url)) {
    event.respondWith(cacheFirst(TILES, req, true));
  } else if (LIB_HOSTS.has(url.hostname)) {
    event.respondWith(cacheFirst(LIBS, req, false));
  }
  // anything else (search, weather, ...) goes straight to the network
});

async function appPage(event) {
  const req = event.request;
  const cache = await caches.open(SHELL);
  const cached = await cache.match(req, { ignoreSearch: true });
  const refresh = fetch(req)
    .then((res) => {
      if (res.ok && !res.redirected) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  const res = await refresh;
  if (res) return res;
  if (req.mode === "navigate") {
    const home = await cache.match("./index.html");
    if (home) return home;
  }
  return Response.error();
}

// Tile servers hand out the same tile from a.*, b.* and c.* hosts; treat them as one entry.
function tileKey(u) {
  return u.replace(
    /^https:\/\/[abc]\.(tile\.opentopomap\.org|tile\.openstreetmap\.org|basemaps\.cartocdn\.com)/,
    "https://a.$1"
  );
}

// Third-party responses are re-requested in CORS mode so the cache holds real
// responses (opaque ones count as ~7 MB each against the storage quota).
// If a tile server has no CORS headers, the tile is passed through and stored
// as an opaque response instead, so it still works offline.
async function cacheFirst(cacheName, req, isTile) {
  const cache = await caches.open(cacheName);
  const key = isTile ? tileKey(req.url) : req.url;
  const hit = await cache.match(key);
  if (hit && !(hit.type === "opaque" && req.mode === "cors")) return hit;

  let res = null;
  try {
    res = await fetch(req.url, { mode: "cors", credentials: "omit" });
  } catch (err) {
    res = null;
  }
  if (res) {
    if (res.ok) store(cache, key, res.clone(), isTile);
    return res;
  }
  try {
    const raw = await fetch(req); // server without CORS: pass through
    if (isTile && raw.type === "opaque") store(cache, key, raw.clone(), true);
    return raw;
  } catch (err) {
    return Response.error();
  }
}

function store(cache, key, res, isTile) {
  cache
    .put(key, res)
    .then(() => {
      if (isTile && Math.random() < 0.02) trimCache(cache);
    })
    .catch(() => {});
}

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_TILES) {
    await Promise.all(keys.slice(0, keys.length - MAX_TILES).map((k) => cache.delete(k)));
  }
}
