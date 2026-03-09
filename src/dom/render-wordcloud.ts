import type { VoteState } from "../quiz-types";
import { computeWordSizes } from "../quiz-types";
import { html } from "./html";
import { CLS } from "./selectors";

/**
 * Inject word cloud container into a `<section data-quiz-results data-quiz-type="text">` slide.
 */
export function renderWordCloud(slide: HTMLElement): void {
  const quizId = slide.dataset.quizResults!;
  const question = slide.dataset.quizQuestion || "";

  const fragment = html`
    <div class="${CLS.wordcloud}" data-sq-quiz="${quizId}">
      ${question ? html`<h2 class="sq-wordcloud__title">${question}</h2>` : null}
      <div class="${CLS.wordcloudCloud}"></div>
    </div>
  `;

  slide.appendChild(fragment);
}

/**
 * Update word cloud with current vote state (no animation).
 */
export function updateWordCloud(
  wrapper: HTMLElement,
  state: VoteState,
): void {
  renderWords(wrapper, state, false);
}

/**
 * Animate word cloud entrance when slide becomes visible.
 */
export function animateWordCloud(
  wrapper: HTMLElement,
  state: VoteState,
): void {
  renderWords(wrapper, state, true);
}

function renderWords(
  wrapper: HTMLElement,
  state: VoteState,
  animate: boolean,
): void {
  const cloud = wrapper.querySelector<HTMLElement>(`.${CLS.wordcloudCloud}`);
  if (!cloud) return;

  const words = computeWordSizes(state.votes);
  if (words.length === 0) return;

  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  let i = 0;
  for (const { word, count, fontSize, isTop } of words) {
    const selector = `[data-word="${CSS.escape(word)}"]`;
    let span = cloud.querySelector<HTMLElement>(selector);

    if (!span) {
      span = document.createElement("span");
      span.className = CLS.wordcloudWord;
      span.dataset.word = word;
      span.textContent = word;

      if (animate && !prefersReducedMotion) {
        span.style.opacity = "0";
        const delay = i * 0.08;
        span.style.transitionDelay = `${delay}s`;
        const el = span;
        requestAnimationFrame(() => {
          el.style.opacity = "1";
        });
      }

      cloud.appendChild(span);
    }

    span.style.fontSize = `${fontSize}rem`;
    span.classList.toggle(CLS.wordcloudWordTop, isTop);
    span.title = `${word}: ${count}`;
    i++;
  }
}
