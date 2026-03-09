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
    <div class="sq-question__qr-side">
      ${qrImg}
      <p class="sq-question__url">
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
    console.warn(`[slide-quiz] Invalid data-quiz-options on quiz "${quizId}"`);
    return null;
  }

  return html`
    <div class="sq-question__options">
      ${parsed.output.map(
        (opt) => html`
          <div class="sq-question__option">
            <span class="sq-question__option-label">${opt.label}</span>
            <span class="sq-question__option-text">${opt.text}</span>
          </div>
        `,
      )}
    </div>
  `;
}

function renderCounter(quizId: string): Child {
  return html`
    <div class="sq-question__counter">
      <span class="${CLS.online}" data-sq-quiz="${quizId}">0</span>
      online ·
      <span class="${CLS.answered}" data-sq-quiz="${quizId}">0</span>
      answered
    </div>
  `;
}

function renderQuestionContent(
  quizId: string,
  quizType: string,
  question: string,
  rawOptions: string | undefined,
  hintText: string | undefined,
): Child {
  const body =
    quizType === "text" && hintText
      ? html`
          <p class="sq-question__hint">${hintText}</p>
        `
      : quizType === "text"
        ? null
        : renderOptions(quizId, rawOptions);

  return html`
    <div class="sq-question__content">
      <p class="sq-question__text">${question}</p>
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
  titleText?: string,
  hintText?: string,
): Promise<void> {
  const quizId = slide.dataset.quizId!;
  const question = slide.dataset.quizQuestion || "";
  const quizType = v.parse(QuizTypeSchema, slide.dataset.quizType);

  const qrBlock = await renderQRBlock(quizUrl, slide);

  const fragment = html`
    <div class="${CLS.question}">
      ${titleText ? html`<h2 class="sq-question__title">${titleText}</h2>` : null}
      <div class="sq-question__body">
        ${qrBlock}
        ${renderQuestionContent(quizId, quizType, question, slide.dataset.quizOptions, hintText)}
      </div>
    </div>
  `;

  slide.appendChild(fragment);
}
