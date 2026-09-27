/**
 * Dev-only mottak for måleprogrammets resultat (robusthet.md §6.4): «Lagre
 * på PC» på nettbrettet POSTer JSON-en hit, og filen havner i
 * `docs/research/maaleprogram-raadata/<tidsstempel>.json` på PC-en.
 *
 * Kun `vite dev` (koblet inn via `configureServer` i `vite.config.ts` —
 * finnes ikke i `vite build`/`preview` eller i produksjon). Mellomvaren er
 * bevisst trang:
 * - bare `POST` på nøyaktig `SAVE_ENDPOINT`;
 * - bare skjemaet `morild-maaleprogram/1` (grov formsjekk, ikke full validering);
 * - filnavnet lages HER fra serverens klokke — ingenting fra klienten inngår
 *   i stien — og sjekkes likevel mot katalogen (ingen path traversal);
 * - kroppen er begrenset til `MAX_BODY_BYTES`, og antall filer per
 *   serverlevetid til `MAX_SAVED_FILES` (`vite --host` = synlig på LAN).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_BODY_BYTES, MAX_SAVED_FILES, PROGRAM_SCHEMA, SAVE_ENDPOINT } from "../src/maaleprogram/constants.js";

export type PayloadVerdict =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly reason: string };

/** Godtar bare et objekt med `schema: "morild-maaleprogram/1"` og `runs`/`events` som lister. */
export function validateProgramPayload(body: unknown): PayloadVerdict {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, reason: "kroppen er ikke et JSON-objekt" };
  }
  const v = body as Record<string, unknown>;
  if (v["schema"] !== PROGRAM_SCHEMA) {
    return { ok: false, reason: `feil skjema: forventet «${PROGRAM_SCHEMA}»` };
  }
  if (!Array.isArray(v["runs"]) || !Array.isArray(v["events"])) {
    return { ok: false, reason: "runs/events mangler eller er ikke lister" };
  }
  return { ok: true, value: v };
}

/** `2026-09-27T14-03-09-123Z.json` — kun [0-9TZ-], trygt på Windows og i git. */
export function timestampFileName(date: Date): string {
  return `${date.toISOString().replace(/[:.]/g, "-")}.json`;
}

/**
 * Absolutt sti for `fileName` i `dir`, eller null hvis navnet ikke er et
 * rent filnavn eller stien havner utenfor katalogen (`..`, absolutte
 * stier, skråstreker, stasjonsbokstaver).
 */
export function resolveInsideDir(dir: string, fileName: string): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(fileName) || fileName.includes("..")) return null;
  const root = path.resolve(dir);
  const target = path.resolve(root, fileName);
  if (path.dirname(target) !== root) return null;
  const rel = path.relative(root, target);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return target;
}

export interface SinkDeps {
  /** Absolutt sti til `docs/research/maaleprogram-raadata`. */
  readonly targetDir: string;
  /** Visningssti i svaret (relativ til repo-roten). */
  readonly displayDir: string;
  readonly now?: () => Date;
  readonly writeFileImpl?: (file: string, data: string) => Promise<void>;
  readonly mkdirImpl?: (dir: string) => Promise<unknown>;
  readonly maxFiles?: number;
}

type Next = (err?: unknown) => void;

/**
 * Lesbar, men kompakt: innrykk for objekter, mens lister uten objekter i
 * (medlemstuplene — ~2 000 av dem) står på én linje hver. Trygt mot
 * klammer inne i strenger: en JSON-streng inneholder aldri et rått
 * linjeskift, så sammenslåingen endrer ingenting inni den.
 */
export function formatJson(value: unknown): string {
  const pretty = JSON.stringify(value, null, 1);
  const compact = pretty.replace(/\[[^[\]{}]*\]/g, (m) =>
    m.replace(/\n\s*/g, " ").replace(/^\[\s+/, "[").replace(/\s+\]$/, "]"),
  );
  return `${compact}\n`;
}

function send(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer | string) => {
      if (tooLarge) return;
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      size += buf.length;
      if (size > limit) {
        tooLarge = true;
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => resolve(tooLarge ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Connect-mellomvare for Vite (`server.middlewares.use`). */
export function createProgramSink(deps: SinkDeps) {
  const now = deps.now ?? (() => new Date());
  const write = deps.writeFileImpl ?? ((file: string, data: string) => writeFile(file, data, { encoding: "utf8", flag: "wx" }));
  const mk = deps.mkdirImpl ?? ((dir: string) => mkdir(dir, { recursive: true }));
  const maxFiles = deps.maxFiles ?? MAX_SAVED_FILES;
  let saved = 0;

  return async function programSink(req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> {
    const url = (req.url ?? "").split("?")[0];
    if (url !== SAVE_ENDPOINT) {
      next();
      return;
    }
    if (req.method !== "POST") {
      send(res, 405, { ok: false, error: "bare POST" });
      return;
    }
    if (saved >= maxFiles) {
      send(res, 429, { ok: false, error: `tak på ${maxFiles} filer nådd — start vite dev på nytt` });
      return;
    }
    try {
      const raw = await readBody(req, MAX_BODY_BYTES);
      if (raw === null) {
        send(res, 413, { ok: false, error: "for stor kropp" });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        send(res, 400, { ok: false, error: "ikke gyldig JSON" });
        return;
      }
      const verdict = validateProgramPayload(parsed);
      if (!verdict.ok) {
        send(res, 400, { ok: false, error: verdict.reason });
        return;
      }
      const fileName = timestampFileName(now());
      const target = resolveInsideDir(deps.targetDir, fileName);
      if (target === null) {
        send(res, 400, { ok: false, error: "ugyldig filsti" });
        return;
      }
      await mk(path.resolve(deps.targetDir));
      saved += 1;
      await write(target, formatJson(verdict.value));
      send(res, 200, { ok: true, path: `${deps.displayDir}/${fileName}` });
    } catch (err) {
      send(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  };
}
