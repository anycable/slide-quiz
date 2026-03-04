import { broadcastTo, jsonResponse, handle, SyncSchema, syncStream } from "./shared.mts";

export default handle(
  SyncSchema,
  async ({ activeQuizId, sessionId, quizGroupId, results, questions }) => {
    try {
      await broadcastTo(syncStream(quizGroupId), {
        activeQuizId,
        sessionId,
        results,
        questions,
      });
    } catch {
      return jsonResponse({ error: "Broadcast failed" }, 502);
    }

    return jsonResponse({ ok: true });
  },
);
