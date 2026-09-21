# NorthVenture Valbona Maps (PWA)

    index.html        landing page (choose 2D or 3D)
    2d/index.html     your 2D map (Leaflet)
    3d/index.html     your 3D map (MapLibre)
    sw.js             service worker (offline + tile caching)
    manifest.webmanifest, icons/

## Deploy
A PWA needs HTTPS and its own address. Upload this whole folder to any static host
(Netlify drop, Cloudflare Pages, GitHub Pages, Vercel). Keep the folder structure as is.
Wix cannot serve the service worker, so link to the hosted address from your Wix site
(a button or link) instead of embedding it in an iframe; the Install option only works
when the page is opened directly.

## Updating
Edit 2d/index.html or 3d/index.html, redeploy, and change VERSION in sw.js
(for example "v1" to "v2") so returning visitors get the new files.

## Notes
- Map tiles are cached as people browse (up to 2,500 tiles), so viewed areas work offline.
- Search and weather always need a connection.
- Each map has a small Home button (top right) that returns to the landing page.
