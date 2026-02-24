/**
 * Shared types for the quiz engine.
 *
 * Used by QuizManager (client) and serverless functions (server).
 */

export interface VoteState {
  votes: Record<string, number>;
  total: number;
}

/** Question data broadcast from presenter to participants via sync. */
export interface QuestionPayload {
  quizId: string;
  question: string;
  options: { label: string; text: string }[];
}

export interface SyncPayload {
  activeQuizId: string | null;
  sessionId: string;
  results: Record<string, VoteState>;
  questions?: QuestionPayload[];
}

export interface AnswerPayload {
  quizId: string;
  answer: string;
  sessionId: string;
}

export interface QuizState {
  activeQuizId: string | null;
  results: Record<string, VoteState>;
  online: number;
  submitted: Record<string, string>;
  questions: QuestionPayload[];
}

export type StateCallback = (state: QuizState) => void;

/** Option shape used in data-quiz-options JSON. */
export interface QuizOption {
  label: string;
  text: string;
  correct?: boolean;
}
