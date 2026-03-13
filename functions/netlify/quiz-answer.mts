import { broadcastTo, jsonResponse, handle, AnswerSchema, resultsStream } from "./shared.mts";

export default handle(
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
