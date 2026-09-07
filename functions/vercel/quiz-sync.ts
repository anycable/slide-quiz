import { broadcastTo, jsonResponse, handle, SyncSchema, syncStream } from "./shared.js";

const handler = handle(
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

// Vercel applies the Web Request/Response signature only to named method
// exports; a default export is treated as a Node (req, res) handler and the
// returned Response is ignored. GET is exported so the 405 comes from us.
export { handler as GET, handler as POST, handler as OPTIONS };
