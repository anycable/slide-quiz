import { broadcastTo, jsonResponse, handle, AnswerSchema, resultsStream } from "./shared.js";

const handler = handle(
  AnswerSchema,
  async ({ quizId, answer, sessionId, quizGroupId }) => {
    console.log("[quiz-answer]", { quizId, answer, quizGroupId });
    try {
      await broadcastTo(resultsStream(quizGroupId), {
        quizId,
        answer,
        sessionId,
      });
      console.log("[quiz-answer] broadcast ok");
    } catch (err) {
      console.error("[quiz-answer] broadcast failed:", err);
      return jsonResponse({ error: "Broadcast failed" }, 502);
    }

    return jsonResponse({ ok: true });
  },
);

// Vercel applies the Web Request/Response signature only to named method
// exports; a default export is treated as a Node (req, res) handler and the
// returned Response is ignored. GET is exported so the 405 comes from us.
export { handler as GET, handler as POST, handler as OPTIONS };
