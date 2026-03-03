/**
 * Shared class-name constants and selector helpers.
 *
 * Single source of truth: the same constants are interpolated into
 * html`` templates (render-*.ts) and into querySelector calls
 * (plugin.ts, update/animate functions).
 */

// ── Class names (used in both templates and selectors) ──

export const CLS = {
  question: "lq-question",
  results: "lq-results",
  wordcloud: "lq-wordcloud",
  online: "lq-online",
  answered: "lq-answered",

  resultBar: "lq-result-bar",
  resultBarCorrect: "lq-result-bar--correct",
  resultBarFill: "lq-result-bar__fill",
  resultBarPct: "lq-result-bar__pct",
  resultBarCount: "lq-result-bar__count",

  wordcloudCloud: "lq-wordcloud__cloud",
  wordcloudWord: "lq-wordcloud__word",
  wordcloudWordTop: "lq-wordcloud__word--top",
} as const;

// ── Selector helpers (composite class + data-attribute queries) ──

export function findWordcloud(parent: HTMLElement, quizId: string) {
  return parent.querySelector<HTMLElement>(`.${CLS.wordcloud}[data-lq-quiz="${quizId}"]`);
}

export function findResults(parent: HTMLElement, quizId: string) {
  return parent.querySelector<HTMLElement>(`.${CLS.results}[data-lq-quiz="${quizId}"]`);
}

export function findAllOnline(parent: HTMLElement) {
  return parent.querySelectorAll<HTMLElement>(`.${CLS.online}`);
}

export function findAllAnswered(parent: HTMLElement, quizId: string) {
  return parent.querySelectorAll<HTMLElement>(`.${CLS.answered}[data-lq-quiz="${quizId}"]`);
}

export function findAllWordclouds(parent: HTMLElement, quizId: string) {
  return parent.querySelectorAll<HTMLElement>(`.${CLS.wordcloud}[data-lq-quiz="${quizId}"]`);
}

export function findAllResults(parent: HTMLElement, quizId: string) {
  return parent.querySelectorAll<HTMLElement>(`.${CLS.results}[data-lq-quiz="${quizId}"]`);
}

export function findAllInjected(parent: HTMLElement) {
  return parent.querySelectorAll(`.${CLS.question}, .${CLS.results}, .${CLS.wordcloud}`);
}
