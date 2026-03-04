import { describe, it, expect } from "vitest";
import * as v from "valibot";
import { JsonQuizOptionsSchema } from "../src/quiz-types";

describe("JsonQuizOptionsSchema pipeline", () => {
  it("parses valid JSON array of options", () => {
    const input = '[{"label":"A","text":"Red"},{"label":"B","text":"Blue"}]';
    const result = v.parse(JsonQuizOptionsSchema, input);
    expect(result).toEqual([
      { label: "A", text: "Red" },
      { label: "B", text: "Blue" },
    ]);
  });

  it("includes optional correct field", () => {
    const input = '[{"label":"A","text":"Yes","correct":true}]';
    const result = v.parse(JsonQuizOptionsSchema, input);
    expect(result[0].correct).toBe(true);
  });

  it("defaults to empty array when undefined", () => {
    const result = v.parse(JsonQuizOptionsSchema, undefined);
    expect(result).toEqual([]);
  });

  it("rejects invalid JSON", () => {
    const result = v.safeParse(JsonQuizOptionsSchema, "not-json{{{");
    expect(result.success).toBe(false);
  });

  it("rejects valid JSON that isn't an array of options", () => {
    const result = v.safeParse(JsonQuizOptionsSchema, '{"key":"value"}');
    expect(result.success).toBe(false);
  });

  it("rejects array with missing required fields", () => {
    const result = v.safeParse(JsonQuizOptionsSchema, '[{"label":"A"}]');
    expect(result.success).toBe(false);
  });
});
