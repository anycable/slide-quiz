/**
 * Standalone participant widget for live-quiz.
 * No Reveal.js dependency — designed for a mobile-friendly audience page.
 *
 * Usage (dynamic — questions come from presenter via sync):
 *   import { createParticipantUI } from 'live-quiz/participant';
 *   import 'live-quiz/participant.css';
 *
 *   createParticipantUI('#quiz-root', {
 *     wsUrl: 'wss://your-cable.anycable.io/cable',
 *     quizGroupId: 'my-talk',
 *   });
 *
 * Usage (static — backward compatible):
 *   createParticipantUI('#quiz-root', {
 *     wsUrl: 'wss://your-cable.anycable.io/cable',
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
import type { ParticipantQuizManager, QuizEndpoints, QuizType } from "../src/quiz-manager";

export interface ParticipantQuestion {
  quizId: string;
  question: string;
  type?: QuizType;
  options: { label: string; text: string }[];
}

export interface ParticipantConfig {
  wsUrl: string;
  quizGroupId: string;
  /** Questions to display. If omitted, questions are received dynamically from the presenter via sync. */
  questions?: ParticipantQuestion[];
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
  const root = document.querySelector<HTMLElement>(selector)!;
  if (!root) {
    throw new Error(`[live-quiz] Element not found: ${selector}`);
  }

  const { brandText, footerText = "Powered by AnyCable" } = config;

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

  // Footer (created early so question sections are inserted before it)
  let footerEl: HTMLElement | null = null;
  if (footerText) {
    footerEl = document.createElement("p");
    footerEl.className = "lq-participant__footer";
    footerEl.textContent = footerText;
    root.appendChild(footerEl);
  }

  // ── QuizManager ──
  const manager: ParticipantQuizManager = getQuizParticipant({
    wsUrl: config.wsUrl,
    quizGroupId: config.quizGroupId,
    endpoints: config.endpoints,
  });

  // Question sections (keyed by quizId)
  const sectionEls: Record<string, HTMLElement> = {};
  // Track which quizIds have been rendered to avoid re-rendering on every sync
  const renderedQuizIds = new Set<string>();
  let currentQuestions: ParticipantQuestion[] = [];
  let currentActiveQuizId: string | null = null;

  function renderQuestionSections(questions: ParticipantQuestion[]) {
    for (const q of questions) {
      if (renderedQuizIds.has(q.quizId)) continue;
      renderedQuizIds.add(q.quizId);

      const totalCount = questions.length;
      const questionIndex = questions.indexOf(q);

      const section = document.createElement("div");
      section.className = "lq-participant__section lq-participant__section--hidden";
      section.dataset.quizId = q.quizId;
      section.dataset.quizType = q.type || "choice";

      const number = document.createElement("p");
      number.className = "lq-participant__number";
      number.textContent = `Question ${questionIndex + 1} of ${totalCount}`;
      section.appendChild(number);

      const title = document.createElement("h2");
      title.className = "lq-participant__question";
      title.textContent = q.question;
      section.appendChild(title);

      const isText = (q.type || "choice") === "text";

      if (isText) {
        const inputWrapper = document.createElement("div");
        inputWrapper.className = "lq-participant__input-wrapper";

        const input = document.createElement("input");
        input.type = "text";
        input.maxLength = 100;
        input.className = "lq-participant__input";
        input.placeholder = "Type your answer...";

        const submitBtn = document.createElement("button");
        submitBtn.type = "button";
        submitBtn.className = "lq-participant__submit";
        submitBtn.textContent = "Submit";

        inputWrapper.append(input, submitBtn);
        section.appendChild(inputWrapper);
      } else {
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
      }

      const status = document.createElement("p");
      status.className = "lq-participant__status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      section.appendChild(status);

      // Insert before footer if it exists, otherwise append
      if (footerEl) {
        root.insertBefore(section, footerEl);
      } else {
        root.appendChild(section);
      }
      sectionEls[q.quizId] = section;

      // Bind click handlers for this section
      bindClickHandlers(q, section);
    }

    currentQuestions = questions;
  }

  function bindClickHandlers(q: ParticipantQuestion, section: HTMLElement) {
    const statusEl = section.querySelector<HTMLElement>(".lq-participant__status")!;

    if (section.dataset.quizType === "text") {
      const input = section.querySelector<HTMLInputElement>(".lq-participant__input")!;
      const submitBtn = section.querySelector<HTMLButtonElement>(".lq-participant__submit")!;

      async function submitText() {
        const answer = input.value.trim();
        if (!answer || manager.hasVoted(q.quizId)) return;

        input.disabled = true;
        submitBtn.disabled = true;
        statusEl.textContent = "Sending...";

        const ok = await manager.submitAnswer(q.quizId, answer);

        if (!ok && !manager.hasVoted(q.quizId)) {
          statusEl.textContent = "Something went wrong. Try again!";
          input.disabled = false;
          submitBtn.disabled = false;
        }
      }

      submitBtn.addEventListener("click", submitText);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submitText();
      });
    } else {
      const buttons = section.querySelectorAll<HTMLButtonElement>(".lq-participant__btn");

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
  }

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
    const statusEl = section.querySelector<HTMLElement>(".lq-participant__status")!;
    const isText = section.dataset.quizType === "text";

    if (isText) {
      const input = section.querySelector<HTMLInputElement>(".lq-participant__input");
      const submitBtn = section.querySelector<HTMLButtonElement>(".lq-participant__submit");
      if (input) {
        input.value = answer;
        input.disabled = true;
      }
      if (submitBtn) submitBtn.disabled = true;
    } else {
      const buttons = section.querySelectorAll<HTMLButtonElement>(".lq-participant__btn");
      for (const b of buttons) {
        b.disabled = true;
        b.setAttribute("aria-disabled", "true");
        if (b.dataset.answer === answer) {
          b.classList.add("lq-participant__btn--selected");
        } else {
          b.classList.add("lq-participant__btn--faded");
        }
      }
    }

    const displayText = isText
      ? answer
      : section.querySelector(`[data-answer="${answer}"] span:last-child`)?.textContent || answer;
    statusEl.textContent = "";
    const strong = document.createElement("strong");
    strong.textContent = displayText;
    statusEl.append(strong, " \u2014 submitted!");
  }

  function resetQuizUI(quizId: string) {
    const section = sectionEls[quizId];
    if (!section) return;
    const statusEl = section.querySelector<HTMLElement>(".lq-participant__status")!;

    if (section.dataset.quizType === "text") {
      const input = section.querySelector<HTMLInputElement>(".lq-participant__input");
      const submitBtn = section.querySelector<HTMLButtonElement>(".lq-participant__submit");
      if (input) {
        input.value = "";
        input.disabled = false;
      }
      if (submitBtn) submitBtn.disabled = false;
    } else {
      const buttons = section.querySelectorAll<HTMLButtonElement>(".lq-participant__btn");
      for (const b of buttons) {
        b.disabled = false;
        b.removeAttribute("aria-disabled");
        b.classList.remove("lq-participant__btn--selected", "lq-participant__btn--faded");
      }
    }

    statusEl.textContent = "";
  }

  // If questions provided statically, render them now
  if (config.questions) {
    renderQuestionSections(config.questions);
  }

  // ── State subscription ──
  const unsubscribe = manager.subscribe((state) => {
    // Dynamic questions: render when they arrive via sync
    if (!config.questions && state.questions.length > 0) {
      renderQuestionSections(state.questions);
    }

    if (state.activeQuizId !== undefined) {
      showQuestion(state.activeQuizId);
    }
    onlineEl.textContent = String(state.online);
    if (currentActiveQuizId && state.results[currentActiveQuizId]) {
      answeredEl.textContent = String(
        state.results[currentActiveQuizId].total,
      );
    }

    const questionsToCheck = config.questions || currentQuestions;
    for (const q of questionsToCheck) {
      const voted = state.submitted[q.quizId];
      if (voted) {
        applyVotedUI(q.quizId, voted);
      } else {
        resetQuizUI(q.quizId);
      }
    }
  });

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
