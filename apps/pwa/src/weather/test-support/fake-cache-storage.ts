/**
 * Minimal, i-minne erstatning for nettleserens `CacheStorage`/`Cache`
 * (Cache API) — verken Node.js' kjøretid eller jsdom implementerer disse
 * (i motsetning til `fetch`/`Request`/`Response`, som Node 22 har
 * globalt). `pack-cache.ts` tar derfor `CacheStorageLike` som en injisert
 * avhengighet (samme mønster som `FetchLike` andre steder i repoet), og
 * denne fila er testdobbelen — IKKE en `.test.ts` selv (ingen `it`/
 * `describe` her), men et delt testverktøy, samme rolle som
 * `packages/routing/test-fixtures/`.
 */
import type { CacheLike, CacheStorageLike } from "../pack-cache.js";

export class FakeCache implements CacheLike {
  private readonly store = new Map<string, Response>();

  /**
   * `Request.prototype.toString()` returnerer IKKE URL-en (den arver
   * `Object.prototype.toString`, altså `"[object Request]"`) — ekte
   * `CacheStorage`-implementasjoner nøkler på `request.url`, så denne
   * dobbelen må gjøre det samme for at `match`/`put` skal stemme overens
   * (fanget av et reelt testutfall, ikke antatt).
   */
  private keyOf(request: RequestInfo | URL): string {
    if (typeof request === "string") return request;
    if (request instanceof URL) return request.toString();
    return request.url;
  }

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const cached = this.store.get(this.keyOf(request));
    return cached ? cached.clone() : undefined;
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    this.store.set(this.keyOf(request), response.clone());
  }

  /** Testverktøy — ikke del av `CacheLike`. */
  has(request: RequestInfo | URL): boolean {
    return this.store.has(this.keyOf(request));
  }
}

export class FakeCacheStorage implements CacheStorageLike {
  private readonly caches = new Map<string, FakeCache>();

  async open(name: string): Promise<FakeCache> {
    const existing = this.caches.get(name);
    if (existing) return existing;
    const created = new FakeCache();
    this.caches.set(name, created);
    return created;
  }
}
