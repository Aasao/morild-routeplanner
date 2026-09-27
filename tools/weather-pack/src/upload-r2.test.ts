import { describe, expect, it } from "vitest";
import { pointerBlobs } from "./upload-r2.js";

const h = (c: string) => c.repeat(64);

describe("pointerBlobs (opplastingsmanifest fra pekeren)", () => {
  it("samler unike nøkler på tvers av fliser", () => {
    const pointer = {
      tiles: [
        { fields: [{ key: `weather/1/${h("a")}.bin`, hash: h("a") }] },
        {
          fields: [
            { key: `weather/1/${h("a")}.bin`, hash: h("a") },
            { key: `weather/1/${h("b")}.bin`, hash: h("b") },
          ],
        },
      ],
    };
    expect(pointerBlobs(pointer).map((b) => b.hash)).toEqual([h("a"), h("b")]);
  });

  it("nekter en peker uten fliser", () => {
    expect(() => pointerBlobs({ tiles: [] })).toThrow(/tom pakke/);
  });

  it("nekter en nøkkel som ikke stemmer med hashen", () => {
    const pointer = { tiles: [{ fields: [{ key: `weather/1/${h("a")}.bin`, hash: h("b") }] }] };
    expect(() => pointerBlobs(pointer)).toThrow(/stemmer ikke/);
  });
});
