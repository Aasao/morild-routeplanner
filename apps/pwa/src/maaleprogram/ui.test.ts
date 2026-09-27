import { describe, expect, it } from "vitest";
import { isMeasurementProgramRequested, pinnedPointerFetch } from "./ui.js";

describe("måleprogrammets inngang og pekerlås", () => {
  it("?maaleprogram=1 og bare det åpner modusen", () => {
    expect(isMeasurementProgramRequested("?maaleprogram=1")).toBe(true);
    expect(isMeasurementProgramRequested("?x=2&maaleprogram=1")).toBe(true);
    expect(isMeasurementProgramRequested("")).toBe(false);
    expect(isMeasurementProgramRequested("?maaleprogram=0")).toBe(false);
    expect(isMeasurementProgramRequested("?maaleprogram")).toBe(false);
  });

  it("første gang: pekeren hentes fra nettet og gis videre til lagring", async () => {
    const captured: string[] = [];
    const base = (() => Promise.resolve(new Response('{"formatVersion":"1.0.0","tiles":[]}', { status: 200 }))) as typeof fetch;
    const f = pinnedPointerFetch(base, "/pointer/vaer", null, (t) => captured.push(t));
    const res = await f("/pointer/vaer");
    expect(await res.text()).toBe('{"formatVersion":"1.0.0","tiles":[]}');
    expect(captured).toEqual(['{"formatVersion":"1.0.0","tiles":[]}']);
  });

  it("gjenopptak: den lagrede pekeren serveres, nettet spørres ikke; blobber går til nettet", async () => {
    const calls: string[] = [];
    const base = ((input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.resolve(new Response("blob", { status: 200 }));
    }) as typeof fetch;
    const f = pinnedPointerFetch(base, "/pointer/vaer", '{"lagret":true}', () => undefined);
    const res = await f("/pointer/vaer");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ lagret: true });
    await f("/blob/abc");
    expect(calls).toEqual(["/blob/abc"]);
  });
});
