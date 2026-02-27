/**
 * Reveal.js Live Quiz plugin core.
 *
 * Scans slides for data-quiz-id / data-quiz-results attributes,
 * injects DOM, listens to slidechanged, and bridges state from QuizManager.
 */
import * as v from "valibot";
import type { QuizEndpoints, QuestionPayload, PresenterQuizManager } from "./quiz-manager";
import { getQuizPresenter, removeQuizPresenter } from "./quiz-manager";
import { animateCount } from "./dom/animate";
import { renderQuestion } from "./dom/render-question";
import { renderResults, updateResultBars, animateResultBars } from "./dom/render-results";

const LiveQuizConfigSchema = v.object({
  wsUrl: v.pipe(v.string(), v.minLength(1)),
  quizGroupId: v.pipe(v.string(), v.minLength(1)),
  quizUrl: v.optional(v.string()),
  endpoints: v.optional(v.object({
    answer: v.optional(v.string()),
    sync: v.optional(v.string()),
  })),
  titleText: v.optional(v.string()),
});

export interface LiveQuizConfig {
  /** AnyCable WebSocket URL */
  wsUrl: string;
  /** Unique ID grouping quizzes in this talk */
  quizGroupId: string;
  /** URL for the audience quiz page (shown as QR code) */
  quizUrl?: string;
  /** Custom endpoint URLs for answer/sync functions */
  endpoints?: Partial<QuizEndpoints>;
  /** Title shown on quiz slides (default: "Pop quiz!") */
  titleText?: string;
}

// Minimal Reveal.js API surface we need (avoids hard dep on reveal.js types)
interface RevealApi {
  getConfig(): Record<string, unknown>;
  getRevealElement(): HTMLElement;
  on(event: string, cb: (...args: unknown[]) => void): void;
  off(event: string, cb: (...args: unknown[]) => void): void;
  sync(): void;
}

export function createPlugin() {
  let deck: RevealApi | null = null;
  let config: LiveQuizConfig;
  let manager: PresenterQuizManager | null = null;
  let unsubscribe: (() => void) | null = null;

  // Track which results slides have been animated
  const animatedResults = new Set<string>();

  // ── Event Handlers ──

  function onSlideChanged(event: unknown) {
    if (!manager) return;
    const { currentSlide: slide } = event as { currentSlide: HTMLElement };

    // Quiz question slide — activate it
    const quizId = slide.dataset.quizId;
    if (quizId) {
      manager.setActiveQuiz(quizId);
    }

    // Quiz results slide — animate bars on first visit
    const resultsId = slide.dataset.quizResults;
    if (resultsId && !animatedResults.has(resultsId)) {
      animatedResults.add(resultsId);
      const wrapper = slide.querySelector<HTMLElement>(`[data-lq-quiz="${resultsId}"]`);
      if (wrapper) {
        const state = manager.getQuizState(resultsId);
        animateResultBars(wrapper, state);
      }
    }
  }

  function onStateChange() {
    if (!manager || !deck) return;
    const state = manager.getState();
    const revealEl = deck.getRevealElement();

    // Update online counters
    for (const el of revealEl.querySelectorAll<HTMLElement>(".lq-online")) {
      animateCount(el, state.online);
    }

    // Update answered counters and result bars
    for (const [quizId, quizState] of Object.entries(state.results)) {
      for (const el of revealEl.querySelectorAll<HTMLElement>(
        `.lq-answered[data-lq-quiz="${quizId}"]`,
      )) {
        animateCount(el, quizState.total);
      }

      // Update results bars if already animated
      if (animatedResults.has(quizId)) {
        for (const el of revealEl.querySelectorAll<HTMLElement>(
          `.lq-results[data-lq-quiz="${quizId}"]`,
        )) {
          updateResultBars(el, quizState);
        }
      }
    }
  }

  // ── Plugin Interface ──

  return {
    id: "live-quiz",

    init: async (reveal: RevealApi): Promise<void> => {
      deck = reveal;
      const raw = deck.getConfig().liveQuiz ?? {};
      const parsed = v.safeParse(LiveQuizConfigSchema, raw);
      if (!parsed.success) {
        console.warn(
          "[live-quiz] Missing required config: wsUrl and quizGroupId. " +
            "Pass them in Reveal.initialize({ liveQuiz: { wsUrl, quizGroupId } }).",
        );
        return;
      }
      config = parsed.output as LiveQuizConfig;

      // Initialize QuizManager in presenter mode
      manager = getQuizPresenter({
        wsUrl: config.wsUrl,
        quizGroupId: config.quizGroupId,
        endpoints: config.endpoints,
      });

      const revealEl = deck.getRevealElement();

      // Inject DOM into quiz question slides
      const questionSlides = revealEl.querySelectorAll<HTMLElement>(
        "section[data-quiz-id]",
      );
      const renderPromises: Promise<void>[] = [];
      const allQuestions: QuestionPayload[] = [];
      for (const slide of questionSlides) {
        const p = renderQuestion(slide, config.quizUrl, config.titleText).catch(
          (err) => console.warn("[live-quiz] Failed to render question slide:", err),
        );
        renderPromises.push(p);

        // Extract question data for broadcasting to participants
        const quizId = slide.dataset.quizId!;
        const question = slide.dataset.quizQuestion || "";
        try {
          const options = JSON.parse(slide.dataset.quizOptions || "[]");
          allQuestions.push({
            quizId,
            question,
            options: options.map((o: { label: string; text: string }) => ({
              label: o.label,
              text: o.text,
            })),
          });
        } catch {
          // renderQuestion already warns about invalid JSON
        }
      }

      // Pass extracted questions to manager for sync broadcast
      manager.setQuestions(allQuestions);

      // Inject DOM into quiz results slides
      for (const slide of revealEl.querySelectorAll<HTMLElement>(
        "section[data-quiz-results]",
      )) {
        renderResults(slide);
      }

      // Wait for all QR codes to render (individual failures already caught above)
      await Promise.all(renderPromises);

      // Subscribe to state changes
      unsubscribe = manager.subscribe(onStateChange);

      // Listen for slide changes
      deck.on("slidechanged", onSlideChanged);
    },

    destroy: () => {
      if (!deck) return;

      deck.off("slidechanged", onSlideChanged);

      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }

      // Disconnect WebSocket and remove from singleton cache
      if (manager) {
        removeQuizPresenter(config.quizGroupId);
        manager.disconnect();
        manager = null;
      }

      // Remove injected DOM
      const revealEl = deck.getRevealElement();
      for (const el of revealEl.querySelectorAll(".lq-question, .lq-results")) {
        el.remove();
      }

      animatedResults.clear();
      deck = null;
    },
  };
}
