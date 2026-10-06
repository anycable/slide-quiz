import { inject, shallowRef, readonly, onScopeDispose, computed } from "vue";
import type { Ref, ComputedRef } from "vue";
import * as engine from "slide-quiz";
import type { PresenterQuizManager, QuestionPayload } from "slide-quiz";
import { QUIZ_MANAGER_KEY, QUIZ_CONFIG_KEY } from "../injectionKeys";
import type { SlidevSlideQuizConfig } from "../schemas";

// Module-level state for question registration (survives HMR)
interface Registration {
  question: QuestionPayload;
  /** Slide number, so questions keep deck order whatever order slides mount in */
  slideNo: number;
  /** Registered by a quiz-results slide, which a quiz slide may replace */
  fromResults: boolean;
}
const registrations: Registration[] = [];
let registrationTimer: ReturnType<typeof setTimeout> | null = null;
// The slide number that set the active question. On a slide change, the next
// slide's onSlideEnter may run before this slide's onSlideLeave; only the
// slide that set the question may clear it, or the audience page goes back
// to "Waiting" while the presenter is on a quiz slide.
let activeSlideNo: number | null = null;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    registrations.length = 0;
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
  function registerQuestion(question: QuestionPayload, slideNo: number, { fromResults = false } = {}) {
    if (!manager) return;
    const existing = registrations.find((r) => r.question.quizId === question.quizId);
    if (existing) {
      if (fromResults || !existing.fromResults) return;
      Object.assign(existing, { question, slideNo, fromResults });
    } else {
      registrations.push({ question, slideNo, fromResults });
    }

    // Debounce: all layouts mount within ~3s, batch setQuestions. Sort by
    // slide number: the slide on screen at load mounts first, and the
    // audience page numbers questions by their position in this list.
    if (registrationTimer) clearTimeout(registrationTimer);
    registrationTimer = setTimeout(() => {
      manager.setQuestions([...registrations].sort((a, b) => a.slideNo - b.slideNo).map((r) => r.question));
    }, 100);
  }

  /** Activate a question on behalf of the slide numbered `slideNo`. */
  function setActive(quizId: string, slideNo: number) {
    if (!manager) return;
    activeSlideNo = slideNo;
    manager.setActiveQuestion(quizId);
  }

  /** Clear the active question when slide `slideNo` is left, if that slide set it. */
  function clearActive(slideNo: number) {
    if (!manager || activeSlideNo !== slideNo) return;
    activeSlideNo = null;
    manager.clearActiveQuestion();
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
/** "1 response", "12 responses": the total under results. */
export const responsesText =
  ((engine as unknown as Record<string, unknown>)["responsesText"] as ((total: number) => string) | undefined) ??
  ((total: number) => `${total} ${total === 1 ? "response" : "responses"}`);

/** Query parameter names the shipped public/quiz.html reads. Keep in sync with that file. */
export const QUIZ_URL_PARAMS = {
  wsUrl: "wsUrl",
  quizGroupId: "quizGroupId",
  answerEndpoint: "answer",
  syncEndpoint: "sync",
  accent: "accent",
} as const;

/**
 * Build the audience page URL for the QR code. Carries everything the
 * participant widget needs so quiz.html works without its own config:
 * the cable URL, the group id, custom endpoints (Vercel), and the deck's
 * accent colour so the audience page matches the slides.
 */
export function buildQuizUrl(
  config: SlidevSlideQuizConfig,
  origin = window.location.origin,
  accent?: string,
): string | undefined {
  if (!config.quizUrl) return undefined;
  const url = new URL(config.quizUrl, origin);
  url.searchParams.set(QUIZ_URL_PARAMS.wsUrl, config.wsUrl);
  url.searchParams.set(QUIZ_URL_PARAMS.quizGroupId, config.quizGroupId);
  if (config.endpoints?.answer) url.searchParams.set(QUIZ_URL_PARAMS.answerEndpoint, config.endpoints.answer);
  if (config.endpoints?.sync) url.searchParams.set(QUIZ_URL_PARAMS.syncEndpoint, config.endpoints.sync);
  if (accent) url.searchParams.set(QUIZ_URL_PARAMS.accent, accent);
  return url.toString();
}

/** The QR code URL plus a short host/path string for display under it. */
export function useQuizUrl(): { quizUrl: ComputedRef<string | undefined>; quizUrlDisplay: ComputedRef<string> } {
  const config = inject(QUIZ_CONFIG_KEY, null);
  // --sq-accent is set by styles/index.css, or by the deck's own CSS
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--sq-accent").trim();
  const quizUrl = computed(() => (config ? buildQuizUrl(config, window.location.origin, accent || undefined) : undefined));
  const quizUrlDisplay = computed(() => {
    if (!config?.quizUrl) return "";
    const url = new URL(config.quizUrl, window.location.origin);
    return url.host + url.pathname;
  });
  return { quizUrl, quizUrlDisplay };
}
