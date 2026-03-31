// Service worker for the Cline PWA.
// Caches the app shell for offline use and serves a branded fallback
// when the dev server is unreachable.
// Also handles Web Push notifications (push, notificationclick, pushsubscriptionchange).

const CACHE_VERSION = "v1";
const CACHE_NAME = `cline-pwa-${CACHE_VERSION}`;

// ── Navigation fallback page ───────────────────────────────────────────────

const FALLBACK_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Cline</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{
    background:#1F2428;
    color:#6E7681;
    font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;
    display:flex;
    height:100svh;
    align-items:center;
    justify-content:center;
    padding:24px;
  }
  .container{
    display:flex;
    flex-direction:column;
    align-items:center;
    justify-content:center;
    gap:12px;
    padding:48px 0;
  }
  h3{font-size:16px;font-weight:600;color:#E6EDF3}
  p{font-size:14px;color:#8B949E;text-align:center;line-height:1.5}
  .spinner{
    width:20px;height:20px;
    border:2px solid #30363D;
    border-top-color:#8B949E;
    border-radius:50%;
    animation:spin .8s linear infinite;
    margin-top:8px;
  }
  @keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="container">
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" x2="12" y1="8" y2="12"/>
    <line x1="12" x2="12.01" y1="16" y2="16"/>
  </svg>
  <h3>Waiting for Cline</h3>
  <p>Run <code style="background:#2D3339;padding:2px 6px;border-radius:4px;font-size:13px">cline</code> in your terminal to start the server.</p>
  <div class="spinner"></div>
</div>
<script>
  (function poll() {
    fetch("/", { method: "HEAD", cache: "no-store" })
      .then(function(r) { if (r.ok) location.reload(); else setTimeout(poll, 2000); })
      .catch(function() { setTimeout(poll, 2000); });
  })();
</script>
</body>
</html>`;

// App shell URLs to precache on install.
// Vite-generated assets have content hashes so they're safe to cache long-term.
// index.html is fetched network-first at runtime, but we cache a copy as fallback.
const APP_SHELL_URLS = ["/", "/manifest.json", "/assets/icon-192.png", "/assets/icon-512.png"];

// ── Lifecycle ─────────────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_URLS))
	);
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	// Clean up old caches from previous versions.
	event.waitUntil(
		caches.keys().then((keys) =>
			Promise.all(
				keys
					.filter((key) => key.startsWith("cline-pwa-") && key !== CACHE_NAME)
					.map((key) => caches.delete(key))
			)
		)
	);
	self.clients.claim();
});

// ── Navigation fetch fallback ─────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
	const { request } = event;
	const url = new URL(request.url);

	// Only handle same-origin requests.
	if (url.origin !== self.location.origin) return;

	// Navigation requests: network-first, fall back to cached index.html, then fallback page.
	if (request.mode === "navigate") {
		event.respondWith(
			fetch(request)
				.then((response) => {
					// Cache a fresh copy of index.html on successful navigation.
					const clone = response.clone();
					caches.open(CACHE_NAME).then((cache) => cache.put("/", clone));
					return response;
				})
				.catch(() =>
					caches.match("/").then(
						(cached) =>
							cached ||
							new Response(FALLBACK_HTML, {
								status: 503,
								headers: { "Content-Type": "text/html; charset=utf-8" },
							})
					)
				)
		);
		return;
	}

	// Static assets (JS, CSS, images, fonts): cache-first.
	// Vite hashes filenames, so cached versions are inherently correct.
	if (
		request.destination === "script" ||
		request.destination === "style" ||
		request.destination === "image" ||
		request.destination === "font" ||
		url.pathname.startsWith("/assets/")
	) {
		event.respondWith(
			caches.match(request).then(
				(cached) =>
					cached ||
					fetch(request).then((response) => {
						const clone = response.clone();
						caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
						return response;
					})
			)
		);
		return;
	}

	// Everything else (API calls, etc.): network only, no caching.
});

// ── Push notification receipt ─────────────────────────────────────────────
//
// Payload shape (from push-manager.ts):
//   { title: string, body: string, data: { event, workspaceId, taskId?, url, ... } }

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Malformed payload — show a generic notification.
  }

  const title = payload.title || "Cline Kanban";
  const body  = payload.body  || "";
  const data  = payload.data  || {};

  // Use a stable tag so that multiple rapid notifications for the same task
  // replace each other rather than stacking up in the notification tray.
  const tag = [
    "kanban",
    data.event  || "notification",
    data.workspaceId || "",
    data.taskId || String(Date.now()),
  ].filter(Boolean).join("-");

  const options = {
    body,
    icon:  "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data,
    requireInteraction: true,   // stay visible until the user explicitly acts
    tag,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click ────────────────────────────────────────────────────
//
// When the user taps a notification:
//   • If the Kanban app is already open in a tab → focus it and send a
//     message so the frontend can navigate to the relevant task/workspace.
//   • If the app is closed → open it at the deep-link URL from data.url.

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const notifData = event.notification.data || {};
  const targetUrl = notifData.url
    ? String(notifData.url)
    : "/";

  const absoluteTarget = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // Find an existing window on this origin.
        for (const client of windowClients) {
          if (new URL(client.url).origin === self.location.origin) {
            // Post a message so the app can navigate to the right place.
            client.postMessage({
              type: "KANBAN_PUSH_CLICK",
              data: notifData,
            });
            return client.focus();
          }
        }
        // No open window — open one at the target URL.
        return self.clients.openWindow(absoluteTarget);
      })
  );
});

// ── Subscription refresh ──────────────────────────────────────────────────
//
// If the push service rotates the subscription (e.g. after a long period of
// inactivity), automatically re-subscribe and update the server so push
// delivery continues uninterrupted.

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      let newSub;
      try {
        newSub = await self.registration.pushManager.subscribe(
          event.oldSubscription
            ? event.oldSubscription.options
            : { userVisibleOnly: true }
        );
      } catch {
        // Cannot resubscribe without a fresh applicationServerKey from the app.
        // The user will be prompted to re-enable notifications on next visit.
        return;
      }

      // Inform the server about the new subscription.
      // The endpoint accepts the standard PushSubscription JSON.
      const subJson = newSub.toJSON();
      if (!subJson.endpoint || !subJson.keys) return;

      try {
        await fetch("/api/trpc/remote.push.subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Note: the server re-reads the cookie for auth — no explicit token needed.
          credentials: "include",
          body: JSON.stringify({
            "0": {
              endpoint: subJson.endpoint,
              keys: {
                p256dh: subJson.keys.p256dh || "",
                auth:   subJson.keys.auth   || "",
              },
            },
          }),
        });
      } catch {
        // Network unavailable — will retry on next push event.
      }
    })()
  );
});
