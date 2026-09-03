// PreToolUse-hook (Bash/PowerShell) som håndhever to prosjektregler som
// permission-listene i settings.json ikke kan uttrykke:
//
//   A. Prinsipp 6 i CLAUDE.md: ingenting skrives til v1 (C:\RoutePlanner).
//      Deny-reglene dekker Edit/Write, men ikke omdirigering, cp/mv/rm,
//      tee, sed -i, git-skriving eller PowerShell-cmdlets fra skallet.
//   B. Subagenter kjører aldri git-skrivekommandoer (hovedsesjonen eier
//      git, jf. stash-kollisjonen 2026-09-03). Hook-input har `agent_id`
//      kun når kallet kommer fra en subagent.
//
// Exit 2 blokkerer kallet; meldingen på stderr vises til modellen. Exit 0
// = ingen mening, normal permission-flyt. Hooken er et vern, ikke en
// sandkasse: et node-/python-skript som selv åpner filer i v1 fanges ikke.
// Skrevet i Node fordi jq ikke finnes på Windows-maskinen.
//
// Test: node <scratchpad>/hooktest.mjs (se docs/03-modellruting.md).

import { readFileSync } from "node:fs";

// Treffer C:\RoutePlanner, C:/RoutePlanner, /c/RoutePlanner (alle
// skrivemåter), men IKKE C:\Utvikling\routeplanner-v2.
const V1 = /(?:^|[\s"'=(])(?:[A-Za-z]:[\\/]+|[\\/][a-z][\\/])RoutePlanner(?![\w-])/i;
const isV1 = (tok) => V1.test(" " + tok);

const GIT_READ = new Set([
  "log", "status", "diff", "show", "blame", "ls-files", "ls-tree", "grep",
  "rev-parse", "rev-list", "cat-file", "describe", "shortlog", "reflog",
  "fsck", "remote", "config", "version", "help", "count-objects", "name-rev",
]);
const GIT_WRITE = new Set([
  "commit", "push", "add", "rm", "mv", "tag", "merge", "rebase",
  "cherry-pick", "revert", "stash", "reset", "restore", "clean", "checkout",
  "switch", "am", "apply", "worktree", "pull", "fetch", "init", "notes",
  "filter-branch", "update-ref", "gc", "prune",
]);

function segments(cmd) {
  return cmd
    .split(/\s*(?:&&|\|\||;|\|)\s*|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function tokens(seg) {
  return seg.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
}
function gitSubcommand(toks) {
  // git [-C path] [--no-pager] [-c k=v] <sub> ...
  let i = 1;
  while (i < toks.length) {
    const t = toks[i];
    if (t === "-C" || t === "-c") {
      i += 2;
      continue;
    }
    if (t.startsWith("-")) {
      i += 1;
      continue;
    }
    return { sub: t, rest: toks.slice(i + 1) };
  }
  return { sub: "", rest: [] };
}

function checkV1(cmd) {
  if (!V1.test(cmd)) return null;
  const redirects = cmd.match(/>>?\s*&?\s*("[^"]+"|'[^']+'|\S+)/g) ?? [];
  for (const r of redirects) {
    if (isV1(r.replace(/^>>?\s*&?\s*/, ""))) return `omdirigering til v1: ${r}`;
  }
  for (const seg of segments(cmd)) {
    const toks = tokens(seg);
    if (toks.length === 0) continue;
    let head = toks[0].toLowerCase();
    if (head === "sudo") head = (toks[1] ?? "").toLowerCase();
    const anyV1 = toks.some(isV1);
    const lastV1 = isV1(toks[toks.length - 1]);
    if (["cp", "mv", "copy-item", "move-item", "install"].includes(head) && lastV1) {
      return `kopiering/flytting inn i v1: ${seg}`;
    }
    if (
      [
        "rm", "rmdir", "touch", "mkdir", "tee", "truncate", "chmod", "chown", "ln",
        "remove-item", "new-item", "set-content", "add-content", "out-file",
        "clear-content", "rename-item",
      ].includes(head) &&
      anyV1
    ) {
      return `skrivende kommando mot v1: ${seg}`;
    }
    if (head === "sed" && toks.some((t) => /^-[a-z]*i/.test(t)) && anyV1) {
      return `sed -i mot v1: ${seg}`;
    }
    if (head === "git" && anyV1) {
      const { sub } = gitSubcommand(toks);
      if (!GIT_READ.has(sub)) return `git-skriving i v1: ${seg}`;
    }
    if (["pnpm", "npm", "npx", "yarn", "corepack"].includes(head) && anyV1) {
      return `pakkeverktøy pekt mot v1: ${seg}`;
    }
  }
  return null;
}

function checkSubagentGit(cmd) {
  for (const seg of segments(cmd)) {
    const toks = tokens(seg);
    if (toks.length === 0) continue;
    if (toks[0].toLowerCase() !== "git") continue;
    const { sub, rest } = gitSubcommand(toks);
    if (GIT_WRITE.has(sub)) return `git ${sub}`;
    if (
      sub === "branch" &&
      rest.some((t) => /^-(d|D|m|M|f|-delete|-move|-force)/.test(t) || !t.startsWith("-"))
    ) {
      return "git branch (endrende form)";
    }
  }
  return null;
}

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}
const tool = input.tool_name ?? "";
if (tool !== "Bash" && tool !== "PowerShell") process.exit(0);
const cmd = String(input.tool_input?.command ?? "");
if (!cmd) process.exit(0);

const v1 = checkV1(cmd);
if (v1) {
  process.stderr.write(
    `BLOKKERT av .claude/hooks/vern.mjs — ${v1}\n` +
      "V1 (C:\\RoutePlanner) er skrivebeskyttet fasit (CLAUDE.md prinsipp 6). " +
      "Les derfra, skriv til v2-repoet eller scratchpad. Ikke omgå hooken — rapporter.\n",
  );
  process.exit(2);
}
if (input.agent_id) {
  const g = checkSubagentGit(cmd);
  if (g) {
    process.stderr.write(
      `BLOKKERT av .claude/hooks/vern.mjs — ${g} fra subagent «${input.agent_type ?? "?"}».\n` +
        "Subagenter kjører aldri git-skrivekommandoer; hovedsesjonen eier git " +
        "(docs/03-modellruting.md §Verktøy). Rapporter endringene dine som filer/diff i stedet.\n",
    );
    process.exit(2);
  }
}
process.exit(0);
