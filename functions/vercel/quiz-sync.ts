import { broadcastTo, jsonResponse, requirePost, requireString } from "./shared";

export default async function handler(req: Request) {
  const methodError = requirePost(req);
  if (methodError) return methodError;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { activeQuizId, sessionId, quizGroupId, results } = body;

  for (const [val, name] of [
    [sessionId, "sessionId"],
    [quizGroupId, "quizGroupId"],
  ] as const) {
    const err = requireString(val, name);
    if (err) return err;
  }

  try {
    await broadcastTo(`quiz:${quizGroupId}:sync`, {
      activeQuizId,
      sessionId,
      results,
    });
  } catch {
    return jsonResponse({ error: "Broadcast failed" }, 502);
  }

  return jsonResponse({ ok: true });
}
