/**
 * Shared schemas and types for the quiz engine.
 *
 * Schemas are the single source of truth — TypeScript types are derived
 * from them via v.InferOutput. Used by QuizManager (client) and
 * referenced by serverless functions (server).
 */
import * as v from "valibot";

// ── Boundary schemas (source of truth) ──

export const QuizTypeSchema = v.optional(v.picklist(["choice", "text"]), "choice");
export type QuizType = v.InferOutput<typeof QuizTypeSchema>;

export const VoteStateSchema = v.object({
  votes: v.record(v.string(), v.number()),
  total: v.number(),
});
export type VoteState = v.InferOutput<typeof VoteStateSchema>;

export const QuestionPayloadSchema = v.object({
  quizId: v.string(),
  question: v.string(),
  type: QuizTypeSchema,
  options: v.optional(v.array(v.object({ label: v.string(), text: v.string() })), []),
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

// ── Constructor config schemas ──

export const QuizManagerConfigSchema = v.object({
  wsUrl: v.pipe(v.string(), v.minLength(1)),
  quizGroupId: v.pipe(v.string(), v.minLength(1)),
  sessionId: v.optional(v.string()),
  endpoints: v.optional(v.partial(QuizEndpointsSchema)),
});
export type QuizManagerConfig = v.InferOutput<typeof QuizManagerConfigSchema>;

export const ParticipantConfigSchema = v.object({
  wsUrl: v.pipe(v.string(), v.minLength(1)),
  quizGroupId: v.pipe(v.string(), v.minLength(1)),
  questions: v.optional(v.array(QuestionPayloadSchema)),
  endpoints: v.optional(v.partial(QuizEndpointsSchema)),
  brandText: v.optional(v.string()),
  footerText: v.optional(v.string()),
});
export type ParticipantConfig = v.InferOutput<typeof ParticipantConfigSchema>;

// ── sessionStorage schemas ──

export const PresenterStateSchema = v.object({
  activeQuizId: v.optional(v.nullable(v.string())),
  results: v.optional(v.record(v.string(), VoteStateSchema)),
  voters: v.optional(v.record(v.string(), v.array(v.string()))),
});

export const SubmittedAnswersSchema = v.record(v.string(), v.string());

// ── Internal types (no validation boundary) ──

export interface QuizState {
  activeQuizId: string | null;
  results: Record<string, VoteState>;
  online: number;
  submitted: Record<string, string>;
  questions: QuestionPayload[];
}

export type StateCallback = (state: QuizState) => void;

// ── Shared display computations ──

const MIN_FONT = 0.8;
const MAX_FONT = 3;

export interface WordSize {
  word: string;
  count: number;
  fontSize: number;
  isTop: boolean;
}

/** Compute font sizes for a word cloud from vote tallies. */
export function computeWordSizes(votes: Record<string, number>): WordSize[] {
  const entries = Object.entries(votes);
  if (entries.length === 0) return [];

  const maxCount = Math.max(...entries.map(([, c]) => c));
  return entries.map(([word, count]) => ({
    word,
    count,
    fontSize: maxCount > 1
      ? MIN_FONT + ((count - 1) / (maxCount - 1)) * (MAX_FONT - MIN_FONT)
      : (MIN_FONT + MAX_FONT) / 2,
    isTop: count === maxCount,
  }));
}

// ── Stream name builders ──

export function resultsStream(quizGroupId: string): string {
  return `quiz:${quizGroupId}:results`;
}

export function syncStream(quizGroupId: string): string {
  return `quiz:${quizGroupId}:sync`;
}
