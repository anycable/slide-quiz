/**
 * Reveal.js Slide Quiz plugin core.
 *
 * Scans slides for data-quiz-id / data-quiz-results attributes,
 * injects DOM, listens to slidechanged, and bridges state from QuizManager.
 */
import * as v from "valibot";
import type { QuestionPayload, PresenterQuizManager, QuizErrorHandler } from "./quiz-manager";
import { getQuizPresenter, removeQuizPresenter } from "./quiz-manager";
import { QuizEndpointsSchema, JsonQuizOptionsSchema, QuizTypeSchema } from "./quiz-types";
import { animateCount } from "./dom/animate";
import { renderQuestion, questionHint } from "./dom/render-question";
import { renderResults, updateResultBars, animateResultBars, syncCorrectReveal } from "./dom/render-results";
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
  /** Receives every error the engine detects. Wire to your own monitoring. */
  onError: v.optional(v.custom<QuizErrorHandler>((x) => typeof x === "function")),
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

/**
 * Add the deck's accent colour to the audience page URL, so the page matches
 * the slides. The participant widget applies it only if it is a valid colour.
 */
function withAccent(quizUrl: string | undefined, accent: string): string | undefined {
  if (!quizUrl || !accent) return quizUrl;
  const url = new URL(quizUrl, location.href);
  url.searchParams.set("accent", accent);
  return url.toString();
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
    syncCorrectReveal(slide);

    // Quiz question slide — activate it
    const quizId = slide.dataset.quizId;
    if (quizId) {
      manager.setActiveQuestion(quizId);
    }

    // Quiz results slide — activate + animate on first visit
    const resultsId = slide.dataset.quizResults;
    if (resultsId) {
      manager.setActiveQuestion(resultsId);
    }

    // Non-quiz slide — clear active question so participants see waiting state
    if (!quizId && !resultsId) {
      manager.clearActiveQuestion();
    }
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

  function onFragment(event: unknown) {
    const fragment = (event as { fragment?: unknown }).fragment;
    const slide = fragment instanceof Element ? fragment.closest("section") : null;
    if (slide) syncCorrectReveal(slide);
  }

  // ── Plugin Interface ──

  return {
    id: "slide-quiz",

    init: async (reveal: RevealApi): Promise<void> => {
      deck = reveal;
      const raw = deck.getConfig().slideQuiz ?? {};
      const parsed = v.safeParse(SlideQuizConfigSchema, raw);
      if (!parsed.success) {
        // Name the failing fields, and show the error where the quiz should be
        const flat = v.flatten(parsed.issues);
        const fields = Object.entries(flat.nested ?? {}).map(([key, msgs]) => `${key}: ${msgs?.[0]}`);
        const message =
          `Invalid slideQuiz config (${fields.join("; ") || flat.root?.[0] || "not an object"}). ` +
          "Set it in Reveal.initialize({ slideQuiz: { wsUrl, quizGroupId, quizUrl } }).";
        console.warn(`[slide-quiz] ${message}`);
        for (const slide of deck.getRevealElement().querySelectorAll<HTMLElement>(
          "section[data-quiz-id], section[data-quiz-results]",
        )) {
          const box = document.createElement("div");
          box.className = "sq-config-error";
          box.setAttribute("data-sq-injected", "");
          box.textContent = `slide-quiz: ${message}`;
          slide.appendChild(box);
        }
        return;
      }
      config = parsed.output;

      // Initialize QuizManager in presenter mode
      manager = getQuizPresenter({
        wsUrl: config.wsUrl,
        quizGroupId: config.quizGroupId,
        endpoints: config.endpoints,
        onError: config.onError,
      });

      const revealEl = deck.getRevealElement();
      const quizUrl = withAccent(
        config.quizUrl,
        getComputedStyle(revealEl).getPropertyValue("--sq-accent").trim(),
      );

      // Inject DOM into quiz question slides
      const questionSlides = revealEl.querySelectorAll<HTMLElement>(
        "section[data-quiz-id]",
      );
      const renderPromises: Promise<void>[] = [];
      const allQuestions: QuestionPayload[] = [];
      for (const slide of questionSlides) {
        const p = renderQuestion(slide, quizUrl, config.titleText, config.hintText).catch(
          (err) => console.warn("[slide-quiz] Failed to render question slide:", err),
        );
        renderPromises.push(p);

        // Extract question data for broadcasting to participants
        const quizId = slide.dataset.quizId!;
        const question = slide.dataset.quizQuestion || "";
        const quizType = v.parse(QuizTypeSchema, slide.dataset.quizType);

        const hint = questionHint(slide, quizType, config.hintText);

        if (quizType === "text") {
          allQuestions.push({ quizId, question, type: quizType, options: [], hint });
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
              hint,
            });
          }
        }
      }

      // Inject DOM into quiz results slides
      // Also extract questions from results-only slides (no matching question slide)
      const knownQuizIds = new Set(allQuestions.map(q => q.quizId));

      for (const slide of revealEl.querySelectorAll<HTMLElement>(
        "section[data-quiz-results]",
      )) {
        const resultType = v.parse(QuizTypeSchema, slide.dataset.quizType);
        if (resultType === "text") {
          renderPromises.push(
            renderWordCloud(slide, quizUrl).catch(
              (err) => console.warn("[slide-quiz] Failed to render word cloud slide:", err),
            ),
          );
        } else {
          renderPromises.push(
            renderResults(slide, quizUrl).catch(
              (err) => console.warn("[slide-quiz] Failed to render results slide:", err),
            ),
          );
        }

        // Register question from results slide if no matching question slide exists
        const quizId = slide.dataset.quizResults!;
        if (!knownQuizIds.has(quizId)) {
          const question = slide.dataset.quizQuestion || "";
          if (resultType === "text") {
            allQuestions.push({ quizId, question, type: resultType, options: [] });
          } else {
            const optionsParsed = v.safeParse(
              JsonQuizOptionsSchema,
              slide.dataset.quizOptions,
            );
            if (optionsParsed.success) {
              allQuestions.push({
                quizId,
                question,
                type: resultType,
                options: optionsParsed.output.map((o) => ({
                  label: o.label,
                  text: o.text,
                })),
              });
            }
          }
          knownQuizIds.add(quizId);
        }
      }

      // Pass extracted questions to manager for sync broadcast
      manager.setQuestions(allQuestions);

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
        manager.store.syncError.subscribe(() => renderErrorBanner()),
        manager.store.connectionError.subscribe(() => renderErrorBanner()),
        manager.store.audienceWarning.subscribe(() => renderErrorBanner()),
      );

      // Connection problems come first: without a WebSocket nothing else matters.
      // The slides are on the projector, so the banner starts as a small pill
      // and shows the full message only when the presenter clicks it.
      function renderErrorBanner() {
        if (!manager) return;
        const error =
          manager.store.connectionError.get() ??
          manager.store.syncError.get() ??
          manager.store.audienceWarning.get();
        let banner = revealEl.querySelector<HTMLElement>(".sq-sync-error");
        if (error) {
          if (!banner) {
            banner = document.createElement("button");
            banner.className = "sq-sync-error sq-sync-error--compact";
            banner.setAttribute("data-sq-injected", "");
            banner.addEventListener("click", () => {
              banner!.classList.toggle("sq-sync-error--compact");
              renderErrorBanner();
            });
            revealEl.appendChild(banner);
          }
          banner.textContent = banner.classList.contains("sq-sync-error--compact")
            ? "⚠ Live quiz problem · details"
            : `⚠ ${error}`;
          banner.title = error;
          banner.style.display = "";
        } else if (banner) {
          banner.style.display = "none";
        }
      }

      // Listen for slide changes
      deck.on("slidechanged", onSlideChanged);
      deck.on("fragmentshown", onFragment);
      deck.on("fragmenthidden", onFragment);
    },

    destroy: () => {
      if (!deck) return;

      deck.off("slidechanged", onSlideChanged);
      deck.off("fragmentshown", onFragment);
      deck.off("fragmenthidden", onFragment);

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
