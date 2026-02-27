/**
 * Shared schemas and types for the quiz engine.
 *
 * Schemas are the single source of truth — TypeScript types are derived
 * from them via v.InferOutput. Used by QuizManager (client) and
 * referenced by serverless functions (server).
 */
import * as v from "valibot";

// ── Boundary schemas (source of truth) ──

export const VoteStateSchema = v.object({
  votes: v.record(v.string(), v.number()),
  total: v.number(),
});
export type VoteState = v.InferOutput<typeof VoteStateSchema>;

export const QuestionPayloadSchema = v.object({
  quizId: v.string(),
  question: v.string(),
  options: v.array(v.object({ label: v.string(), text: v.string() })),
});
export type QuestionPayload = v.InferOutput<typeof QuestionPayloadSchema>;

export const SyncPayloadSchema = v.object({
  activeQuizId: v.nullable(v.string()),
  sessionId: v.string(),
  results: v.record(v.string(), VoteStateSchema),
  questions: v.optional(v.array(QuestionPayloadSchema)),
});
export type SyncPayload = v.InferOutput<typeof SyncPayloadSchema>;

export const AnswerPayloadSchema = v.object({
  quizId: v.string(),
  answer: v.string(),
  sessionId: v.string(),
});
export type AnswerPayload = v.InferOutput<typeof AnswerPayloadSchema>;

export const QuizOptionSchema = v.object({
  label: v.string(),
  text: v.string(),
  correct: v.optional(v.boolean()),
});
export type QuizOption = v.InferOutput<typeof QuizOptionSchema>;

/** Pipeline: JSON string → parsed array of quiz options. */
export const JsonQuizOptionsSchema = v.pipe(
  v.optional(v.string(), "[]"),
  v.rawTransform(({ dataset, addIssue, NEVER }) => {
    try {
      return JSON.parse(dataset.value);
    } catch {
      addIssue({ message: "Invalid JSON" });
      return NEVER;
    }
  }),
  v.array(QuizOptionSchema),
);

export const QuizEndpointsSchema = v.object({
  answer: v.string(),
  sync: v.string(),
});
export type QuizEndpoints = v.InferOutput<typeof QuizEndpointsSchema>;

// ── Internal types (no validation boundary) ──

export interface QuizState {
  activeQuizId: string | null;
  results: Record<string, VoteState>;
  online: number;
  submitted: Record<string, string>;
  questions: QuestionPayload[];
}

export type StateCallback = (state: QuizState) => void;
