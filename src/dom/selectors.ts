/**
 * Shared class-name constants and selector helpers.
 *
 * Single source of truth: the same constants are interpolated into
 * html`` templates (render-*.ts) and into querySelector calls
 * (plugin.ts, update/animate functions).
 */

// ── Class names (used in both templates and selectors) ──

export const CLS = {
  question: "sq-question",
  results: "sq-results",
  wordcloud: "sq-wordcloud",
  online: "sq-online",
  answered: "sq-answered",

  resultBar: "sq-result-bar",
  resultBarCorrect: "sq-result-bar--correct",
  resultBarFill: "sq-result-bar__fill",
  resultBarPct: "sq-result-bar__pct",
  resultBarCount: "sq-result-bar__count",

  wordcloudCloud: "sq-wordcloud__cloud",
  wordcloudWord: "sq-wordcloud__word",
  wordcloudWordTop: "sq-wordcloud__word--top",
} as const;

// ── Selector helpers (composite class + data-attribute queries) ──

export function findWordcloud(parent: HTMLElement, quizId: string) {
  return parent.querySelector<HTMLElement>(`.${CLS.wordcloud}[data-sq-quiz="${quizId}"]`);
}

export function findResults(parent: HTMLElement, quizId: string) {
  return parent.querySelector<HTMLElement>(`.${CLS.results}[data-sq-quiz="${quizId}"]`);
}

export function findAllOnline(parent: HTMLElement) {
  return parent.querySelectorAll<HTMLElement>(`.${CLS.online}`);
}

export function findAllAnswered(parent: HTMLElement, quizId: string) {
  return parent.querySelectorAll<HTMLElement>(`.${CLS.answered}[data-sq-quiz="${quizId}"]`);
}

export function findAllWordclouds(parent: HTMLElement, quizId: string) {
  return parent.querySelectorAll<HTMLElement>(`.${CLS.wordcloud}[data-sq-quiz="${quizId}"]`);
}

export function findAllResults(parent: HTMLElement, quizId: string) {
  return parent.querySelectorAll<HTMLElement>(`.${CLS.results}[data-sq-quiz="${quizId}"]`);
}

export function findAllInjected(parent: HTMLElement) {
  return parent.querySelectorAll(`.${CLS.question}, .${CLS.results}, .${CLS.wordcloud}`);
}
