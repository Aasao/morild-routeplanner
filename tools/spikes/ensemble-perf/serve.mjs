#!/usr/bin/env node
/**
 * Nulldependency statisk server for spike-mappen — kun for lokal måling,
 * aldri for produksjon (se README.md i denne mappen).
 *
 * v2-motoren (packages/routing) og @morild/geo kompileres av `pnpm check`
 * til vanlig ESM med relative imports internt, men routing-pakken importerer
 * `@morild/geo` som en *bar* spesifikator (`import { haversineNm } from
 * "@morild/geo"`) — det virker i Node (pnpm-workspace-symlinker) og i en
 * bundler, men ikke i en nettleser uten importmap eller bundling. Denne
 * serveren gjør det tredje alternativet i stedet: server er en tynn proxy
 * som *skriver om* akkurat den ene bar-spesifikatoren når den serverer
 * routing-filene, slik at nettleseren aldri ser noe annet enn ordinære
 * relative ES-modul-imports. Ingen bundler, ingen nye avhengigheter — bare
 * tekstsubstitusjon på filer som allerede er kompilert av `tsc -b`.
 *
 * @morild/protocol er ALDRI en verdi-import i routing eller charts (kun
 * `import type`, som fjernes av kompilatoren) — derfor trengs ingen
 * tilsvarende proxy for den. @morild/charts importerer også `@morild/geo`
 * som verdi (bearing/haversineNm) og får samme omskriving som routing.
 * @morild/geo sine egne dist-filer har ingen bar-spesifikatorer i det hele
 * tatt (kun relative imports) og trenger derfor ingen omskriving.
 *
 * Kjør: `node tools/spikes/ensemble-perf/serve.mjs [port]` (bygg pakkene
 * først med `pnpm check` eller `pnpm -w exec tsc -b`).
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SPIKE_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(SPIKE_DIR, "..", "..", "..");
const PORT = Number(process.argv[2]) || 8787;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".gz": "application/gzip",
};

/** Bare-spesifikatoren routing-dist-filene importerer, skrevet om til en ordinær relativ URL serveren selv ruter (`/engine/geo/...`). */
function rewriteBareSpecifiers(source) {
  return source.replace(/(['"])@morild\/geo\1/g, '$1/engine/geo/index.js$1');
}

/** Hindrer `..`-utbrudd fra URL-en — alt løses relativt til en fast rot. */
function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath);
  // `root` kan komme inn med eller uten avsluttende skilletegn (f.eks.
  // `fileURLToPath(new URL(".", …))` gir alltid ett) — normaliser bort det
  // FØR sammenligningen, ellers dobles skilletegnet og ekte, gyldige stier
  // blir avvist som «rømt».
  const normalizedRoot = normalize(root).replace(/[\\/]+$/, "");
  const resolved = normalize(join(normalizedRoot, decoded));
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + sep)) {
    throw new Error("path escapes root");
  }
  return resolved;
}

/**
 * `/engine/routing/` peker på HELE `dist/` (ikke bare `dist/src`), fordi
 * `test-fixtures/*.js` importerer motoren med `../src/index.js` — en
 * relativ sti som må løses likt i URL-rommet som på disk. Entry-punktet er
 * derfor `/engine/routing/src/index.js`, fikstyrene
 * `/engine/routing/test-fixtures/golden-scenarios.js` osv.
 */
const ENGINE_ROUTES = [
  // [urlPrefix, diskDir, rewrite?]
  ["/engine/geo/", join(REPO_ROOT, "packages", "geo", "dist"), false],
  ["/engine/routing/", join(REPO_ROOT, "packages", "routing", "dist"), true],
  ["/engine/charts/", join(REPO_ROOT, "packages", "charts", "dist"), true],
  ["/testdata/", join(REPO_ROOT, "packages", "charts", "testdata"), false],
];

async function serveFile(res, diskPath, rewrite) {
  const ext = extname(diskPath);
  const contentType = MIME[ext] ?? "application/octet-stream";
  const body = await readFile(diskPath, rewrite ? "utf8" : undefined);
  const out = rewrite ? rewriteBareSpecifiers(body) : body;
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    ...(ext === ".gz" ? { "Content-Encoding": "gzip", "Content-Type": "application/json; charset=utf-8" } : {}),
  });
  res.end(out);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    let pathname = url.pathname;
    if (pathname === "/") pathname = "/index.html";

    for (const [prefix, dir, rewrite] of ENGINE_ROUTES) {
      if (pathname.startsWith(prefix)) {
        const rest = pathname.slice(prefix.length);
        const diskPath = safeJoin(dir, rest);
        const st = await stat(diskPath).catch(() => undefined);
        if (!st || !st.isFile()) {
          res.writeHead(404).end(`ikke funnet: ${pathname}`);
          return;
        }
        await serveFile(res, diskPath, rewrite);
        return;
      }
    }

    // Statiske filer i selve spike-mappen (index.html, v2-engine.html, …).
    const diskPath = safeJoin(SPIKE_DIR, pathname);
    const st = await stat(diskPath).catch(() => undefined);
    if (!st || !st.isFile()) {
      res.writeHead(404).end(`ikke funnet: ${pathname}`);
      return;
    }
    await serveFile(res, diskPath, false);
  } catch (err) {
    res.writeHead(500).end(`serverfeil: ${err?.message ?? err}`);
  }
});

// Bind lokalt som standard; nettbrett-målingen trenger LAN-tilgang og
// startes eksplisitt med HOST=0.0.0.0 (serveren er da synlig på nettet
// så lenge den kjører — kun lesing, men stopp den etter målingen).
const HOST = process.env.HOST ?? "127.0.0.1";
server.listen(PORT, HOST, () => {
  console.log(`RoutePlanner v2 — ensemble-perf-spike på http://localhost:${PORT}/ (bundet til ${HOST})`);
  if (HOST === "127.0.0.1") {
    console.log(`  Nettbrett-måling? Start med: HOST=0.0.0.0 node serve.mjs — og bruk PC-ens LAN-IP fra nettbrettet.`);
  }
  console.log(`  v1-spike (referanse):      http://localhost:${PORT}/index.html`);
  console.log(`  v2-motor (instrumentert):  http://localhost:${PORT}/v2-engine.html`);
  console.log(`  Ekte-maske-mikrobench:     http://localhost:${PORT}/mikrobench.html`);
  console.log(`Bygg pakkene først med "pnpm check" hvis dette er første kjøring.`);
});
