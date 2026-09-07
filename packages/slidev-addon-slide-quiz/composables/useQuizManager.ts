import { inject, shallowRef, readonly, onScopeDispose, computed } from "vue";
import type { Ref, ComputedRef } from "vue";
import type { PresenterQuizManager, QuestionPayload } from "slide-quiz";
import { QUIZ_MANAGER_KEY, QUIZ_CONFIG_KEY } from "../injectionKeys";
import type { SlidevSlideQuizConfig } from "../schemas";

// Module-level state for question registration (survives HMR)
const registeredQuestions: QuestionPayload[] = [];
let registrationTimer: ReturnType<typeof setTimeout> | null = null;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    registeredQuestions.length = 0;
  });
}

function useNanoStore<T>(store: { get(): T; subscribe(cb: (val: T) => void): () => void }): Readonly<Ref<T>> {
  const ref = shallowRef(store.get());
  const unsub = store.subscribe(v => { ref.value = v as typeof ref.value; });
  onScopeDispose(unsub);
  return readonly(ref) as Readonly<Ref<T>>;
}

export function useQuizManager() {
  const manager = inject(QUIZ_MANAGER_KEY, null);
  const config = inject(QUIZ_CONFIG_KEY, null);

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

  function clearActive() {
    manager?.clearActiveQuestion();
  }

  return {
    manager,
    config,
    configured: manager !== null,
    online: manager ? useNanoStore(manager.store.online) : readonly(shallowRef(0)),
    results: manager ? useNanoStore(manager.store.results) : readonly(shallowRef({})),
    registerQuestion,
    setActive,
    clearActive,
  };
}

/** Query parameter names the shipped public/quiz.html reads. Keep in sync with that file. */
export const QUIZ_URL_PARAMS = {
  wsUrl: "wsUrl",
  quizGroupId: "quizGroupId",
  answerEndpoint: "answer",
  syncEndpoint: "sync",
} as const;

/**
 * Build the audience page URL for the QR code. Carries everything the
 * participant widget needs so quiz.html works without its own config:
 * the cable URL, the group id, and custom endpoints (Vercel).
 */
export function buildQuizUrl(config: SlidevSlideQuizConfig, origin = window.location.origin): string | undefined {
  if (!config.quizUrl) return undefined;
  const url = new URL(config.quizUrl, origin);
  url.searchParams.set(QUIZ_URL_PARAMS.wsUrl, config.wsUrl);
  url.searchParams.set(QUIZ_URL_PARAMS.quizGroupId, config.quizGroupId);
  if (config.endpoints?.answer) url.searchParams.set(QUIZ_URL_PARAMS.answerEndpoint, config.endpoints.answer);
  if (config.endpoints?.sync) url.searchParams.set(QUIZ_URL_PARAMS.syncEndpoint, config.endpoints.sync);
  return url.toString();
}

/** The QR code URL plus a short host/path string for display under it. */
export function useQuizUrl(): { quizUrl: ComputedRef<string | undefined>; quizUrlDisplay: ComputedRef<string> } {
  const config = inject(QUIZ_CONFIG_KEY, null);
  const quizUrl = computed(() => (config ? buildQuizUrl(config) : undefined));
  const quizUrlDisplay = computed(() => {
    if (!config?.quizUrl) return "";
    const url = new URL(config.quizUrl, window.location.origin);
    return url.host + url.pathname;
  });
  return { quizUrl, quizUrlDisplay };
}
