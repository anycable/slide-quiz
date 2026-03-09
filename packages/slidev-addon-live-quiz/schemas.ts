import * as v from "valibot";
import { QuizOptionSchema, QuizTypeSchema, LiveQuizConfigSchema } from "live-quiz";

// Headmatter: liveQuiz config block (reuse from live-quiz engine)
export const SlidevLiveQuizConfigSchema = LiveQuizConfigSchema;
export type SlidevLiveQuizConfig = v.InferOutput<typeof SlidevLiveQuizConfigSchema>;

/** Type-only schema for quiz layout frontmatter. Not validated at runtime — layouts check props directly. */
export const QuizFrontmatterSchema = v.object({
  quizId: v.pipe(v.string(), v.minLength(1)),
  question: v.string(),
  type: QuizTypeSchema,
  options: v.optional(v.array(QuizOptionSchema), []),
});
export type QuizFrontmatter = v.InferOutput<typeof QuizFrontmatterSchema>;

/** Type-only schema for quiz results layout frontmatter. Not validated at runtime — layouts check props directly. */
export const QuizResultsFrontmatterSchema = v.object({
  quizId: v.pipe(v.string(), v.minLength(1)),
  question: v.optional(v.string()),
  type: QuizTypeSchema,
  options: v.optional(v.array(QuizOptionSchema), []),
});
export type QuizResultsFrontmatter = v.InferOutput<typeof QuizResultsFrontmatterSchema>;
