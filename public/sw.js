// Minimal service worker — enables PWA install on Chrome/Android.
// No caching: all requests go directly to the network (same as no SW).
self.addEventListener("fetch", function (event) {
  event.respondWith(fetch(event.request))
})
