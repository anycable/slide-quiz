import { renderQR } from "./render-qr";
import type { QuizOption } from "../quiz-types";

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
  let options: QuizOption[] = [];

  try {
    options = JSON.parse(slide.dataset.quizOptions || "[]");
  } catch {
    console.warn(`[live-quiz] Invalid data-quiz-options on quiz "${quizId}"`);
    return;
  }

  // Wrapper
  const wrapper = document.createElement("div");
  wrapper.className = "lq-question";

  // Title
  const title = document.createElement("h2");
  title.className = "lq-question__title";
  title.textContent = titleText;
  wrapper.appendChild(title);

  // Body (QR + question side-by-side)
  const body = document.createElement("div");
  body.className = "lq-question__body";

  // QR side (only if quizUrl provided)
  if (quizUrl) {
    const qrSide = document.createElement("div");
    qrSide.className = "lq-question__qr-side";

    const qrImg = await renderQR(quizUrl);
    qrSide.appendChild(qrImg);

    const urlLabel = document.createElement("p");
    urlLabel.className = "lq-question__url";
    urlLabel.textContent = quizUrl.replace(/^https?:\/\//, "");
    qrSide.appendChild(urlLabel);

    body.appendChild(qrSide);
  }

  // Question side
  const questionSide = document.createElement("div");
  questionSide.className = "lq-question__content";

  const questionText = document.createElement("p");
  questionText.className = "lq-question__text";
  questionText.textContent = question;
  questionSide.appendChild(questionText);

  // Options grid
  const optionsGrid = document.createElement("div");
  optionsGrid.className = "lq-question__options";

  for (const opt of options) {
    const optEl = document.createElement("div");
    optEl.className = "lq-question__option";

    const label = document.createElement("span");
    label.className = "lq-question__option-label";
    label.textContent = opt.label;

    const text = document.createElement("span");
    text.className = "lq-question__option-text";
    text.textContent = opt.text;

    optEl.appendChild(label);
    optEl.appendChild(text);
    optionsGrid.appendChild(optEl);
  }
  questionSide.appendChild(optionsGrid);

  // Counter row
  const counterRow = document.createElement("div");
  counterRow.className = "lq-question__counter";

  const onlineSpan = document.createElement("span");
  onlineSpan.className = "lq-online";
  onlineSpan.dataset.lqQuiz = quizId;
  onlineSpan.textContent = "0";

  const answeredSpan = document.createElement("span");
  answeredSpan.className = "lq-answered";
  answeredSpan.dataset.lqQuiz = quizId;
  answeredSpan.textContent = "0";

  counterRow.append(onlineSpan, " online \u00b7 ", answeredSpan, " answered");
  questionSide.appendChild(counterRow);

  body.appendChild(questionSide);
  wrapper.appendChild(body);
  slide.appendChild(wrapper);
}
