// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// AnyCable is down: every broadcast fails the way a wrong URL or key does
vi.mock("@anycable/serverless-js", () => ({
  broadcaster: () => async () => {
    throw new Error("connect ECONNREFUSED");
  },
}));

const SECRET_URL = "https://cable.internal.example/_broadcast?token=s3cret";

describe("serverless functions when the broadcast fails", () => {
  const errors: unknown[][] = [];
  beforeAll(() => {
    process.env.ANYCABLE_BROADCAST_URL = SECRET_URL;
    vi.spyOn(console, "error").mockImplementation((...args) => { errors.push(args); });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterAll(() => {
    delete process.env.ANYCABLE_BROADCAST_URL;
    vi.restoreAllMocks();
  });

  const answer = { quizId: "q1", answer: "A", sessionId: "s1", quizGroupId: "g1" };
  const sync = { activeQuestionId: "q1", sessionId: "s1", quizGroupId: "g1", results: {} };
  const cases = [
    ["netlify quiz-answer", async () => (await import("../functions/netlify/quiz-answer.mts")).default, answer],
    ["netlify quiz-sync", async () => (await import("../functions/netlify/quiz-sync.mts")).default, sync],
    ["vercel quiz-answer", async () => (await import("../functions/vercel/quiz-answer")).POST, answer],
    ["vercel quiz-sync", async () => (await import("../functions/vercel/quiz-sync")).POST, sync],
  ] as const;

  for (const [name, load, body] of cases) {
    it(`${name} answers 502 naming the settings, and logs the URL only on the server`, async () => {
      const handler = (await load()) as (req: Request) => Promise<Response>;
      errors.length = 0;
      const res = await handler(new Request("https://deck.example/fn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }));
      expect(res.status).toBe(502);
      const text = await res.text();
      expect(text).toContain("ANYCABLE_BROADCAST_URL");
      expect(text).not.toContain("cable.internal.example");
      expect(text).not.toContain("s3cret");
      expect(errors.flat().join(" ")).toContain(SECRET_URL);
    });
  }
});
