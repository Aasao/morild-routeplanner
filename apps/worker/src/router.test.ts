import { describe, expect, it } from "vitest";
import { resolveRoute } from "./router.js";

describe("resolveRoute", () => {
  it("kjenner igjen /healthz", () => {
    expect(resolveRoute("/healthz")).toEqual({ kind: "healthz" });
  });

  it("kjenner igjen /pointer/:name og trekker ut navnet", () => {
    expect(resolveRoute("/pointer/vaer-skandinavia")).toEqual({
      kind: "pointer",
      name: "vaer-skandinavia",
    });
  });

  it("kjenner igjen /blob/:key og trekker ut hele nøkkelen (kan inneholde /)", () => {
    expect(resolveRoute("/blob/weather/1/ab12cd.bin")).toEqual({
      kind: "blob",
      key: "weather/1/ab12cd.bin",
    });
  });

  it("kjenner igjen /proxy/metalerts", () => {
    expect(resolveRoute("/proxy/metalerts")).toEqual({ kind: "metalerts" });
  });

  it("kjenner igjen /proxy/oceanforecast (punktbolge.md §3)", () => {
    expect(resolveRoute("/proxy/oceanforecast")).toEqual({ kind: "oceanforecast" });
  });

  it("gir not-found for ukjente stier", () => {
    expect(resolveRoute("/ukjent")).toEqual({ kind: "not-found" });
    expect(resolveRoute("/")).toEqual({ kind: "not-found" });
  });
});
