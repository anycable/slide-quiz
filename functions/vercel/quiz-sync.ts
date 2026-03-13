import { broadcastTo, jsonResponse, handle, SyncSchema, syncStream } from "./shared";

export default handle(
  SyncSchema,
  async ({ activeQuestionId, sessionId, quizGroupId, results, questions }) => {
    console.log("[quiz-sync]", { activeQuestionId, quizGroupId, questionCount: questions?.length });
    try {
      await broadcastTo(syncStream(quizGroupId), {
        activeQuestionId,
        sessionId,
        results,
        questions,
      });
      console.log("[quiz-sync] broadcast ok");
    } catch (err) {
      console.error("[quiz-sync] broadcast failed:", err);
      return jsonResponse({ error: "Broadcast failed" }, 502);
    }

    return jsonResponse({ ok: true });
  },
);
