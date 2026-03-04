import { describe, it, expect } from "vitest";
import { computeWordSizes } from "../src/quiz-types";

describe("computeWordSizes", () => {
  it("returns empty array for empty votes", () => {
    expect(computeWordSizes({})).toEqual([]);
  });

  it("uses midpoint font size when maxCount is 1", () => {
    const result = computeWordSizes({ hello: 1 });
    expect(result).toHaveLength(1);
    expect(result[0].word).toBe("hello");
    expect(result[0].count).toBe(1);
    expect(result[0].fontSize).toBeCloseTo(1.9); // (0.8 + 3) / 2
    expect(result[0].isTop).toBe(true);
  });

  it("gives max font when all words have the same count > 1", () => {
    // When maxCount > 1, (count-1)/(maxCount-1) = 1 for all → MAX_FONT
    const result = computeWordSizes({ a: 3, b: 3, c: 3 });
    for (const w of result) {
      expect(w.fontSize).toBe(3);
      expect(w.isTop).toBe(true);
    }
  });

  it("scales linearly between MIN_FONT and MAX_FONT", () => {
    const result = computeWordSizes({ low: 1, mid: 3, high: 5 });
    const byWord = Object.fromEntries(result.map((w) => [w.word, w]));

    // low: count=1, (1-1)/(5-1)=0 → MIN_FONT
    expect(byWord.low.fontSize).toBe(0.8);
    // high: count=5, (5-1)/(5-1)=1 → MAX_FONT
    expect(byWord.high.fontSize).toBe(3);
    // mid: count=3, (3-1)/(5-1)=0.5 → midpoint
    expect(byWord.mid.fontSize).toBeCloseTo(1.9);
  });

  it("marks only the top-count words as isTop", () => {
    const result = computeWordSizes({ a: 1, b: 5, c: 5, d: 3 });
    const byWord = Object.fromEntries(result.map((w) => [w.word, w]));

    expect(byWord.a.isTop).toBe(false);
    expect(byWord.b.isTop).toBe(true);
    expect(byWord.c.isTop).toBe(true);
    expect(byWord.d.isTop).toBe(false);
  });

  it("preserves word and count in output", () => {
    const result = computeWordSizes({ react: 10, vue: 7 });
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ word: "react", count: 10 }),
        expect.objectContaining({ word: "vue", count: 7 }),
      ]),
    );
  });
});
