import { broadcastTo, jsonResponse, handle, SyncSchema, syncStream } from "./shared";

export default handle(
  SyncSchema,
  async ({ activeQuestionId, sessionId, quizGroupId, results, questions }) => {
    try {
      await broadcastTo(syncStream(quizGroupId), {
        activeQuestionId,
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
