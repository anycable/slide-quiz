import { broadcastTo, jsonResponse, handle, SyncSchema, syncStream } from "./shared.mts";

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
      console.error("[quiz-sync] broadcast failed:", err);
      return jsonResponse({ error: "Broadcast failed" }, 502);
    }

    return jsonResponse({ ok: true });
  },
);
