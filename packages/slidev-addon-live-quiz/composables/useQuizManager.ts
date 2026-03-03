import { inject, shallowRef, readonly } from "vue";
import type { PresenterQuizManager, QuizState, QuestionPayload } from "live-quiz";
import type { SlidevLiveQuizConfig } from "../schemas";

// Module-level shared state (single subscription, reused by all components)
const registeredQuestions: QuestionPayload[] = [];
let registrationTimer: ReturnType<typeof setTimeout> | null = null;
let sharedState: ReturnType<typeof shallowRef<QuizState | null>> | null = null;
let subscribedManager: PresenterQuizManager | null = null;

function ensureSubscription(manager: PresenterQuizManager) {
  if (subscribedManager === manager) return;
  subscribedManager = manager;
  sharedState = shallowRef<QuizState | null>(manager.getState() ?? null);
  manager.subscribe((s) => { sharedState!.value = s; });
}

export function useQuizManager() {
  const manager = inject<PresenterQuizManager | null>("liveQuizManager", null);
  const config = inject<SlidevLiveQuizConfig | null>("liveQuizConfig", null);

  if (manager) ensureSubscription(manager);

  function registerQuestion(q: QuestionPayload) {
    if (!manager) return;
    if (registeredQuestions.some((r) => r.quizId === q.quizId)) return;
    registeredQuestions.push(q);

    // Debounce: all layouts mount within ~3s, batch setQuestions
    if (registrationTimer) clearTimeout(registrationTimer);
    registrationTimer = setTimeout(() => {
      manager.setQuestions([...registeredQuestions]);
    }, 100);
  }

  function setActive(quizId: string) {
    manager?.setActiveQuiz(quizId);
  }

  return {
    manager,
    config,
    state: readonly(sharedState ?? shallowRef(null)),
    registerQuestion,
    setActive,
  };
}
