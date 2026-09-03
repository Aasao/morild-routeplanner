/**
 * CORS for de offentlige, ikke-sensitive lese-rutene (docs/specs/
 * app-skjelett.md §7): `apps/pwa` (Cloudflare Pages) og `apps/worker`
 * kjører på ulike opphav i utvikling og potensielt i produksjon, og disse
 * dataene har ingen brukerspesifikk hemmelighet å beskytte.
 */
export function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("vary", "origin");
  return new Response(response.body, { status: response.status, headers });
}

export function handlePreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "if-none-match",
      "access-control-max-age": "86400",
    },
  });
}
