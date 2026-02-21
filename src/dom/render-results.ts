import type { VoteState, QuizOption } from "../quiz-types";

/**
 * Inject results bar chart into a `<section data-quiz-results>` slide.
 * Reads data-quiz-results (quizId) and data-quiz-options for options metadata.
 */
export function renderResults(slide: HTMLElement): void {
  const quizId = slide.dataset.quizResults!;
  const question = slide.dataset.quizQuestion || "";
  let options: QuizOption[] = [];

  try {
    options = JSON.parse(slide.dataset.quizOptions || "[]");
  } catch {
    console.warn(`[live-quiz] Invalid data-quiz-options on results "${quizId}"`);
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "lq-results";
  wrapper.dataset.lqQuiz = quizId;

  // Title
  if (question) {
    const title = document.createElement("h2");
    title.className = "lq-results__title";
    title.textContent = question;
    wrapper.appendChild(title);
  }

  // Bars
  const barsContainer = document.createElement("div");
  barsContainer.className = "lq-results__bars";

  for (const opt of options) {
    const bar = document.createElement("div");
    bar.className = "lq-result-bar";
    if (opt.correct) bar.classList.add("lq-result-bar--correct");
    bar.dataset.option = opt.label;

    // Label
    const labelDiv = document.createElement("div");
    labelDiv.className = "lq-result-bar__label";
    const letter = document.createElement("span");
    letter.className = "lq-result-bar__letter";
    letter.textContent = opt.label;
    const text = document.createElement("span");
    text.className = "lq-result-bar__text";
    text.textContent = opt.text;
    labelDiv.append(letter, text);

    // Track
    const track = document.createElement("div");
    track.className = "lq-result-bar__track";
    const fill = document.createElement("div");
    fill.className = "lq-result-bar__fill";
    fill.style.width = "0%";
    track.appendChild(fill);

    // Stats
    const stats = document.createElement("div");
    stats.className = "lq-result-bar__stats";
    const pct = document.createElement("span");
    pct.className = "lq-result-bar__pct";
    pct.textContent = "0%";
    const count = document.createElement("span");
    count.className = "lq-result-bar__count";
    count.textContent = "0";
    stats.append(pct, count);

    bar.append(labelDiv, track, stats);

    barsContainer.appendChild(bar);
  }

  wrapper.appendChild(barsContainer);
  slide.appendChild(wrapper);
}

/**
 * Update result bars with current vote state.
 */
export function updateResultBars(
  wrapper: HTMLElement,
  state: VoteState,
): void {
  const bars = wrapper.querySelectorAll<HTMLElement>(".lq-result-bar");
  const total = state.total || 1;

  for (const bar of bars) {
    const key = bar.dataset.option || "";
    const count = state.votes[key] || 0;
    const pct = Math.round((count / total) * 100);

    const fill = bar.querySelector<HTMLElement>(".lq-result-bar__fill");
    const pctEl = bar.querySelector<HTMLElement>(".lq-result-bar__pct");
    const countEl = bar.querySelector<HTMLElement>(".lq-result-bar__count");

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

  const bars = wrapper.querySelectorAll<HTMLElement>(".lq-result-bar");
  const total = state.total || 1;

  let i = 0;
  for (const bar of bars) {
    const key = bar.dataset.option || "";
    const count = state.votes[key] || 0;
    const pct = Math.round((count / total) * 100);

    const fill = bar.querySelector<HTMLElement>(".lq-result-bar__fill");
    const pctEl = bar.querySelector<HTMLElement>(".lq-result-bar__pct");
    const countEl = bar.querySelector<HTMLElement>(".lq-result-bar__count");

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
