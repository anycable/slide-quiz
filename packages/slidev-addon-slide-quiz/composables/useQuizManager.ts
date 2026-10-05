import { inject, shallowRef, readonly, onScopeDispose, computed } from "vue";
import type { Ref, ComputedRef } from "vue";
import * as engine from "slide-quiz";
import type { PresenterQuizManager, QuestionPayload } from "slide-quiz";
import { QUIZ_MANAGER_KEY, QUIZ_CONFIG_KEY } from "../injectionKeys";
import type { SlidevSlideQuizConfig } from "../schemas";

// Module-level state for question registration (survives HMR)
const registeredQuestions: QuestionPayload[] = [];
// quizIds registered by a quiz-results slide, which a quiz slide may replace
const fromResultsSlide = new Set<string>();
let registrationTimer: ReturnType<typeof setTimeout> | null = null;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    registeredQuestions.length = 0;
    fromResultsSlide.clear();
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

  /**
   * Register a question with the presenter. A results slide registers its
   * question too, so standalone results slides work; when both slides exist,
   * the quiz slide's definition wins whichever mounts first. Otherwise a
   * results slide without `type: multi` would make the engine count
   * multi-select answers as single choice.
   */
  function registerQuestion(q: QuestionPayload, { fromResults = false } = {}) {
    if (!manager) return;
    const idx = registeredQuestions.findIndex((r) => r.quizId === q.quizId);
    if (idx >= 0) {
      if (fromResults || !fromResultsSlide.has(q.quizId)) return;
      registeredQuestions[idx] = q;
      fromResultsSlide.delete(q.quizId);
    } else {
      registeredQuestions.push(q);
      if (fromResults) fromResultsSlide.add(q.quizId);
    }

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

// The engine exports these from 0.7. Read them by key so a build against 0.6
// still works; drop the fallbacks once the addon requires slide-quiz ^0.7.0.
const engineText = engine as unknown as Record<string, string | undefined>;
/** Shown on multi-select question slides. */
export const MULTI_HINT = engineText["MULTI_HINT"] ?? "Select all that apply";
/** Shown on multi-select results slides: the bars add up to more than 100%. */
export const MULTI_RESULTS_NOTE = engineText["MULTI_RESULTS_NOTE"] ?? `${MULTI_HINT} · % of respondents`;

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
