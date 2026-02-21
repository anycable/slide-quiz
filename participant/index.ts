/**
 * Standalone participant widget for live-quiz.
 * No Reveal.js dependency — designed for a mobile-friendly audience page.
 *
 * Usage:
 *   import { createParticipantUI } from 'live-quiz/participant';
 *   import 'live-quiz/participant.css';
 *
 *   createParticipantUI('#quiz-root', {
 *     wsUrl: 'wss://your-cable.fly.dev/cable',
 *     quizGroupId: 'my-talk',
 *     questions: [
 *       {
 *         quizId: 'q1',
 *         question: 'Which metric is NOT included?',
 *         options: [
 *           { label: 'A', text: 'Time to First Value' },
 *           { label: 'B', text: 'GitHub stars' },
 *         ]
 *       }
 *     ]
 *   });
 */
import "./participant.css";
import { getQuizParticipant } from "../src/quiz-manager";
import type { QuizManager, QuizEndpoints } from "../src/quiz-manager";

export interface ParticipantQuestion {
  quizId: string;
  question: string;
  options: { label: string; text: string }[];
}

export interface ParticipantConfig {
  wsUrl: string;
  quizGroupId: string;
  questions: ParticipantQuestion[];
  /** Custom endpoint URLs for answer/sync functions */
  endpoints?: Partial<QuizEndpoints>;
  /** Brand text shown at top (default: none) */
  brandText?: string;
  /** Footer text (default: "Powered by AnyCable") */
  footerText?: string;
}

