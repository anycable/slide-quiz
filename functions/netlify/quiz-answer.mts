import { broadcastTo, jsonResponse, handle, broadcastFailed, AnswerSchema, resultsStream } from "./shared.mts";

export default handle(
  AnswerSchema,
  async ({ quizId, answer, sessionId, quizGroupId, seq }) => {
    console.log("[quiz-answer]", { quizId, answer, quizGroupId });
    try {
      await broadcastTo(resultsStream(quizGroupId), {
        quizId,
        answer,
        sessionId,
        seq,
      });
      console.log("[quiz-answer] broadcast ok");
    } catch (err) {
      return broadcastFailed("[quiz-answer]", err);
    }

    return jsonResponse({ ok: true });
  },
);
