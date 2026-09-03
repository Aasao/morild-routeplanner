// Hånd-skrevet service worker (bevisst ikke bygget/transpilert av Vite —
// enkel nok til å leve som ren JS). Se docs/specs/app-skjelett.md §5.5.
//
// Denne bølgen: kun opportunistisk runtime-cache for app-skallet, IKKE en
// forhåndsbygget precache-liste (Vites hash-navngitte assets er ukjente
// her uten et build-tids manifest, som denne bølgen bevisst ikke bygger).
// Ingen spesialbehandling av /pointer/, /blob/, /proxy/ ennå — appen gjør
// ingen slike kall før bølge 2/3 (se spec §2/§5.5 for F6.4-kontrakten de
// MÅ oppfylle når de skrives).

const CACHE_NAME = "morild-shell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    // Kartverket-fliser (§5.2) og fremtidige apps/worker-kall (annet
    // opphav i produksjon) håndteres ikke av denne enkle app-skall-SW-en.
    return;
  }

  const isNavigation = request.mode === "navigate";
  const isBuiltAsset = url.pathname.startsWith("/assets/");

  if (isBuiltAsset) {
    // Hash i filnavnet betyr innholdsendring alltid gir ny URL — trygt
    // cache-først.
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then(
          (cached) =>
            cached ||
            fetch(request).then((response) => {
              cache.put(request, response.clone());
              return response;
            }),
        ),
      ),
    );
    return;
  }

  if (isNavigation) {
    // Nettverk-først, cache-fallback: appen skal laste frakoblet etter
    // første besøk online.
    event.respondWith(
      fetch(request)
        .then((response) => {
          caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/"))),
    );
  }
});
