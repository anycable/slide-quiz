import * as v from "valibot";
import { QuizOptionSchema, QuizTypeSchema, QuizEndpointsSchema } from "live-quiz";

// Headmatter: liveQuiz config block
export const SlidevLiveQuizConfigSchema = v.object({
  wsUrl: v.pipe(v.string(), v.minLength(1)),
  quizGroupId: v.pipe(v.string(), v.minLength(1)),
  quizUrl: v.optional(v.string()),
  endpoints: v.optional(v.partial(QuizEndpointsSchema)),
  titleText: v.optional(v.string()),
});
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
