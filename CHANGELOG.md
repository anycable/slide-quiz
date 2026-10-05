# Changelog

All notable changes to `slide-quiz` and `slidev-addon-slide-quiz` are listed here. The two packages version independently; each entry names the package it applies to.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### slide-quiz

#### Added
- Multi-select questions: `type: multi` (Slidev) or `data-quiz-type="multi"` (Reveal.js). Participants tick any number of options and press Submit, and can change their selection. Each result bar shows the share of respondents who picked that option, so `total` stays the number of respondents and the bars may sum past 100%. The question slide shows "Select all that apply" and the results slide says the bars are a share of respondents.
- `MultiAnswerSchema` and `encodeMultiAnswer`. A multi-select answer travels as a JSON array of labels inside the existing `answer` string, so the answer function is unchanged.
- The presenter counts only labels that are among the question's options, so a crafted answer cannot grow the vote map or the sync payload. An audience page older than this release treats a multi-select question as single choice and sends a bare label; the presenter counts that as a one-option pick instead of dropping it.

#### Changed
- The serverless functions accept `type: "multi"` in the sync payload. Decks that use multi-select questions must redeploy the functions; older ones answer 400.

#### Fixed
- The audience page stayed on "Waiting" when the active quiz id arrived one sync before its question, which happens every time the presenter loads or refreshes the deck on a quiz slide. The question now shows as soon as its section is rendered.
- A presenter refresh kept the results but forgot who voted what. The next answer reset `total` to the number of participants who answered since the refresh, so bars could show more than 100%, and a changed vote was counted twice. The presenter now saves each participant's answer with the results.
- Answers that arrived before the presenter knew their question (in the first moments after the deck loads) were counted as single choice: free text was not lowercased, and a multi-select answer counted as one unknown option. They are now counted again when the question arrives, and again whenever a question's type changes.
- Changing a single-choice or free-text answer left "Sending..." on screen when the request failed. The audience page now shows an error, and a single-choice question shows the vote that still counts.
- After a reload, the audience page restored the participant's vote but did not show it: buttons were unselected and the "submitted" line was empty. The restored vote is now applied when the question is rendered.

### slidev-addon-slide-quiz

#### Added
- `type: multi` on the `quiz` and `quiz-results` layouts.

#### Fixed
- Slidev mounts every slide shortly after the deck loads, and each `quiz` and `quiz-results` layout activated its question on mount. Phones flipped through questions while the presenter was still on the cover. Only the slide on screen activates its question now.
- `quiz-results` rendered a misspelled `type` (such as `type: mulit`) as single choice and registered it with the presenter, so the sync function answered 400 once the slide was shown. It now shows an "Unknown quiz type" error, like the `quiz` layout.
- When a `quiz` slide and a `quiz-results` slide share a `quizId`, the `quiz` slide's question definition is used, whichever mounts first. A results slide without `type: multi` (or `type: text`) could otherwise make the presenter count the answers as single choice, leaving every bar at 0.
- Option `label` and `text` written as bare YAML numbers (`text: 27`) were sent as numbers, and the sync function rejected the question with a 400. The layouts now convert them to strings.

## 0.4.2 (slidev-addon-slide-quiz), 2026-09-07

- README: the audience page must be copied into the deck's `public/` folder and `quizUrl` set to `/quiz.html`. Where Slidev places addon assets differs between Slidev versions, so the earlier `/theme/quiz.html` advice only held on Slidev 0.50. No code changes. (0.4.1 was bumped locally but never published.)

## 0.6.0 (slide-quiz) / 0.4.0 (slidev-addon-slide-quiz), 2026-09-07

### slide-quiz 0.6.0

#### Added
- `onError` option on the Reveal.js plugin config, `getQuizPresenter`, `getQuizParticipant`, and `createParticipantUI`, plus a `manager.onError(handler)` method. Handlers receive a `QuizError` (`kind`, `message`, `cause`, `context`) for connection, sync, answer, and invalid-payload failures. slide-quiz never reports anywhere on its own; this is the hook for wiring your own Sentry or console logging.
- WebSocket connection monitoring. `manager.store.connection` tracks `connecting | connected | disconnected | closed`, and `manager.store.connectionError` is set when the cable stays down for more than five seconds. The Reveal.js plugin, the Slidev addon, and the audience page all surface it on screen.
- Agent skills in `skills/`: `slide-quiz-setup` (add quizzes to an existing deck and deploy) and `slide-quiz-debug` (checklist for a quiz that does not work). Shipped inside the npm package.
- GitHub Actions CI, issue and PR templates, CONTRIBUTING.md, SECURITY.md, and this changelog.

#### Changed
- Sync failures now call `onError` on every failed request. The on-screen banner still waits for two consecutive failures.
- Exported types: `QuizError`, `QuizErrorKind`, `QuizErrorHandler`, `ConnectionStatus`.

#### Fixed
- Vercel functions never worked in an ESM project (every Slidev deck). Two causes, both found by deploying for real: the extensionless `./shared` import fails under Node's ESM resolver, and the default-export Web handler was treated as a Node `(req, res)` handler, so every request timed out. The functions now import `./shared.js` and export named `GET`/`POST`/`OPTIONS` handlers.
- The `sendSync throttles rapid calls` test looped forever against the keepalive timer.

### slidev-addon-slide-quiz 0.4.0

#### Fixed
- Custom `endpoints` (Vercel) never reached the audience page, so votes posted to the Netlify path and failed. The QR code URL now carries `answer` and `sync` parameters and the shipped `quiz.html` reads them.
- Docs said `quizUrl: /quiz.html` without saying the page must be copied into the deck's `public/` folder, so the QR code pointed at a 404. Docs now include the copy command. (The 0.4.0 README briefly said `/theme/quiz.html`; that path only holds on Slidev 0.50.)

#### Changed
- Requires `slide-quiz` ^0.6.0.
- The error banner component shows connection errors as well as sync errors.
- The QR URL is built in one place, `useQuizUrl()` in `composables/useQuizManager.ts`, instead of three components.
- Removed `public/_redirects` from the addon. Slidev copied it to `/theme/_redirects`, where Netlify ignores it. Add `public/_redirects` to your own deck instead (documented in the README).

## 0.5.2 (slide-quiz) / 0.3.2 (slidev-addon-slide-quiz), 2026-03-19

- Fix quiz slides not activating on deep-link navigation
- Fix participant bundle crashing in browsers (`process is not defined`)
- Readme: free-text quiz example for Slidev, AnyCable Plus CLI instructions

## 0.5.1 (slide-quiz) / 0.3.1 (slidev-addon-slide-quiz), 2026-03-14

- Replace whisper-based state with a 120 second keepalive sync so late joiners receive history

Earlier releases are in the [git history](https://github.com/anycable/slide-quiz/commits/main).
