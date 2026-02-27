/**
 * live-quiz — Live audience quiz plugin for Reveal.js
 *
 * Usage:
 *   import Reveal from 'reveal.js';
 *   import RevealLiveQuiz from 'live-quiz';
 *   import 'live-quiz/style.css';
 *
 *   Reveal.initialize({
 *     plugins: [RevealLiveQuiz],
 *     liveQuiz: {
 *       wsUrl: 'wss://your-cable.fly.dev/cable',
 *       quizGroupId: 'my-talk',
 *       quizUrl: 'https://my-talk.example.com/quiz',
 *     }
 *   });
 */
import "./live-quiz.css";
import { createPlugin } from "./plugin";

export type { LiveQuizConfig } from "./plugin";
export type {
  QuizEndpoints,
  QuizState,
  VoteState,
  StateCallback,
  QuizOption,
} from "./quiz-types";
export {
  getQuizPresenter,
  getQuizParticipant,
  removeQuizPresenter,
  removeQuizParticipant,
  QuizManager,
  PresenterQuizManager,
  ParticipantQuizManager,
} from "./quiz-manager";
export { animateCount } from "./dom/animate";

export default createPlugin;
