import { describe, expect, it, vi } from "vitest";
import { buildHealthcheckPayload, runWithHealthcheck } from "./healthcheck.js";

describe("buildHealthcheckPayload", () => {
  it("bygger et payload med minimum-feltene fra §13", () => {
    const payload = buildHealthcheckPayload({
      runId: "run-1",
      startedAt: "2026-09-02T00:00:00Z",
      finishedAt: "2026-09-02T00:05:00Z",
      fields: [{ field: "wind", succeeded: true, fellBackTo: undefined, sourceStatus: { status: "ok" } }],
      totalPackageBytes: 12_000_000,
      unexpectedDegradation: false,
    });
    expect(payload.runId).toBe("run-1");
    expect(payload.fields).toHaveLength(1);
    expect(payload.error).toBeUndefined();
  });
});

describe("runWithHealthcheck (§13 — ping skjer ALLTID, i en finally)", () => {
  it("pinger med succeeded=true når jobben lykkes", async () => {
    const ping = vi.fn().mockResolvedValue(undefined);
    const result = await runWithHealthcheck(
      async () => "resultat",
      ping,
      "https://healthcheck.example/ping",
      (outcome) =>
        buildHealthcheckPayload({
          runId: "r1",
          startedAt: "t0",
          finishedAt: "t1",
          fields: [],
          totalPackageBytes: 0,
          unexpectedDegradation: false,
          ...(outcome.error !== undefined ? { error: outcome.error } : {}),
        }),
    );
    expect(result).toBe("resultat");
    expect(ping).toHaveBeenCalledTimes(1);
    expect(ping.mock.calls[0]?.[0]).toBe("https://healthcheck.example/ping");
    expect(ping.mock.calls[0]?.[1]?.error).toBeUndefined();
  });

  it("pinger MED feilmeldingen og kaster feilen videre når jobben feiler (§13: crash før ping skjuler feilen)", async () => {
    const ping = vi.fn().mockResolvedValue(undefined);
    await expect(
      runWithHealthcheck(
        async () => {
          throw new Error("THREDDS nede");
        },
        ping,
        "https://healthcheck.example/ping",
        (outcome) =>
          buildHealthcheckPayload({
            runId: "r1",
            startedAt: "t0",
            finishedAt: "t1",
            fields: [],
            totalPackageBytes: 0,
            unexpectedDegradation: false,
            ...(outcome.error !== undefined ? { error: outcome.error } : {}),
          }),
      ),
    ).rejects.toThrow("THREDDS nede");
    expect(ping).toHaveBeenCalledTimes(1);
    expect(ping.mock.calls[0]?.[1]?.error).toBe("THREDDS nede");
  });

  it("pinger selv om ping-funksjonen selv ville vært det eneste stedet man ser feilen (ingen swallow)", async () => {
    const seenPayloads: unknown[] = [];
    const ping = vi.fn().mockImplementation(async (_url: string, payload: unknown) => {
      seenPayloads.push(payload);
    });
    await expect(
      runWithHealthcheck(
        async () => {
          throw new Error("boom");
        },
        ping,
        "url",
        (outcome) =>
          buildHealthcheckPayload({
            runId: "r",
            startedAt: "a",
            finishedAt: "b",
            fields: [],
            totalPackageBytes: 0,
            unexpectedDegradation: true,
            ...(outcome.error !== undefined ? { error: outcome.error } : {}),
          }),
      ),
    ).rejects.toThrow();
    expect(seenPayloads).toHaveLength(1);
  });
});
