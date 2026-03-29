// Service worker for the Cline PWA.
// Catches navigation failures (server not running / crashed) and serves a
// branded fallback page that auto-refreshes once the server is reachable.

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

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  // Only intercept navigation requests (page loads), not API calls or assets.
  if (event.request.mode !== "navigate") return;

  event.respondWith(
    fetch(event.request).catch(() =>
      new Response(FALLBACK_HTML, {
        status: 503,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    )
  );
});
