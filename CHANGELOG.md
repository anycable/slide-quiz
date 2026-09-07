# Changelog

All notable changes to `slide-quiz` and `slidev-addon-slide-quiz` are listed here. The two packages version independently; each entry names the package it applies to.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

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
- Docs said `quizUrl: /quiz.html`, but Slidev serves addon assets under `/theme/`, so the QR code pointed at a 404. Docs now say `/theme/quiz.html` and explain how to move the page.

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
