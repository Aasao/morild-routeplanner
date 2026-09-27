/**
 * Laster en ferdig bygget værpakke fra `out/` opp til R2-speilet
 * (`docs/specs/vaerpakker.md` §5, ADR-0003, ADR-0006 pkt. 1).
 *
 * Rekkefølgen er hele poenget: **alle blober først, pekeren sist.** En
 * klient som henter pekeren midt i en opplasting skal aldri få en nøkkel som
 * ikke finnes ennå — innholdsadresseringen gjør blobene trygge å legge ut
 * før de er i bruk, pekeren er det eneste objektet som «slår om».
 *
 * Nekter å laste opp hvis en blob mangler lokalt eller ikke har hashen
 * pekeren sier (en halvskrevet `out/` skal ikke bli en halv pakke i R2).
 * Etter opplasting hentes pekeren og tre blober tilbake (to tilfeldige +
 * alltid den siste, jf. newline-fellen i agent-minnet) og sammenlignes
 * byte for byte — en opplasting som ikke kan leses tilbake feiler jobben.
 *
 * Bruker `wrangler r2 object bulk put` via `@morild/worker`s wrangler, så
 * lokal kjøring (wrangler-innlogging) og CI (`CLOUDFLARE_API_TOKEN` +
 * `CLOUDFLARE_ACCOUNT_ID`) går samme vei. Bøtte: `R2_BUCKET_NAME`, ellers
 * `morild-mirror`.
 *
 * Kjøres med `pnpm --filter @morild/weather-pack upload-r2`.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT_DIR = join(import.meta.dirname, "..", "out");
const POINTER_FILE = join(OUT_DIR, "pointer-vaer-skandinavia.json");
const POINTER_KEY = "pointer/vaer-skandinavia.json";
const BUCKET = process.env["R2_BUCKET_NAME"] ?? "morild-mirror";

interface PointerField {
  key: string;
  hash: string;
}

/** Alle `{key, hash}` pekeren refererer, uten duplikater. */
export function pointerBlobs(pointer: unknown): PointerField[] {
  const tiles = (pointer as { tiles?: { fields?: PointerField[] }[] }).tiles;
  if (!Array.isArray(tiles) || tiles.length === 0) {
    throw new Error("Pekeren har ingen fliser — nekter å laste opp en tom pakke.");
  }
  const byKey = new Map<string, PointerField>();
  for (const tile of tiles) {
    for (const f of tile.fields ?? []) {
      if (typeof f.key !== "string" || typeof f.hash !== "string") {
        throw new Error("Pekerfelt uten key/hash.");
      }
      if (!f.key.endsWith(`${f.hash}.bin`)) {
        throw new Error(`Nøkkel ${f.key} stemmer ikke med hash ${f.hash}.`);
      }
      byKey.set(f.key, { key: f.key, hash: f.hash });
    }
  }
  return [...byKey.values()];
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function wrangler(args: string[]): void {
  // `pnpm --filter … exec` kjører med CWD = apps/worker: alle stier må være
  // absolutte (agent-minnet, wrangler-r2-opplasting).
  const res = spawnSync(
    "pnpm",
    ["--filter", "@morild/worker", "exec", "wrangler", ...args],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
  if (res.status !== 0) {
    throw new Error(`wrangler ${args.slice(0, 3).join(" ")} feilet (kode ${res.status}).`);
  }
}

function fetchBack(key: string, dir: string): Uint8Array {
  const file = join(dir, key.replaceAll("/", "_"));
  wrangler(["r2", "object", "get", `${BUCKET}/${key}`, "--file", file, "--remote"]);
  return readFileSync(file);
}

function main(): void {
  if (!existsSync(POINTER_FILE)) {
    throw new Error(`Fant ikke ${POINTER_FILE} — kjør build-live først.`);
  }
  const pointerBytes = readFileSync(POINTER_FILE);
  const blobs = pointerBlobs(JSON.parse(pointerBytes.toString("utf8")));

  const manifest = blobs.map(({ key, hash }) => {
    const file = join(OUT_DIR, ...key.split("/"));
    if (!existsSync(file)) throw new Error(`Blob mangler lokalt: ${file}`);
    const actual = sha256(readFileSync(file));
    if (actual !== hash) throw new Error(`Hash-avvik for ${key}: fil har ${actual}.`);
    return { key, file };
  });
  console.log(`${manifest.length} blober verifisert lokalt mot pekeren → ${BUCKET}`);

  const tmp = mkdtempSync(join(tmpdir(), "morild-r2-"));
  const manifestFile = join(tmp, "manifest.json");
  writeFileSync(manifestFile, JSON.stringify(manifest));

  // Blober først …
  wrangler(["r2", "bulk", "put", BUCKET, "--filename", manifestFile, "--remote", "--force"]);
  // … pekeren sist.
  wrangler([
    "r2", "object", "put", `${BUCKET}/${POINTER_KEY}`,
    "--file", POINTER_FILE, "--content-type", "application/json", "--remote",
  ]);

  const last = manifest[manifest.length - 1]!;
  const samples = [
    manifest[Math.floor(Math.random() * manifest.length)]!,
    manifest[Math.floor(Math.random() * manifest.length)]!,
    last,
  ];
  for (const { key, file } of samples) {
    if (sha256(fetchBack(key, tmp)) !== sha256(readFileSync(file))) {
      throw new Error(`Stikkprøve feilet: ${key} i R2 er ikke lik lokal fil.`);
    }
  }
  if (sha256(fetchBack(POINTER_KEY, tmp)) !== sha256(pointerBytes)) {
    throw new Error("Stikkprøve feilet: pekeren i R2 er ikke lik lokal peker.");
  }
  console.log(`OK: ${manifest.length} blober + peker lastet opp, ${samples.length} blober + peker lest tilbake byte-identisk.`);
}

if (process.argv[1]?.endsWith("upload-r2.js")) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  }
}
