import * as v from "valibot";
import { QuizOptionSchema, QuizTypeSchema, SlideQuizConfigSchema } from "slide-quiz";

// Headmatter: slideQuiz config block (reuse from slide-quiz engine)
export const SlidevSlideQuizConfigSchema = SlideQuizConfigSchema;
export type SlidevSlideQuizConfig = v.InferOutput<typeof SlidevSlideQuizConfigSchema>;

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
