import { broadcastTo, jsonResponse, handle, AnswerSchema } from "./shared";

export default handle(
  AnswerSchema,
  async ({ quizId, answer, sessionId, quizGroupId }) => {
    try {
      await broadcastTo(`quiz:${quizGroupId}:results`, {
        quizId,
        answer,
        sessionId,
      });
    } catch {
      return jsonResponse({ error: "Broadcast failed" }, 502);
    }

    return jsonResponse({ ok: true });
  },
);
