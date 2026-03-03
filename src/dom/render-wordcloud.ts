import type { VoteState } from "../quiz-types";
import { html } from "./html";
import { CLS } from "./selectors";

const MIN_FONT = 0.8;
const MAX_FONT = 3;

/**
 * Inject word cloud container into a `<section data-quiz-results data-quiz-type="text">` slide.
 */
export function renderWordCloud(slide: HTMLElement): void {
  const quizId = slide.dataset.quizResults!;
  const question = slide.dataset.quizQuestion || "";

  const fragment = html`
    <div class="${CLS.wordcloud}" data-lq-quiz="${quizId}">
      ${question ? html`<h2 class="lq-wordcloud__title">${question}</h2>` : null}
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

  const entries = Object.entries(state.votes);
  if (entries.length === 0) return;

  const maxCount = Math.max(...entries.map(([, c]) => c));
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  let i = 0;
  for (const [word, count] of entries) {
    const selector = `[data-word="${CSS.escape(word)}"]`;
    let span = cloud.querySelector<HTMLElement>(selector);

    const fontSize = maxCount > 1
      ? MIN_FONT + ((count - 1) / (maxCount - 1)) * (MAX_FONT - MIN_FONT)
      : (MIN_FONT + MAX_FONT) / 2;
    const isTop = count === maxCount;

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
