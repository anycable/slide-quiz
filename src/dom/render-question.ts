import * as v from "valibot";
import { renderQR } from "./render-qr";
import { html, type Child } from "./html";
import { CLS } from "./selectors";
import { JsonQuizOptionsSchema, QuizTypeSchema } from "../quiz-types";

async function renderQRBlock(
  quizUrl: string | undefined,
  slide: HTMLElement,
): Promise<Child> {
  if (!quizUrl) return null;

  const qrImg = await renderQR(quizUrl, 240, slide);

  return html`
    <div class="lq-question__qr-side">
      ${qrImg}
      <p class="lq-question__url">
        ${quizUrl.replace(/^https?:\/\//, "")}
      </p>
    </div>
  `;
}

function renderOptions(
  quizId: string,
  rawOptions: string | undefined,
): Child {
  const parsed = v.safeParse(JsonQuizOptionsSchema, rawOptions);

  if (!parsed.success) {
    console.warn(`[live-quiz] Invalid data-quiz-options on quiz "${quizId}"`);
    return null;
  }

  return html`
    <div class="lq-question__options">
      ${parsed.output.map(
        (opt) => html`
          <div class="lq-question__option">
            <span class="lq-question__option-label">${opt.label}</span>
            <span class="lq-question__option-text">${opt.text}</span>
          </div>
        `,
      )}
    </div>
  `;
}

function renderCounter(quizId: string): Child {
  return html`
    <div class="lq-question__counter">
      <span class="${CLS.online}" data-lq-quiz="${quizId}">0</span>
      online ·
      <span class="${CLS.answered}" data-lq-quiz="${quizId}">0</span>
      answered
    </div>
  `;
}

function renderQuestionContent(
  quizId: string,
  quizType: string,
  question: string,
  rawOptions: string | undefined,
): Child {
  const body =
    quizType === "text"
      ? html`
          <p class="lq-question__hint">
            Open your phone and type your answer!
          </p>
        `
      : renderOptions(quizId, rawOptions);

  return html`
    <div class="lq-question__content">
      <p class="lq-question__text">${question}</p>
      ${body}
      ${renderCounter(quizId)}
    </div>
  `;
}

/**
 * Inject question UI into a `<section data-quiz-id>` slide.
 * Reads data attributes, builds the full quiz DOM.
 */
export async function renderQuestion(
  slide: HTMLElement,
  quizUrl: string | undefined,
  titleText = "Pop quiz!",
): Promise<void> {
  const quizId = slide.dataset.quizId!;
  const question = slide.dataset.quizQuestion || "";
  const quizType = v.parse(QuizTypeSchema, slide.dataset.quizType);

  const qrBlock = await renderQRBlock(quizUrl, slide);

  const fragment = html`
    <div class="${CLS.question}">
      <h2 class="lq-question__title">${titleText}</h2>
      <div class="lq-question__body">
        ${qrBlock}
        ${renderQuestionContent(quizId, quizType, question, slide.dataset.quizOptions)}
      </div>
    </div>
  `;

  slide.appendChild(fragment);
}
