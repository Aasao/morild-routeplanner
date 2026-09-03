// Scenariotester for vern.mjs. Kjør: node .claude/hooks/vern.test.mjs
// Ligger med vilje utenfor pnpm test-globene (ikke domenekode).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const hook = join(here, "vern.mjs");
const BS = String.fromCharCode(92);
const bash = (command, extra = {}) => ({ tool_name: "Bash", tool_input: { command }, ...extra });
const ps = (command, extra = {}) => ({ tool_name: "PowerShell", tool_input: { command }, ...extra });
const sub = { agent_id: "a1", agent_type: "implementer" };

const cases = [
  // A: v1 er lesbar, ikke skrivbar
  ["les v1 (grep)", bash("grep -rn foo C:/RoutePlanner/src | head"), 0],
  ["les v1 (cat)", bash("cat C:/RoutePlanner/README.md"), 0],
  ["cp FRA v1 ok", bash("cp C:/RoutePlanner/polar.csv ./scratch/"), 0],
  ["cp TIL v1 (backslash)", bash(`cp x.csv C:${BS}RoutePlanner${BS}polar.csv`), 2],
  ["omdirigering til v1", bash("echo hi > /c/RoutePlanner/x.txt"), 2],
  ["omdirigering til v2 ok", bash("grep foo C:/RoutePlanner/a > C:/Utvikling/routeplanner-v2/out.txt"), 0],
  ["tee v1", bash("echo x | tee C:/RoutePlanner/y.txt"), 2],
  ["mkdir v1", bash("mkdir -p C:/RoutePlanner/new"), 2],
  ["sed -i v1", bash("sed -i s/a/b/ C:/RoutePlanner/a.ts"), 2],
  ["git log v1 ok", bash("git -C C:/RoutePlanner log --oneline -5"), 0],
  ["git checkout v1", bash("git -C C:/RoutePlanner checkout -- ."), 2],
  ["pnpm i v1", bash("pnpm -C C:/RoutePlanner install"), 2],
  ["v2-sti ok (rm)", bash("rm -f C:/Utvikling/routeplanner-v2/tmp.txt"), 0],
  ["ps Set-Content v1", ps(`Set-Content C:${BS}RoutePlanner${BS}x.txt hi`), 2],
  ["ps Copy-Item til v1", ps(`Copy-Item a.txt C:${BS}${BS}RoutePlanner${BS}${BS}a.txt`), 2],
  ["ps Get-Content ok", ps(`Get-Content C:${BS}RoutePlanner${BS}x.txt`), 0],
  // B: subagenter uten git-skriving, hovedsesjon upåvirket
  ["hoved git commit ok", bash("git commit -m x"), 0],
  ["hoved git stash (deny-liste tar den)", bash("git stash"), 0],
  ["sub git add+commit", bash("git add . && git commit -m x", sub), 2],
  ["sub git stash", bash("git stash", sub), 2],
  ["sub git push", bash("git push origin main", sub), 2],
  ["sub git -C worktree commit", bash("git -C ../wt commit -m x", sub), 2],
  ["sub git branch -d", bash("git branch -d foo", sub), 2],
  ["sub git branch --show-current ok", bash("git branch --show-current", sub), 0],
  ["sub git status/diff ok", bash("git status && git diff --stat", sub), 0],
  // øvrig
  ["annet verktøy ok", { tool_name: "Edit", tool_input: { file_path: "x" } }, 0],
];

let fail = 0;
for (const [name, input, want] of cases) {
  const r = spawnSync(process.execPath, [hook], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
  });
  const ok = r.status === want;
  if (!ok) fail++;
  const msg = r.stderr.split("\n")[0].slice(0, 70);
  console.log(`${ok ? "OK  " : "FEIL"} [${name}] exit=${r.status} vil=${want} ${msg}`);
}
// ugyldig JSON skal aldri blokkere (hooken skal feile åpent, ikke lukket)
const bad = spawnSync(process.execPath, [hook], { input: "ikke json", encoding: "utf8" });
if (bad.status !== 0) { fail++; console.log("FEIL [ugyldig json] exit=" + bad.status); } else console.log("OK   [ugyldig json] exit=0");

console.log(fail ? `\n${fail} feilet` : `\nalle ${cases.length + 1} grønne`);
process.exit(fail ? 1 : 0);
