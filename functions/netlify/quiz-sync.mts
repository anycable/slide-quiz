import { broadcastTo, jsonResponse, handle, BROADCAST_FAILED, BROADCAST_URL_FOR_LOGS, SyncSchema, syncStream } from "./shared.mts";

export default handle(
  SyncSchema,
  async ({ activeQuestionId, sessionId, quizGroupId, results, question, questionIndex, totalCount }) => {
    console.log("[quiz-sync]", { activeQuestionId, quizGroupId, questionIndex, totalCount });
    try {
      await broadcastTo(syncStream(quizGroupId), {
        activeQuestionId,
        sessionId,
        results,
        question,
        questionIndex,
        totalCount,
      });
      console.log("[quiz-sync] broadcast ok");
    } catch (err) {
      console.error("[quiz-sync] broadcast to", BROADCAST_URL_FOR_LOGS, "failed:", err);
      return jsonResponse({ error: BROADCAST_FAILED }, 502);
    }

    return jsonResponse({ ok: true });
  },
);
