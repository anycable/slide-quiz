import * as v from "valibot";
import type { VoteState } from "../quiz-types";
import { JsonQuizOptionsSchema } from "../quiz-types";
import { html } from "./html";
import { CLS } from "./selectors";

/**
 * Inject results bar chart into a `<section data-quiz-results>` slide.
 * Reads data-quiz-results (quizId) and data-quiz-options for options metadata.
 */
export function renderResults(slide: HTMLElement): void {
  const quizId = slide.dataset.quizResults!;
  const question = slide.dataset.quizQuestion || "";
  const parsed = v.safeParse(JsonQuizOptionsSchema, slide.dataset.quizOptions);
  if (!parsed.success) {
    console.warn(`[slide-quiz] Invalid data-quiz-options on results "${quizId}"`);
    return;
  }

  const fragment = html`
    <div class="${CLS.results}" data-sq-quiz="${quizId}">
      ${question ? html`<h2 class="sq-results__title">${question}</h2>` : null}
      <div class="sq-results__bars">
        ${parsed.output.map(
          (opt) => html`
            <div class="${CLS.resultBar}${opt.correct ? ` ${CLS.resultBarCorrect}` : ""}" data-option="${opt.label}">
              <div class="sq-result-bar__label">
                <span class="sq-result-bar__letter">${opt.label}</span>
                <span class="sq-result-bar__text">${opt.text}</span>
              </div>
              <div class="sq-result-bar__track">
                <div class="${CLS.resultBarFill}" style="width: 0%"></div>
              </div>
              <div class="sq-result-bar__stats">
                <span class="${CLS.resultBarPct}">0%</span>
                <span class="${CLS.resultBarCount}">0</span>
              </div>
            </div>
          `,
        )}
      </div>
    </div>
  `;

  slide.appendChild(fragment);
}

/**
 * Update result bars with current vote state.
 */
export function updateResultBars(
  wrapper: HTMLElement,
  state: VoteState,
): void {
  const bars = wrapper.querySelectorAll<HTMLElement>(`.${CLS.resultBar}`);
  const total = state.total || 1;

  for (const bar of bars) {
    const key = bar.dataset.option || "";
    const count = state.votes[key] || 0;
    const pct = Math.round((count / total) * 100);

    const fill = bar.querySelector<HTMLElement>(`.${CLS.resultBarFill}`);
    const pctEl = bar.querySelector<HTMLElement>(`.${CLS.resultBarPct}`);
    const countEl = bar.querySelector<HTMLElement>(`.${CLS.resultBarCount}`);

    if (fill) fill.style.width = `${pct}%`;
    if (pctEl) pctEl.textContent = `${pct}%`;
    if (countEl) countEl.textContent = String(count);
  }
}

/**
 * Animate result bars entrance when slide becomes visible.
 */
export function animateResultBars(
  wrapper: HTMLElement,
  state: VoteState,
): void {
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  const bars = wrapper.querySelectorAll<HTMLElement>(`.${CLS.resultBar}`);
  const total = state.total || 1;

  let i = 0;
  for (const bar of bars) {
    const key = bar.dataset.option || "";
    const count = state.votes[key] || 0;
    const pct = Math.round((count / total) * 100);

    const fill = bar.querySelector<HTMLElement>(`.${CLS.resultBarFill}`);
    const pctEl = bar.querySelector<HTMLElement>(`.${CLS.resultBarPct}`);
    const countEl = bar.querySelector<HTMLElement>(`.${CLS.resultBarCount}`);

    if (fill) {
      if (prefersReducedMotion) {
        fill.style.width = `${pct}%`;
      } else {
        fill.style.transitionDelay = `${i * 0.15}s`;
        requestAnimationFrame(() => {
          fill.style.width = `${pct}%`;
        });
      }
    }

    if (pctEl) pctEl.textContent = `${pct}%`;
    if (countEl) countEl.textContent = String(count);
    i++;
  }
}
