/**
 * Shared types for the quiz engine.
 *
 * Used by QuizManager (client) and serverless functions (server).
 */

export interface VoteState {
  votes: Record<string, number>;
  total: number;
}

export interface SyncPayload {
  activeQuizId: string | null;
  sessionId: string;
  results: Record<string, VoteState>;
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
}

export type StateCallback = (state: QuizState) => void;

/** Option shape used in data-quiz-options JSON. */
export interface QuizOption {
  label: string;
  text: string;
  correct?: boolean;
}
