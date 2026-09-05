/**
 * packages/robustness — ensemble-aggregering og robusthetstall
 * (`docs/specs/robusthet.md`).
 *
 * Ren og deterministisk: ingen I/O, ingen klokke, ingen `Math.random`,
 * ingen `await`. Importerer kun `@morild/routing`, `@morild/geo` og
 * `@morild/protocol` (håndhevet av `tools/arch-tests`), og ALDRI
 * `variants.js`/`corridor.js` — robusthetstall kommer kun fra fulle søk
 * (D8.8).
 */
export * from "./outcome.js";
export * from "./estimators.js";
export * from "./traffic-light.js";
export * from "./summary.js";
export * from "./ranking.js";
export * from "./rerun.js";
