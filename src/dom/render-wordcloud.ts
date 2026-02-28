import type { VoteState } from "../quiz-types";

const MIN_FONT = 0.8;
const MAX_FONT = 3;

/**
 * Inject word cloud container into a `<section data-quiz-results data-quiz-type="text">` slide.
 */
export function renderWordCloud(slide: HTMLElement): void {
  const quizId = slide.dataset.quizResults!;
  const question = slide.dataset.quizQuestion || "";

  const wrapper = document.createElement("div");
  wrapper.className = "lq-wordcloud";
  wrapper.dataset.lqQuiz = quizId;

  if (question) {
    const title = document.createElement("h2");
    title.className = "lq-wordcloud__title";
    title.textContent = question;
    wrapper.appendChild(title);
  }

  const cloud = document.createElement("div");
  cloud.className = "lq-wordcloud__cloud";
  wrapper.appendChild(cloud);

  slide.appendChild(wrapper);
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
  const cloud = wrapper.querySelector<HTMLElement>(".lq-wordcloud__cloud");
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
      span.className = "lq-wordcloud__word";
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
    span.classList.toggle("lq-wordcloud__word--top", isTop);
    span.title = `${word}: ${count}`;
    i++;
  }
}
