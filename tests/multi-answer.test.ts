import { describe, it, expect } from "vitest";
import * as v from "valibot";
import { MultiAnswerSchema, encodeMultiAnswer } from "../src/quiz-types";

describe("MultiAnswerSchema pipeline", () => {
  it("decodes a JSON array into sorted, unique labels", () => {
    expect(v.parse(MultiAnswerSchema, '["C","A","C"]')).toEqual(["A", "C"]);
  });

  it("rejects a plain choice answer", () => {
    expect(v.safeParse(MultiAnswerSchema, "A").success).toBe(false);
  });

  it("rejects an empty selection", () => {
    expect(v.safeParse(MultiAnswerSchema, "[]").success).toBe(false);
  });

  it("rejects non-string labels", () => {
    expect(v.safeParse(MultiAnswerSchema, "[1,2]").success).toBe(false);
  });
});

describe("encodeMultiAnswer", () => {
  it("produces the same string for the same selection in any order", () => {
    expect(encodeMultiAnswer(["B", "A"])).toBe(encodeMultiAnswer(["A", "B", "A"]));
  });

  it("round-trips through MultiAnswerSchema", () => {
    expect(v.parse(MultiAnswerSchema, encodeMultiAnswer(["D", "B"]))).toEqual(["B", "D"]);
  });
});
