/**
 * slide-quiz — Live audience quiz plugin for Reveal.js
 *
 * Usage:
 *   import Reveal from 'reveal.js';
 *   import RevealSlideQuiz from 'slide-quiz';
 *   import 'slide-quiz/style.css';
 *
 *   Reveal.initialize({
 *     plugins: [RevealSlideQuiz],
 *     slideQuiz: {
 *       wsUrl: 'wss://your-cable.fly.dev/cable',
 *       quizGroupId: 'my-talk',
 *       quizUrl: 'https://my-talk.example.com/quiz',
 *     }
 *   });
 */
import "./slide-quiz.css";
import { createPlugin } from "./plugin";

export type { SlideQuizConfig } from "./plugin";
export { SlideQuizConfigSchema } from "./plugin";
export type {
  QuizEndpoints,
  QuizState,
  VoteState,
  QuizOption,
  QuizType,
  QuestionPayload,
  QuizManagerConfig,
  ParticipantConfig,
} from "./quiz-types";
export {
  QuizOptionSchema,
  QuizTypeSchema,
  QuizEndpointsSchema,
  QuizManagerConfigSchema,
  ParticipantConfigSchema,
  resultsStream,
  syncStream,
  computeWordSizes,
} from "./quiz-types";
export {
  getQuizPresenter,
  getQuizParticipant,
  removeQuizPresenter,
  QuizManager,
  PresenterQuizManager,
  ParticipantQuizManager,
} from "./quiz-manager";
export { animateCount } from "./dom/animate";

export default createPlugin;
