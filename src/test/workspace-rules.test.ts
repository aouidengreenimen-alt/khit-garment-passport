import { describe, it, expect } from "vitest";
import { makeProduct, shipLot } from "@/lib/api";
describe("workspace mock rules", () => {
  it("refuses more out than in", async () => {
    await expect(makeProduct({ inputs: [{ lot: 3, kg: 50 }], step: "sewing", product: "x", reference: "r", pieces: 1, kg: 51 })).rejects.toThrow("More out than in");
  });
  it("refuses shipping more than the lot holds", async () => {
    await expect(shipLot({ lot: 3, to: "0x", kg: 61, reference: "BL" })).rejects.toThrow("More than this lot holds");
  });
});
