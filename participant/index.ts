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
import { ParticipantConfigSchema, MultiAnswerSchema, encodeMultiAnswer, MULTI_HINT } from "../src/quiz-types";
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

  // The deck's accent colour, so the phone matches the slides. Only a valid
  // CSS colour is applied; the value comes from a URL parameter.
  const accentApplied = !!config.accent && CSS.supports("color", config.accent);
  if (accentApplied) document.documentElement.style.setProperty("--sq-p-accent", config.accent!);

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

  // Hidden while waiting: "answered" only means something for a live question
  const answeredWrap = document.createElement("span");
  answeredWrap.append(" \u00b7 ", answeredEl, " answered");
  answeredWrap.hidden = true;

  stats.append(onlineEl, " online", answeredWrap);
  root.appendChild(stats);

  // Waiting message
  const waiting = document.createElement("div");
  waiting.className = "sq-participant__waiting";

  const waitingTitle = document.createElement("p");
  waitingTitle.className = "sq-participant__waiting-title";
  waitingTitle.textContent = "Waiting for the next question\u2026";

  const DEFAULT_HINT = "The presenter will advance to a quiz slide shortly.";
  const CONNECTION_HINT = "Can't connect to the quiz server. Check your network, or let the presenter know.";
  const waitingHint = document.createElement("p");
  waitingHint.className = "sq-participant__waiting-hint";
  waitingHint.textContent = DEFAULT_HINT;

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
    onError: config.onError,
  });

  // Question sections (keyed by quizId)
  const sectionEls: Record<string, HTMLElement> = {};
  // Track which quizIds have been rendered to avoid re-rendering on every sync
  const renderedQuizIds = new Set<string>();
  // The answer last shown per quiz, so the UI changes only when it does:
  // resets on voted → not-voted, and leaves unsent multi-select ticks alone
  const previouslyVoted = new Map<string, string>();
  let currentQuestions: QuestionPayload[] = [];
  let currentActiveQuizId: string | null = null;
  // Multi-select: the options currently ticked on screen, per quiz
  const multiSelections: Record<string, Set<string>> = {};

  function decodeMulti(answer: string | null): string[] {
    if (!answer) return [];
    const parsed = v.safeParse(MultiAnswerSchema, answer);
    return parsed.success ? parsed.output : [];
  }

  function optionText(section: HTMLElement, label: string): string {
    return section.querySelector(`[data-answer="${CSS.escape(label)}"] .${CLS.btnText}`)?.textContent || label;
  }

  const CHANGE_HINT: Record<string, string> = {
    choice: "Tap another option to change your answer.",
    multi: "Change your picks and submit again to update them.",
    text: "Edit it and submit again to change your answer.",
  };

  function showStatus(section: HTMLElement, text: string) {
    const statusEl = section.querySelector<HTMLElement>(`.${CLS.status}`)!;
    statusEl.classList.remove(CLS.statusError);
    statusEl.textContent = text;
  }

  /** "X — submitted!", plus a line saying the answer can still be changed. */
  function showSubmitted(section: HTMLElement, text: string) {
    showStatus(section, "");
    const statusEl = section.querySelector<HTMLElement>(`.${CLS.status}`)!;
    const strong = document.createElement("strong");
    strong.textContent = text;
    const note = document.createElement("span");
    note.className = "sq-participant__status-note";
    note.textContent = CHANGE_HINT[section.dataset.quizType || "choice"];
    statusEl.append(strong, " \u2014 submitted!", note);
  }

  /** A failed send. Says whether an earlier answer still counts. */
  function showSendError(section: HTMLElement, quizId: string) {
    showStatus(
      section,
      manager.hasVoted(quizId)
        ? "Couldn't send your change. Your earlier answer still counts; try again."
        : "Couldn't send your answer. Try again.",
    );
    section.querySelector(`.${CLS.status}`)!.classList.add(CLS.statusError);
  }

  /** Reflect the ticked options on the buttons and the submit button. */
  function renderMultiSelection(quizId: string) {
    const section = sectionEls[quizId];
    if (!section) return;
    const selected = multiSelections[quizId] ?? new Set<string>();
    for (const b of section.querySelectorAll<HTMLButtonElement>(`.${CLS.btn}`)) {
      const on = selected.has(b.dataset.answer || "");
      b.classList.toggle(CLS.btnSelected, on);
      b.classList.remove(CLS.btnFaded);
      b.setAttribute("aria-pressed", String(on));
    }
    const submitBtn = section.querySelector<HTMLButtonElement>(`.${CLS.submit}`);
    if (submitBtn) {
      submitBtn.disabled =
        selected.size === 0 ||
        encodeMultiAnswer([...selected]) === manager.getVotedAnswer(quizId);
    }
  }

  function renderQuestionSections(questions: QuestionPayload[]) {
    for (const q of questions) {
      if (renderedQuizIds.has(q.quizId)) continue;
      renderedQuizIds.add(q.quizId);

      const section = document.createElement("div");
      section.className = `sq-participant__section ${CLS.sectionHidden}`;
      section.dataset.quizId = q.quizId;
      section.dataset.quizType = q.type || "choice";

      const number = document.createElement("p");
      number.className = "sq-participant__number";
      // Label set dynamically by showQuestion
      section.appendChild(number);

      const title = document.createElement("h2");
      title.className = "sq-participant__question";
      title.textContent = q.question;
      section.appendChild(title);

      const isText = (q.type || "choice") === "text";
      const isMulti = q.type === "multi";

      if (isText && q.hint) {
        const hint = document.createElement("p");
        hint.className = "sq-participant__hint";
        hint.textContent = q.hint;
        section.appendChild(hint);
      }

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
          btnText.className = CLS.btnText;
          btnText.textContent = opt.text;
          btn.append(btnLabel, btnText);
          if (isMulti) {
            // A checkbox mark, so several picks read as allowed
            const check = document.createElement("span");
            check.className = "sq-participant__check";
            check.setAttribute("aria-hidden", "true");
            btn.append(check);
            btn.setAttribute("aria-pressed", "false");
          }
          optionsDiv.appendChild(btn);
        }

        if (isMulti) {
          const hint = document.createElement("p");
          hint.className = "sq-participant__hint";
          hint.textContent = q.hint ?? MULTI_HINT;
          section.appendChild(hint);
        }
        section.appendChild(optionsDiv);

        if (isMulti) {
          const submitBtn = document.createElement("button");
          submitBtn.type = "button";
          submitBtn.className = `${CLS.submit} sq-participant__submit--multi`;
          submitBtn.textContent = "Submit";
          submitBtn.disabled = true;
          section.appendChild(submitBtn);
        }
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

      // A vote restored from sessionStorage arrives before the section exists;
      // show it now that the section does.
      const voted = manager.getVotedAnswer(q.quizId);
      if (voted) {
        applyVotedUI(q.quizId, voted);
        previouslyVoted.set(q.quizId, voted);
      }
    }

    currentQuestions = questions;

    // The active quiz id can arrive one sync before its question. The id does
    // not change when the question lands, so show it now that its section exists.
    if (currentActiveQuizId) showQuestion(currentActiveQuizId);
  }

  function bindClickHandlers(q: QuestionPayload, section: HTMLElement) {

    if (section.dataset.quizType === "multi") {
      const buttons = section.querySelectorAll<HTMLButtonElement>(`.${CLS.btn}`);
      const submitBtn = section.querySelector<HTMLButtonElement>(`.${CLS.submit}`)!;
      multiSelections[q.quizId] ??= new Set(decodeMulti(manager.getVotedAnswer(q.quizId)));

      for (const btn of buttons) {
        btn.addEventListener("click", () => {
          const label = btn.dataset.answer;
          if (!label) return;
          const selected = multiSelections[q.quizId];
          if (selected.has(label)) selected.delete(label);
          else selected.add(label);
          renderMultiSelection(q.quizId);

          const voted = manager.getVotedAnswer(q.quizId);
          if (!voted) showStatus(section, "");
          else if (encodeMultiAnswer([...selected]) === voted) showVotedMulti(section, voted);
          else showStatus(section, "Not sent yet. Tap Submit to update your answer.");
        });
      }

      submitBtn.addEventListener("click", async () => {
        const labels = [...multiSelections[q.quizId]];
        if (labels.length === 0) return;
        const answer = encodeMultiAnswer(labels);
        if (answer === manager.getVotedAnswer(q.quizId)) return;

        submitBtn.disabled = true;
        for (const b of buttons) b.disabled = true;
        showStatus(section, "Sending...");

        const ok = await manager.submitAnswer(q.quizId, answer);

        for (const b of buttons) b.disabled = false;
        if (ok) showVotedMulti(section, answer);
        else showSendError(section, q.quizId);
        renderMultiSelection(q.quizId);
      });
    } else if (section.dataset.quizType === "text") {
      const input = section.querySelector<HTMLInputElement>(`.${CLS.input}`)!;
      const submitBtn = section.querySelector<HTMLButtonElement>(`.${CLS.submit}`)!;

      async function submitText() {
        const answer = input.value.trim();
        if (!answer || answer === manager.getVotedAnswer(q.quizId)) return;

        input.disabled = true;
        submitBtn.disabled = true;
        showStatus(section, "Sending...");

        const ok = await manager.submitAnswer(q.quizId, answer);

        // Re-enable input (allow changing answer)
        input.disabled = false;
        submitBtn.disabled = false;

        // On failure the input keeps the new text so the participant can retry
        if (ok) showSubmitted(section, answer);
        else showSendError(section, q.quizId);
      }

      submitBtn.addEventListener("click", submitText);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submitText();
      });
    } else {
      const buttons = section.querySelectorAll<HTMLButtonElement>(`.${CLS.btn}`);

      async function submitVote(answer: string) {
        // Disable during submission
        for (const b of buttons) {
          b.disabled = true;
          b.setAttribute("aria-disabled", "true");
          if (b.dataset.answer === answer) {
            b.classList.add(CLS.btnSelected);
            b.classList.remove(CLS.btnFaded);
          } else {
            b.classList.remove(CLS.btnSelected);
            b.classList.add(CLS.btnFaded);
          }
        }
        showStatus(section, "Sending...");

        const ok = await manager.submitAnswer(q.quizId, answer);

        // Re-enable buttons (allow changing vote)
        for (const b of buttons) {
          b.disabled = false;
          b.removeAttribute("aria-disabled");
        }

        if (ok) {
          showSubmitted(section, optionText(section, answer));
        } else {
          const previous = manager.getVotedAnswer(q.quizId);
          if (previous) {
            // Changing the vote failed; the previous one still counts, so show it.
            applyVotedUI(q.quizId, previous);
          } else {
            for (const b of buttons) {
              b.classList.remove(CLS.btnSelected, CLS.btnFaded);
            }
          }
          showSendError(section, q.quizId);
        }
      }

      for (const btn of buttons) {
        btn.addEventListener("click", () => {
          const answer = btn.dataset.answer;
          if (answer && answer !== manager.getVotedAnswer(q.quizId)) submitVote(answer);
        });
      }
    }
  }

  /** "N answered" counts the question on screen; 0 before its first answer or while waiting. */
  function updateAnswered() {
    const results = manager.store.results.get();
    answeredEl.textContent = String((currentActiveQuizId && results[currentActiveQuizId]?.total) || 0);
    answeredWrap.hidden = !currentActiveQuizId;
  }

  function showQuestion(quizId: string | null) {
    currentActiveQuizId = quizId;
    updateAnswered();
    for (const [id, el] of Object.entries(sectionEls)) {
      if (id === quizId) {
        el.classList.remove(CLS.sectionHidden);
        // Update "Question X of Y" label
        const num = el.querySelector(".sq-participant__number");
        if (num) {
          if (config.questions) {
            const idx = config.questions.findIndex(q => q.quizId === id);
            num.textContent = `Question ${idx + 1} of ${config.questions.length}`;
          } else {
            const idx = manager.store.questionIndex.get();
            const total = manager.store.totalCount.get();
            if (total > 0) {
              num.textContent = `Question ${idx + 1} of ${total}`;
            }
          }
        }
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
    const isText = section.dataset.quizType === "text";

    if (section.dataset.quizType === "multi") {
      const labels = decodeMulti(answer);
      multiSelections[quizId] = new Set(labels);
      renderMultiSelection(quizId);
      showVotedMulti(section, answer);
      return;
    }

    if (isText) {
      const input = section.querySelector<HTMLInputElement>(`.${CLS.input}`);
      if (input) input.value = answer;
    } else {
      const buttons = section.querySelectorAll<HTMLButtonElement>(`.${CLS.btn}`);
      for (const b of buttons) {
        if (b.dataset.answer === answer) {
          b.classList.add(CLS.btnSelected);
          b.classList.remove(CLS.btnFaded);
        } else {
          b.classList.remove(CLS.btnSelected);
          b.classList.add(CLS.btnFaded);
        }
      }
    }

    showSubmitted(section, isText ? answer : optionText(section, answer));
  }

  function showVotedMulti(section: HTMLElement, answer: string) {
    showSubmitted(section, decodeMulti(answer).map((l) => optionText(section, l)).join(", "));
  }

  function resetQuizUI(quizId: string) {
    const section = sectionEls[quizId];
    if (!section) return;

    if (section.dataset.quizType === "multi") {
      multiSelections[quizId] = new Set();
      for (const b of section.querySelectorAll<HTMLButtonElement>(`.${CLS.btn}`)) b.disabled = false;
      renderMultiSelection(quizId);
    } else if (section.dataset.quizType === "text") {
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

    showStatus(section, "");
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
    // The presenter may renumber questions as its slides register (after a
    // refresh, the slide on screen registers first); keep the label current.
    manager.store.questionIndex.listen(() => showQuestion(currentActiveQuizId)),
    manager.store.totalCount.listen(() => showQuestion(currentActiveQuizId)),
    manager.store.online.subscribe(count => {
      onlineEl.textContent = String(count);
      if (count > 0) startSyncTimeout();
    }),
    manager.store.connectionError.subscribe(error => {
      if (error) {
        waitingHint.textContent = CONNECTION_HINT;
        waitingHint.classList.add("sq-participant__waiting-hint--warn");
      } else if (waitingHint.textContent === CONNECTION_HINT) {
        // Only undo our own message; the sync probe may have set a different hint.
        waitingHint.textContent = DEFAULT_HINT;
        waitingHint.classList.remove("sq-participant__waiting-hint--warn");
      }
    }),
    manager.store.results.subscribe(() => updateAnswered()),
    manager.store.submitted.subscribe(submitted => {
      const questionsToCheck = config.questions || currentQuestions;
      for (const q of questionsToCheck) {
        const voted = submitted[q.quizId];
        if (voted) {
          if (previouslyVoted.get(q.quizId) === voted) continue;
          applyVotedUI(q.quizId, voted);
          previouslyVoted.set(q.quizId, voted);
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
      if (accentApplied) document.documentElement.style.removeProperty("--sq-p-accent");
    },
  };
}
