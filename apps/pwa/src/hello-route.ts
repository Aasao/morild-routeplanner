/**
 * Starter rutemotor-Web Workeren (ADR-0002: ruteberegning kjører alltid på
 * klienten) og kjører golden-fiksturen "skjaeloy-skagen-apent" som et
 * "hello route"-bevis på at @morild/routing kan lastes og kjøres fra en
 * nettleser-Worker-kontekst.
 *
 * Midlertidig demo-kode — se docs/specs/app-skjelett.md §5.3. Erstattes av
 * en ekte "plan-route"-melding når bølge 2/3 kobler på nedlastede
 * vær-/farbarhetspakker. Meldingstypen under er strukturelt, ikke
 * nominelt, delt med `workers/routing.worker.ts` (den filen lever i et
 * eget TS-prosjekt med WebWorker-lib, se tsconfig.worker.json, og
 * importerer derfor ikke denne typen direkte — hold de to i synk manuelt
 * hvis formen endres).
 */
export interface HelloRouteOk {
  readonly type: "hello-route-result";
  readonly scenario: string;
  readonly purpose: string;
  readonly reached: boolean;
  readonly steps: readonly { readonly lat: number; readonly lon: number }[];
  readonly totals: { readonly durationS: number; readonly distanceNm: number };
}

export interface HelloRouteError {
  readonly type: "error";
  readonly message: string;
}

export type HelloRouteResult = HelloRouteOk | HelloRouteError;

export function runHelloRoute(): Promise<HelloRouteResult> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./workers/routing.worker.ts", import.meta.url), {
      type: "module",
    });

    worker.addEventListener("message", (event: MessageEvent<HelloRouteResult>) => {
      resolve(event.data);
      worker.terminate();
    });
    worker.addEventListener("error", (event: ErrorEvent) => {
      resolve({ type: "error", message: event.message });
      worker.terminate();
    });

    worker.postMessage({ type: "run-hello-route" });
  });
}
