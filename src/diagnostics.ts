import * as v from "valibot";

const milliseconds = v.pipe(v.number(), v.finite(), v.minValue(0));
export const DiagnosticEventSchema = v.strictObject({
  version: v.literal(1),
  timestamp: milliseconds,
  event: v.picklist(["snapshot", "connection", "reconnect-scheduled", "handshake-timeout", "history-received", "history-unavailable", "sync-attempt", "sync-accepted", "sync-failed", "state-applied", "stale-state-dropped", "answer-sent", "answer-failed"]),
  role: v.picklist(["presenter", "participant", "unknown"]),
  clientId: v.pipe(v.string(), v.maxLength(100)),
  quizGroupId: v.pipe(v.string(), v.maxLength(200)),
  buildId: v.pipe(v.string(), v.maxLength(160)),
  connection: v.optional(v.picklist(["connecting", "connected", "disconnected", "closed"])),
  activeQuestionId: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(200)))),
  seq: v.optional(milliseconds),
  httpStatus: v.optional(v.pipe(v.number(), v.integer(), v.minValue(100), v.maxValue(599))),
  attempt: v.optional(milliseconds),
  delayMs: v.optional(milliseconds),
  elapsedMs: v.optional(milliseconds),
  stateAgeMs: v.optional(milliseconds),
});
export type DiagnosticEvent = v.InferOutput<typeof DiagnosticEventSchema>;
export type DiagnosticHandler = (event: DiagnosticEvent) => void | Promise<void>;
export const OnDiagnosticSchema = v.optional(v.custom<DiagnosticHandler>(x => typeof x === "function"));
export const BuildIdSchema = v.optional(v.pipe(v.string(), v.maxLength(160)));

export const DeliveryStateSchema = v.object({
  startedAt: v.nullable(milliseconds),
  pendingSince: v.nullable(milliseconds),
  lastAttemptAt: v.nullable(milliseconds),
  lastAcceptedAt: v.nullable(milliseconds),
  failures: milliseconds,
  sending: v.boolean(),
});
export type DeliveryState = v.InferOutput<typeof DeliveryStateSchema>;
export const INITIAL_DELIVERY: DeliveryState = { startedAt: null, pendingSince: null, lastAttemptAt: null, lastAcceptedAt: null, failures: 0, sending: false };

/** HTTP acceptance and a working socket do not prove delivery to every phone. */
export function deliveryHealth(state: DeliveryState, connection: string, now = Date.now()) {
  if (state.startedAt === null) return { status: "idle", message: "No question opened in this window" };
  if ([state.pendingSince, state.lastAttemptAt, state.lastAcceptedAt].some(time => time !== null && time > now + 1000))
    return { status: "warning", message: "Clock changed · delivery age unknown" };
  if (connection === "connecting" && now - state.startedAt < 10_000)
    return { status: "pending", message: "Connecting to quiz…" };
  if (connection !== "connected") return { status: "warning", message: "Quiz connection interrupted" };
  if (state.failures > 0) return { status: "warning", message: "Broadcast failed · retrying" };
  if (state.pendingSince !== null) return {
    status: now - state.pendingSince >= 10_000 ? "warning" : "pending",
    message: now - state.pendingSince >= 10_000 ? "Current state delayed · retrying" : "Sending current state…",
  };
  if (state.lastAcceptedAt === null) return { status: "pending", message: "Waiting for first broadcast" };
  const age = Math.max(0, now - state.lastAcceptedAt);
  if (age >= 90_000) return { status: "warning", message: `No accepted broadcast for ${Math.floor(age / 1000)}s` };
  return { status: "accepted", message: `Broadcast accepted ${Math.floor(age / 1000)}s ago · phone receipt unconfirmed` };
}
