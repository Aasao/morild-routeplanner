// Shared helpers for THREDDS spike scripts.
// No external dependencies — Node 18+ native fetch only.

export const UA = "morild-routeplanner-spike/0.1 maasao@gmail.com";

/**
 * Fetch a URL, measuring wall-clock time and downloaded bytes.
 * Returns { status, ok, ms, bytes, headers, text? , buffer? }
 */
export async function timedFetch(url, { asText = true } = {}) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  let bytes = 0;
  let text;
  let buffer;
  if (asText) {
    text = await res.text();
    bytes = Buffer.byteLength(text, "utf8");
  } else {
    const ab = await res.arrayBuffer();
    buffer = Buffer.from(ab);
    bytes = buffer.byteLength;
  }
  const ms = performance.now() - t0;
  return {
    status: res.status,
    ok: res.ok,
    ms,
    bytes,
    headers: Object.fromEntries(res.headers.entries()),
    text,
    buffer,
    url,
  };
}

export function fmtMs(ms) {
  return `${(ms / 1000).toFixed(2)} s`;
}

export function fmtBytes(bytes) {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** Be polite: sequential requests, small delay between them. */
export async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Append a JSON-lines record to a results log file. */
export async function logResult(fs, path, record) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...record }) + "\n";
  fs.appendFileSync(path, line, "utf8");
}
