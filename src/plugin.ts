/**
 * Reveal.js Slide Quiz plugin core.
 *
 * Scans slides for data-quiz-id / data-quiz-results attributes,
 * injects DOM, listens to slidechanged, and bridges state from QuizManager.
 */
import * as v from "valibot";
import type { QuestionPayload, PresenterQuizManager } from "./quiz-manager";
import { getQuizPresenter, removeQuizPresenter } from "./quiz-manager";
import { QuizEndpointsSchema, JsonQuizOptionsSchema, QuizTypeSchema } from "./quiz-types";
import { animateCount } from "./dom/animate";
import { renderQuestion } from "./dom/render-question";
import { renderResults, updateResultBars, animateResultBars } from "./dom/render-results";
import { renderWordCloud, updateWordCloud, animateWordCloud } from "./dom/render-wordcloud";
import {
  findWordcloud,
  findResults,
  findAllOnline,
  findAllAnswered,
  findAllWordclouds,
  findAllResults,
  findAllInjected,
} from "./dom/selectors";

export const SlideQuizConfigSchema = v.object({
  wsUrl: v.pipe(v.string(), v.minLength(1)),
  quizGroupId: v.pipe(v.string(), v.minLength(1)),
  quizUrl: v.optional(v.string()),
  endpoints: v.optional(v.partial(QuizEndpointsSchema)),
  titleText: v.optional(v.string()),
  hintText: v.optional(v.string()),
});

export type SlideQuizConfig = v.InferOutput<typeof SlideQuizConfigSchema>;

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
  let config: SlideQuizConfig;
  let manager: PresenterQuizManager | null = null;
  const unsubs: (() => void)[] = [];

  // Track which results slides have been animated
  const animatedResults = new Set<string>();

  // ── Event Handlers ──

  function onSlideChanged(event: unknown) {
    if (!manager) return;
    const ev = event as Record<string, unknown>;
    const slide = ev.currentSlide;
    if (!(slide instanceof HTMLElement)) return;

    // Quiz question slide — activate it
    const quizId = slide.dataset.quizId;
    if (quizId) {
      manager.setActiveQuestion(quizId);
    }

    // Quiz results slide — animate on first visit
    const resultsId = slide.dataset.quizResults;
    if (resultsId && !animatedResults.has(resultsId)) {
      animatedResults.add(resultsId);
      const state = manager.getQuizState(resultsId);
      const wordcloud = findWordcloud(slide, resultsId);
      if (wordcloud) {
        animateWordCloud(wordcloud, state);
      } else {
        const bars = findResults(slide, resultsId);
        if (bars) {
          animateResultBars(bars, state);
        }
      }
    }
  }

  // ── Plugin Interface ──

  return {
    id: "slide-quiz",

    init: async (reveal: RevealApi): Promise<void> => {
      deck = reveal;
      const raw = deck.getConfig().slideQuiz ?? {};
      const parsed = v.safeParse(SlideQuizConfigSchema, raw);
      if (!parsed.success) {
        console.warn(
          "[slide-quiz] Missing required config: wsUrl and quizGroupId. " +
            "Pass them in Reveal.initialize({ slideQuiz: { wsUrl, quizGroupId } }).",
        );
        return;
      }
      config = parsed.output;

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
        const p = renderQuestion(slide, config.quizUrl, config.titleText, config.hintText).catch(
          (err) => console.warn("[slide-quiz] Failed to render question slide:", err),
        );
        renderPromises.push(p);

        // Extract question data for broadcasting to participants
        const quizId = slide.dataset.quizId!;
        const question = slide.dataset.quizQuestion || "";
        const quizType = v.parse(QuizTypeSchema, slide.dataset.quizType);

        if (quizType === "text") {
          allQuestions.push({ quizId, question, type: quizType, options: [] });
        } else {
          const optionsParsed = v.safeParse(
            JsonQuizOptionsSchema,
            slide.dataset.quizOptions,
          );
          if (optionsParsed.success) {
            allQuestions.push({
              quizId,
              question,
              type: quizType,
              options: optionsParsed.output.map((o) => ({
                label: o.label,
                text: o.text,
              })),
            });
          }
        }
      }

      // Pass extracted questions to manager for sync broadcast
      manager.setQuestions(allQuestions);

      // Inject DOM into quiz results slides
      for (const slide of revealEl.querySelectorAll<HTMLElement>(
        "section[data-quiz-results]",
      )) {
        const resultType = v.parse(QuizTypeSchema, slide.dataset.quizType);
        if (resultType === "text") {
          renderWordCloud(slide);
        } else {
          renderResults(slide);
        }
      }

      // Wait for all QR codes to render (individual failures already caught above)
      await Promise.all(renderPromises);

      // Subscribe to store changes
      unsubs.push(
        manager.store.online.subscribe(count => {
          for (const el of findAllOnline(revealEl)) animateCount(el, count);
        }),
        manager.store.results.subscribe(results => {
          for (const [quizId, quizState] of Object.entries(results)) {
            for (const el of findAllAnswered(revealEl, quizId)) animateCount(el, quizState.total);
            if (animatedResults.has(quizId)) {
              for (const el of findAllWordclouds(revealEl, quizId)) updateWordCloud(el, quizState);
              for (const el of findAllResults(revealEl, quizId)) updateResultBars(el, quizState);
            }
          }
        }),
      );

      // Listen for slide changes
      deck.on("slidechanged", onSlideChanged);
    },

    destroy: () => {
      if (!deck) return;

      deck.off("slidechanged", onSlideChanged);

      for (const unsub of unsubs) unsub();
      unsubs.length = 0;

      // Disconnect WebSocket and remove from singleton cache
      if (manager) {
        removeQuizPresenter(config.quizGroupId);
        manager.disconnect();
        manager = null;
      }

      // Remove injected DOM
      const revealEl = deck.getRevealElement();
      for (const el of findAllInjected(revealEl)) {
        el.remove();
      }

      animatedResults.clear();
      deck = null;
    },
  };
}
