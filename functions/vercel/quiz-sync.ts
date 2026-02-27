import { broadcastTo, jsonResponse, handle, SyncSchema } from "./shared";

export default handle(
  SyncSchema,
  async ({ activeQuizId, sessionId, quizGroupId, results, questions }) => {
    try {
      await broadcastTo(`quiz:${quizGroupId}:sync`, {
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
