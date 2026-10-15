import { broadcastTo, jsonResponse, handle, broadcastFailed, SyncSchema, syncStream } from "./shared.mts";

export default handle(
  SyncSchema,
  async ({ activeQuestionId, sessionId, quizGroupId, results, question, questionIndex, totalCount, seq }) => {
    console.log("[quiz-sync]", { activeQuestionId, quizGroupId, questionIndex, totalCount });
    try {
      await broadcastTo(syncStream(quizGroupId), {
        activeQuestionId,
        sessionId,
        results,
        question,
        questionIndex,
        totalCount,
        seq,
      });
      console.log("[quiz-sync] broadcast ok");
    } catch (err) {
      return broadcastFailed("[quiz-sync]", err);
    }

    return jsonResponse({ ok: true });
  },
);
