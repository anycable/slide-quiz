import { inject, shallowRef, readonly } from "vue";
import type { PresenterQuizManager, QuizState, QuestionPayload } from "slide-quiz";
import { QUIZ_MANAGER_KEY, QUIZ_CONFIG_KEY } from "../injectionKeys";

// Module-level shared state (single subscription, reused by all components)
const registeredQuestions: QuestionPayload[] = [];
let registrationTimer: ReturnType<typeof setTimeout> | null = null;
let sharedState: ReturnType<typeof shallowRef<QuizState | null>> | null = null;
let subscribedManager: PresenterQuizManager | null = null;

function ensureSubscription(manager: PresenterQuizManager) {
  if (subscribedManager === manager) return;
  subscribedManager = manager;
  sharedState = shallowRef<QuizState | null>(manager.getState() ?? null);
  const unsub = manager.subscribe((s) => { sharedState!.value = s; });

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      unsub?.();
      subscribedManager = null;
      sharedState = null;
      registeredQuestions.length = 0;
    });
  }
}

export function useQuizManager() {
  const manager = inject(QUIZ_MANAGER_KEY, null);
  const config = inject(QUIZ_CONFIG_KEY, null);
  const configured = manager !== null;

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
    manager?.setActiveQuestion(quizId);
  }

  return {
    manager,
    config,
    configured,
    state: readonly(sharedState ?? shallowRef(null)),
    registerQuestion,
    setActive,
  };
}
