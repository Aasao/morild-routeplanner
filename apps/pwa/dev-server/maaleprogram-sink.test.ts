import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createProgramSink, formatJson, resolveInsideDir, timestampFileName, validateProgramPayload } from "./maaleprogram-sink.js";
import { SAVE_ENDPOINT } from "../src/maaleprogram/constants.js";

const DIR = path.resolve("/repo/docs/research/maaleprogram-raadata");

function fakeReq(method: string, url: string, body: string): IncomingMessage {
  const stream = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage;
  (stream as { method?: string }).method = method;
  (stream as { url?: string }).url = url;
  return stream;
}

function fakeRes() {
  const state = { status: 0, body: "" };
  const res = {
    set statusCode(v: number) {
      state.status = v;
    },
    setHeader: () => undefined,
    end: (b: string) => {
      state.body = b;
    },
  } as unknown as ServerResponse;
  return { res, state };
}

function sink() {
  const writes: { file: string; data: string }[] = [];
  const handler = createProgramSink({
    targetDir: DIR,
    displayDir: "docs/research/maaleprogram-raadata",
    now: () => new Date("2026-09-27T14:03:09.123Z"),
    writeFileImpl: (file, data) => {
      writes.push({ file, data });
      return Promise.resolve();
    },
    mkdirImpl: () => Promise.resolve(),
  });
  return { handler, writes };
}

const valid = JSON.stringify({ schema: "morild-maaleprogram/1", runs: [], events: [] });

describe("mottaket for måleprogrammet (dev-only Vite-mellomvare)", () => {
  it("skriver et gyldig resultat under katalogen med tidsstempel som navn", async () => {
    const { handler, writes } = sink();
    const { res, state } = fakeRes();
    await handler(fakeReq("POST", SAVE_ENDPOINT, valid), res, () => undefined);
    expect(state.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.file).toBe(path.join(DIR, "2026-09-27T14-03-09-123Z.json"));
    expect(JSON.parse(state.body)).toEqual({
      ok: true,
      path: "docs/research/maaleprogram-raadata/2026-09-27T14-03-09-123Z.json",
    });
  });

  it("avviser feil skjema (også nettbrett-målingens) og skriver ingenting", async () => {
    for (const body of [
      JSON.stringify({ schema: "morild-nettbrett-maaling/1", runs: [], events: [] }),
      JSON.stringify({ runs: [], events: [] }),
      JSON.stringify([1, 2]),
      JSON.stringify({ schema: "morild-maaleprogram/1" }),
      "ikke json",
    ]) {
      const { handler, writes } = sink();
      const { res, state } = fakeRes();
      await handler(fakeReq("POST", SAVE_ENDPOINT, body), res, () => undefined);
      expect(state.status).toBe(400);
      expect(writes).toHaveLength(0);
    }
  });

  it("tak på antall filer per serverlevetid (vite --host = synlig på LAN)", async () => {
    const writes: string[] = [];
    let t = 0;
    const handler = createProgramSink({
      targetDir: DIR,
      displayDir: "docs/research/maaleprogram-raadata",
      now: () => new Date(Date.UTC(2026, 8, 27, 14, 0, 0, (t += 1))),
      writeFileImpl: (file) => {
        writes.push(file);
        return Promise.resolve();
      },
      mkdirImpl: () => Promise.resolve(),
      maxFiles: 2,
    });
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const { res, state } = fakeRes();
      await handler(fakeReq("POST", SAVE_ENDPOINT, valid), res, () => undefined);
      statuses.push(state.status);
    }
    expect(statuses).toEqual([200, 200, 429]);
    expect(writes).toHaveLength(2);
  });

  it("slipper andre stier videre og avviser andre metoder", async () => {
    const { handler, writes } = sink();
    let passed = false;
    await handler(fakeReq("POST", "/annet", valid), fakeRes().res, () => {
      passed = true;
    });
    expect(passed).toBe(true);
    const { res, state } = fakeRes();
    await handler(fakeReq("GET", SAVE_ENDPOINT, ""), res, () => undefined);
    expect(state.status).toBe(405);
    expect(writes).toHaveLength(0);
  });

  it("avviser stier utenfor katalogen", () => {
    for (const bad of [
      "../x.json",
      "..\\x.json",
      "../../etc/passwd.json",
      "/abs/x.json",
      "C:\\x.json",
      "sub/x.json",
      "sub\\x.json",
      "x.txt",
      ".json",
      "..json",
      "",
    ]) {
      expect(resolveInsideDir(DIR, bad), bad).toBeNull();
    }
    expect(resolveInsideDir(DIR, "2026-09-27T14-03-09-123Z.json")).toBe(path.join(DIR, "2026-09-27T14-03-09-123Z.json"));
  });

  it("tidsstempel-navnet er et rent filnavn", () => {
    const name = timestampFileName(new Date("2026-01-02T03:04:05.006Z"));
    expect(name).toBe("2026-01-02T03-04-05-006Z.json");
    expect(resolveInsideDir(DIR, name)).not.toBeNull();
  });

  it("formatJson: tupler på én linje, objekter med innrykk, tapsfritt", () => {
    const value = { runs: [{ members: [[1, null, 2.5], [2, 0, 3]] }], events: [{ detail: "a [b] {c}" }], empty: [] };
    const text = formatJson(value);
    expect(text).toContain("[1, null, 2.5]");
    expect(text).toContain("[2, 0, 3]");
    expect(JSON.parse(text)).toEqual(value);
  });

  it("validateProgramPayload: formsjekk", () => {
    expect(validateProgramPayload({ schema: "morild-maaleprogram/1", runs: [], events: [] }).ok).toBe(true);
    expect(validateProgramPayload(null).ok).toBe(false);
  });
});
