import * as v from "valibot";
import { QuizOptionSchema, QuizTypeSchema, LiveQuizConfigSchema } from "live-quiz";

// Headmatter: liveQuiz config block (reuse from live-quiz engine)
export const SlidevLiveQuizConfigSchema = LiveQuizConfigSchema;
export type SlidevLiveQuizConfig = v.InferOutput<typeof SlidevLiveQuizConfigSchema>;

// Frontmatter: quiz question layout props
export const QuizFrontmatterSchema = v.object({
  quizId: v.pipe(v.string(), v.minLength(1)),
  question: v.string(),
  type: QuizTypeSchema,
  options: v.optional(v.array(QuizOptionSchema), []),
});
export type QuizFrontmatter = v.InferOutput<typeof QuizFrontmatterSchema>;

// Frontmatter: quiz results layout props
export const QuizResultsFrontmatterSchema = v.object({
  quizId: v.pipe(v.string(), v.minLength(1)),
  question: v.optional(v.string()),
  type: QuizTypeSchema,
  options: v.optional(v.array(QuizOptionSchema), []),
});
export type QuizResultsFrontmatter = v.InferOutput<typeof QuizResultsFrontmatterSchema>;
