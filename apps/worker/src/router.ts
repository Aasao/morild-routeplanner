/**
 * Ren ruteoppløsning: URL-sti → hvilken handler som skal kjøre.
 *
 * Bevisst en ren funksjon (ingen `Request`/`Env`/R2 involvert) slik at hele
 * rutingslogikken er enhetstestbar uten en Worker-kjøretid eller
 * miniflare — se docs/specs/app-skjelett.md §6.4.
 */
export type Route =
  | { readonly kind: "healthz" }
  | { readonly kind: "pointer"; readonly name: string }
  | { readonly kind: "blob"; readonly key: string }
  | { readonly kind: "metalerts" }
  | { readonly kind: "not-found" };

const POINTER_PREFIX = "/pointer/";
const BLOB_PREFIX = "/blob/";

export function resolveRoute(pathname: string): Route {
  if (pathname === "/healthz") {
    return { kind: "healthz" };
  }
  if (pathname.startsWith(POINTER_PREFIX)) {
    return { kind: "pointer", name: pathname.slice(POINTER_PREFIX.length) };
  }
  if (pathname.startsWith(BLOB_PREFIX)) {
    return { kind: "blob", key: pathname.slice(BLOB_PREFIX.length) };
  }
  if (pathname === "/proxy/metalerts") {
    return { kind: "metalerts" };
  }
  return { kind: "not-found" };
}
