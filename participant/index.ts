/**
 * Standalone participant widget for slide-quiz.
 * No Reveal.js dependency — designed for a mobile-friendly audience page.
 *
 * Usage (dynamic — questions come from presenter via sync):
 *   import { createParticipantUI } from 'slide-quiz/participant';
 *   import 'slide-quiz/participant.css';
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
import * as v from "valibot";
import { getQuizParticipant } from "../src/quiz-manager";
import type { ParticipantQuizManager, QuestionPayload } from "../src/quiz-manager";
import { ParticipantConfigSchema } from "../src/quiz-types";
import type { ParticipantConfig } from "../src/quiz-types";
import { CLS } from "./selectors";

export type { ParticipantConfig };

export function createParticipantUI(
  selector: string,
  rawConfig: unknown,
): { destroy: () => void } {
  const parsed = v.safeParse(ParticipantConfigSchema, rawConfig);
  if (!parsed.success) {
    throw new Error(
      `[slide-quiz] Invalid participant config: ${parsed.issues[0].message}`,
    );
  }
  const config = parsed.output;

  const root = document.querySelector<HTMLElement>(selector)!;
  if (!root) {
    throw new Error(`[slide-quiz] Element not found: ${selector}`);
  }

  const { brandText, footerText = "Powered by AnyCable" } = config;

  // ── Build DOM ──
  root.innerHTML = "";
  root.classList.add(CLS.participant);

  // Brand
  if (brandText) {
    const brand = document.createElement("p");
    brand.className = "sq-participant__brand";
    brand.textContent = brandText;
    root.appendChild(brand);
  }

  // Stats
  const stats = document.createElement("div");
  stats.className = "sq-participant__stats";

  const onlineEl = document.createElement("span");
  onlineEl.className = "sq-participant__online";
  onlineEl.textContent = "0";

  const answeredEl = document.createElement("span");
  answeredEl.className = "sq-participant__answered";
  answeredEl.textContent = "0";

  stats.append(onlineEl, " online \u00b7 ", answeredEl, " answered");
  root.appendChild(stats);

  // Waiting message
  const waiting = document.createElement("div");
  waiting.className = "sq-participant__waiting";

  const waitingTitle = document.createElement("p");
  waitingTitle.className = "sq-participant__waiting-title";
  waitingTitle.textContent = "Waiting for the next question\u2026";

  const waitingHint = document.createElement("p");
  waitingHint.className = "sq-participant__waiting-hint";
  waitingHint.textContent = "The presenter will advance to a quiz slide shortly.";

  waiting.append(waitingTitle, waitingHint);
  root.appendChild(waiting);

  // Footer (created early so question sections are inserted before it)
  let footerEl: HTMLElement | null = null;
  if (footerText) {
    footerEl = document.createElement("p");
    footerEl.className = "sq-participant__footer";
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
  // Track voted state to only reset UI on voted → not-voted transitions
  const previouslyVoted = new Set<string>();
  let currentQuestions: QuestionPayload[] = [];
  let currentActiveQuizId: string | null = null;

  function renderQuestionSections(questions: QuestionPayload[]) {
    for (const q of questions) {
      if (renderedQuizIds.has(q.quizId)) continue;
      renderedQuizIds.add(q.quizId);

      const totalCount = questions.length;
      const questionIndex = questions.indexOf(q);

      const section = document.createElement("div");
      section.className = `sq-participant__section ${CLS.sectionHidden}`;
      section.dataset.quizId = q.quizId;
      section.dataset.quizType = q.type || "choice";

      const number = document.createElement("p");
      number.className = "sq-participant__number";
      number.textContent = `Question ${questionIndex + 1} of ${totalCount}`;
      section.appendChild(number);

      const title = document.createElement("h2");
      title.className = "sq-participant__question";
      title.textContent = q.question;
      section.appendChild(title);

      const isText = (q.type || "choice") === "text";

      if (isText) {
        const inputWrapper = document.createElement("div");
        inputWrapper.className = "sq-participant__input-wrapper";

        const input = document.createElement("input");
        input.type = "text";
        input.maxLength = 100;
        input.className = CLS.input;
        input.placeholder = "Type your answer...";

        const submitBtn = document.createElement("button");
        submitBtn.type = "button";
        submitBtn.className = CLS.submit;
        submitBtn.textContent = "Submit";

        inputWrapper.append(input, submitBtn);
        section.appendChild(inputWrapper);
      } else {
        const optionsDiv = document.createElement("div");
        optionsDiv.className = "sq-participant__options";

        for (const opt of q.options) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = CLS.btn;
          btn.dataset.answer = opt.label;
          const btnLabel = document.createElement("span");
          btnLabel.className = "sq-participant__btn-label";
          btnLabel.textContent = opt.label;
          const btnText = document.createElement("span");
          btnText.textContent = opt.text;
          btn.append(btnLabel, btnText);
          optionsDiv.appendChild(btn);
        }
        section.appendChild(optionsDiv);
      }

      const status = document.createElement("p");
      status.className = CLS.status;
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

  function bindClickHandlers(q: QuestionPayload, section: HTMLElement) {
    const statusEl = section.querySelector<HTMLElement>(`.${CLS.status}`)!;

    if (section.dataset.quizType === "text") {
      const input = section.querySelector<HTMLInputElement>(`.${CLS.input}`)!;
      const submitBtn = section.querySelector<HTMLButtonElement>(`.${CLS.submit}`)!;

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
      const buttons = section.querySelectorAll<HTMLButtonElement>(`.${CLS.btn}`);

      async function submitVote(answer: string) {
        for (const b of buttons) {
          b.disabled = true;
          b.setAttribute("aria-disabled", "true");
          if (b.dataset.answer === answer) {
            b.classList.add(CLS.btnSelected);
          } else {
            b.classList.add(CLS.btnFaded);
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
              CLS.btnSelected,
              CLS.btnFaded,
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
        el.classList.remove(CLS.sectionHidden);
      } else {
        el.classList.add(CLS.sectionHidden);
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
    const statusEl = section.querySelector<HTMLElement>(`.${CLS.status}`)!;
    const isText = section.dataset.quizType === "text";

    if (isText) {
      const input = section.querySelector<HTMLInputElement>(`.${CLS.input}`);
      const submitBtn = section.querySelector<HTMLButtonElement>(`.${CLS.submit}`);
      if (input) {
        input.value = answer;
        input.disabled = true;
      }
      if (submitBtn) submitBtn.disabled = true;
    } else {
      const buttons = section.querySelectorAll<HTMLButtonElement>(`.${CLS.btn}`);
      for (const b of buttons) {
        b.disabled = true;
        b.setAttribute("aria-disabled", "true");
        if (b.dataset.answer === answer) {
          b.classList.add(CLS.btnSelected);
        } else {
          b.classList.add(CLS.btnFaded);
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
    const statusEl = section.querySelector<HTMLElement>(`.${CLS.status}`)!;

    if (section.dataset.quizType === "text") {
      const input = section.querySelector<HTMLInputElement>(`.${CLS.input}`);
      const submitBtn = section.querySelector<HTMLButtonElement>(`.${CLS.submit}`);
      if (input) {
        input.value = "";
        input.disabled = false;
      }
      if (submitBtn) submitBtn.disabled = false;
    } else {
      const buttons = section.querySelectorAll<HTMLButtonElement>(`.${CLS.btn}`);
      for (const b of buttons) {
        b.disabled = false;
        b.removeAttribute("aria-disabled");
        b.classList.remove(CLS.btnSelected, CLS.btnFaded);
      }
    }

    statusEl.textContent = "";
  }

  // If questions provided statically, render them now
  if (config.questions) {
    renderQuestionSections(config.questions);
  }

  // ── Sync timeout — detect when connected but no quiz data arrives ──
  let syncTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let syncReceived = false;

  function onSyncReceived() {
    if (syncReceived) return;
    syncReceived = true;
    if (syncTimeoutId) {
      clearTimeout(syncTimeoutId);
      syncTimeoutId = null;
    }
    // Reset hint to default in case warning was shown
    waitingHint.textContent = "The presenter will advance to a quiz slide shortly.";
    waitingHint.classList.remove("sq-participant__waiting-hint--warn");
  }

  function startSyncTimeout() {
    if (syncReceived || syncTimeoutId) return;
    syncTimeoutId = setTimeout(async () => {
      if (syncReceived) return;

      // Probe the sync endpoint to distinguish "presenter not started" from "functions broken"
      try {
        const res = await fetch(manager.endpoints.sync, { method: "GET" });
        if (res.status === 405) {
          // Functions are deployed — presenter just hasn't navigated to a quiz slide
          waitingHint.textContent = "The presenter hasn't started the quiz yet.";
        } else if (res.status === 404) {
          waitingHint.textContent =
            "Quiz functions are not deployed — let the presenter know to redeploy the site.";
          waitingHint.classList.add("sq-participant__waiting-hint--warn");
        } else {
          waitingHint.textContent =
            "Connected, but no quiz data received. Let the presenter know if this persists.";
          waitingHint.classList.add("sq-participant__waiting-hint--warn");
        }
      } catch {
        // Network error — likely running locally or CORS issue
        waitingHint.textContent =
          "Can't reach the quiz server — the site may need to be deployed.";
        waitingHint.classList.add("sq-participant__waiting-hint--warn");
      }
    }, 10_000);
  }

  // ── Store subscriptions ──
  const unsubs: (() => void)[] = [];
  unsubs.push(
    manager.store.questions.subscribe(qs => {
      if (qs.length > 0) onSyncReceived();
      if (!config.questions && qs.length > 0) renderQuestionSections([...qs]);
    }),
    manager.store.activeQuestionId.subscribe(id => {
      if (id) onSyncReceived();
      showQuestion(id);
    }),
    manager.store.online.subscribe(count => {
      onlineEl.textContent = String(count);
      if (count > 0) startSyncTimeout();
    }),
    manager.store.results.subscribe(results => {
      if (currentActiveQuizId && results[currentActiveQuizId]) {
        answeredEl.textContent = String(results[currentActiveQuizId].total);
      }
    }),
    manager.store.submitted.subscribe(submitted => {
      const questionsToCheck = config.questions || currentQuestions;
      for (const q of questionsToCheck) {
        const voted = submitted[q.quizId];
        if (voted) {
          applyVotedUI(q.quizId, voted);
          previouslyVoted.add(q.quizId);
        } else if (previouslyVoted.has(q.quizId)) {
          resetQuizUI(q.quizId);
          previouslyVoted.delete(q.quizId);
        }
      }
    }),
  );

  // ── Cleanup on page hide ──
  function onPageHide() {
    manager.disconnect();
  }
  window.addEventListener("pagehide", onPageHide);

  // ── Return destroy handle ──
  return {
    destroy() {
      if (syncTimeoutId) clearTimeout(syncTimeoutId);
      for (const unsub of unsubs) unsub();
      window.removeEventListener("pagehide", onPageHide);
      manager.disconnect();
      root.innerHTML = "";
      root.classList.remove(CLS.participant);
    },
  };
}