export function createParticipantUI(
  selector: string,
  config: ParticipantConfig,
): { destroy: () => void } {
  const root = document.querySelector<HTMLElement>(selector);
  if (!root) {
    throw new Error(`[live-quiz] Element not found: ${selector}`);
  }

  const { questions, brandText, footerText = "Powered by AnyCable" } = config;

  // ── Build DOM ──
  root.innerHTML = "";
  root.classList.add("lq-participant");

  // Brand
  if (brandText) {
    const brand = document.createElement("p");
    brand.className = "lq-participant__brand";
    brand.textContent = brandText;
    root.appendChild(brand);
  }

  // Stats
  const stats = document.createElement("div");
  stats.className = "lq-participant__stats";

  const onlineEl = document.createElement("span");
  onlineEl.className = "lq-participant__online";
  onlineEl.textContent = "0";

  const answeredEl = document.createElement("span");
  answeredEl.className = "lq-participant__answered";
  answeredEl.textContent = "0";

  stats.append(onlineEl, " online \u00b7 ", answeredEl, " answered");
  root.appendChild(stats);

  // Waiting message
  const waiting = document.createElement("div");
  waiting.className = "lq-participant__waiting";
  waiting.textContent = "Waiting for the next question...";
  root.appendChild(waiting);

  // Question sections
  const sectionEls: Record<string, HTMLElement> = {};

  let questionIndex = 0;
  for (const q of questions) {
    const section = document.createElement("div");
    section.className = "lq-participant__section lq-participant__section--hidden";
    section.dataset.quizId = q.quizId;

    const number = document.createElement("p");
    number.className = "lq-participant__number";
    number.textContent = `Question ${questionIndex + 1} of ${questions.length}`;
    section.appendChild(number);

    const title = document.createElement("h2");
    title.className = "lq-participant__question";
    title.textContent = q.question;
    section.appendChild(title);

    const optionsDiv = document.createElement("div");
    optionsDiv.className = "lq-participant__options";

    for (const opt of q.options) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lq-participant__btn";
      btn.dataset.answer = opt.label;
      const btnLabel = document.createElement("span");
      btnLabel.className = "lq-participant__btn-label";
      btnLabel.textContent = opt.label;
      const btnText = document.createElement("span");
      btnText.textContent = opt.text;
      btn.append(btnLabel, btnText);
      optionsDiv.appendChild(btn);
    }
    section.appendChild(optionsDiv);

    const status = document.createElement("p");
    status.className = "lq-participant__status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    section.appendChild(status);

    root.appendChild(section);
    sectionEls[q.quizId] = section;
    questionIndex++;
  }

  // Footer
  if (footerText) {
    const footer = document.createElement("p");
    footer.className = "lq-participant__footer";
    footer.textContent = footerText;
    root.appendChild(footer);
  }

  // ── QuizManager ──
  const manager: QuizManager = getQuizParticipant({
    wsUrl: config.wsUrl,
    quizGroupId: config.quizGroupId,
    endpoints: config.endpoints,
  });

  let currentActiveQuizId: string | null = null;

  function showQuestion(quizId: string | null) {
    currentActiveQuizId = quizId;
    for (const [id, el] of Object.entries(sectionEls)) {
      if (id === quizId) {
        el.classList.remove("lq-participant__section--hidden");
      } else {
        el.classList.add("lq-participant__section--hidden");
      }
    }
    if (quizId) {
      waiting.style.display = "none";
    } else {
      waiting.style.display = "";
    }
  }

  function applyVotedUI(quizId: string, answer: string) {
    const section = sectionEls[quizId];
    if (!section) return;
    const buttons = section.querySelectorAll<HTMLButtonElement>(".lq-participant__btn");
    const statusEl = section.querySelector<HTMLElement>(".lq-participant__status")!;
    for (const b of buttons) {
      b.disabled = true;
      b.setAttribute("aria-disabled", "true");
      if (b.dataset.answer === answer) {
        b.classList.add("lq-participant__btn--selected");
      } else {
        b.classList.add("lq-participant__btn--faded");
      }
    }
    const text =
      section.querySelector(`[data-answer="${answer}"] span:last-child`)
        ?.textContent || answer;
    statusEl.textContent = "";
    const strong = document.createElement("strong");
    strong.textContent = text;
    statusEl.append(strong, " \u2014 submitted!");
  }

  function resetQuizUI(quizId: string) {
    const section = sectionEls[quizId];
    if (!section) return;
    const buttons = section.querySelectorAll<HTMLButtonElement>(".lq-participant__btn");
    const statusEl = section.querySelector<HTMLElement>(".lq-participant__status")!;
    for (const b of buttons) {
      b.disabled = false;
      b.removeAttribute("aria-disabled");
      b.classList.remove("lq-participant__btn--selected", "lq-participant__btn--faded");
    }
    statusEl.textContent = "";
  }

  // ── State subscription ──
  const unsubscribe = manager.subscribe((state) => {
    if (state.activeQuizId !== undefined) {
      showQuestion(state.activeQuizId);
    }
    onlineEl.textContent = String(state.online);
    if (currentActiveQuizId && state.results[currentActiveQuizId]) {
      answeredEl.textContent = String(
        state.results[currentActiveQuizId].total,
      );
    }

    for (const q of questions) {
      const voted = state.submitted[q.quizId];
      if (voted) {
        applyVotedUI(q.quizId, voted);
      } else {
        resetQuizUI(q.quizId);
      }
    }
  });

  // ── Click handlers ──
  for (const q of questions) {
    const section = sectionEls[q.quizId];
    if (!section) continue;

    const buttons = section.querySelectorAll<HTMLButtonElement>(".lq-participant__btn");
    const statusEl = section.querySelector<HTMLElement>(".lq-participant__status")!;

    async function submitVote(answer: string) {
      for (const b of buttons) {
        b.disabled = true;
        b.setAttribute("aria-disabled", "true");
        if (b.dataset.answer === answer) {
          b.classList.add("lq-participant__btn--selected");
        } else {
          b.classList.add("lq-participant__btn--faded");
        }
      }
      statusEl.textContent = "Sending...";

      const ok = await manager.submitAnswer(q.quizId, answer);

      if (!ok && !manager.hasVoted(q.quizId)) {
        statusEl.textContent = "Something went wrong. Try again!";
        for (const b of buttons) {
          b.disabled = false;
          b.removeAttribute("aria-disabled");
          b.classList.remove(
            "lq-participant__btn--selected",
            "lq-participant__btn--faded",
          );
        }
      }
    }

    for (const btn of buttons) {
      btn.addEventListener("click", () => {
        const answer = btn.dataset.answer;
        if (answer && !manager.hasVoted(q.quizId)) submitVote(answer);
      });
    }
  }

  // ── Cleanup on page hide ──
  function onPageHide() {
    manager.disconnect();
  }
  window.addEventListener("pagehide", onPageHide);

  // ── Return destroy handle ──
  return {
    destroy() {
      unsubscribe();
      window.removeEventListener("pagehide", onPageHide);
      manager.disconnect();
      root.innerHTML = "";
      root.classList.remove("lq-participant");
    },
  };
}
