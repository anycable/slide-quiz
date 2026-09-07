---
name: slide-quiz-debug
description: Diagnose a slide-quiz deck where the audience cannot join, votes do not appear, the QR code is missing, the presenter shows a red banner, or the audience page is stuck on "Waiting". Use when a Reveal.js or Slidev presentation with slide-quiz / slidev-addon-slide-quiz is not working, or before filing a bug report against anycable/slide-quiz.
---

# Debug a slide-quiz deck

slide-quiz has no server of its own and collects no telemetry, so every problem is visible from three places: the presenter's browser console, the audience page's console, and the host's serverless function logs. This skill walks those in the order that finds the cause fastest.

Work through the sections in order. Each one starts with the symptom it explains. Stop at the first fix that works and re-run the verification at the end.

## 0. Collect the facts first

Before changing anything, record:

- Framework and versions: `npm ls slide-quiz slidev-addon-slide-quiz reveal.js @slidev/cli`
- Host (Netlify or Vercel) and the deployed URL
- Whether the problem is on the deployed site or on `localhost`
- The `slideQuiz` config block (from `Reveal.initialize` or the Slidev headmatter)
- The presenter console, filtered by `slide-quiz`
- Any text in a red banner at the bottom of the deck, quoted exactly

These are also the fields in the bug report template, so if the checks below do not resolve it, the report is already written.

## 1. Running on localhost

**Symptom:** banner reads "Sync won't work locally — deploy your site", or the audience page says "Can't reach the quiz server".

This is expected. The serverless functions do not run under `npm run dev`, and phones cannot reach `localhost`. Deploy to Netlify or Vercel and test there. `netlify dev` does run the functions locally, but the audience still needs a public URL, so it only helps with function debugging.

## 2. Presenter cannot reach AnyCable

**Symptom:** banner reads "Can't connect to AnyCable at wss://..." or "AnyCable closed the connection". No `online` count. In the console the cable reconnects repeatedly.

Check in this order:

1. `wsUrl` starts with `wss://` and ends with `/cable`. A common slip is pasting the Broadcast URL (`https://.../_broadcast`) into `wsUrl`.
2. The cable exists and is running: `anycable-plus cable list`, or the dashboard at https://plus.anycable.io. A freshly created cable can take a minute to provision.
3. Reason `unauthorized` in the banner or console means the cable has an application secret set. slide-quiz needs **public streams mode**. Clear the secret in the dashboard, or recreate the cable with `anycable-plus cable create <name> --public --wait`.
4. From a terminal, confirm the host answers: `curl -si https://<cable-host>/health` should return 200.

## 3. Functions are missing or misrouted

**Symptom:** banner reads "Sync function not found at ...", or the audience page says "Quiz functions are not deployed". Presenter console shows `Sync failed (404)`.

1. Hit the endpoint directly with GET. Expect `405 {"error":"Method not allowed"}`:
   ```sh
   curl -si https://<site>/.netlify/functions/quiz-sync     # Netlify
   curl -si https://<site>/api/quiz-sync                    # Vercel
   ```
   - 404 on Netlify: the files are not in `netlify/functions/`, or they were not included in the deploy. They must have the `.mts` extension.
   - 404 on Vercel: the files are not in `api/` at the repo root, or the `endpoints` block is missing from the `slideQuiz` config so the deck is calling the Netlify path.
   - 200 with HTML: a SPA rewrite is catching the function route. On Netlify, function paths are resolved before `_redirects`, so this points at a `netlify.toml` rewrite or a Vercel `rewrites` rule that is too broad. The rule should be `/*  /index.html  200` (Netlify) or exclude `/api/*` (Vercel).
2. Confirm the runtime deps are installed in the project (the functions import them): `@anycable/serverless-js` and `valibot` must be in the deck's own `package.json`, since the host installs from there and does not see `node_modules/slide-quiz`.

## 4. Functions run but broadcasting fails

**Symptom:** banner reads "Sync function error (502)". Function logs show `[quiz-sync] broadcast failed`.

1. Check `ANYCABLE_BROADCAST_URL` is set on the host for the production context, and that it is the `https://.../_broadcast` URL from the cable, not the `wss://` one.
2. If the cable has a broadcast key, set `ANYCABLE_BROADCAST_KEY` too. Public-mode cables created with `--public` do not need one.
3. Redeploy after changing environment variables. Netlify and Vercel do not apply new env vars to an existing build.
4. Reproduce from a terminal to see the function's own response:
   ```sh
   curl -si -X POST https://<site>/.netlify/functions/quiz-sync \
     -H 'Content-Type: application/json' \
     -d '{"activeQuestionId":null,"sessionId":"debug","quizGroupId":"<id>","results":{}}'
   ```
   A 400 with `Invalid field: ...` means the payload shape does not match; that would be a slide-quiz bug worth reporting with the exact field name.

## 5. Audience page connects but stays on "Waiting"

**Symptom:** the `online` counter on the deck increments, but phones never see a question.

1. The deck must be on a quiz slide. Navigating to a non-quiz slide broadcasts `activeQuestionId: null`, which the audience page renders as "Waiting for the next question".
2. `quizGroupId` on the audience page must match the deck exactly. For Slidev, the QR code URL passes it as a query parameter; if the user typed the URL by hand it is missing, and the shipped `quiz.html` falls back to the demo group. Scan the QR code, or append `?wsUrl=...&quizGroupId=...`.
3. Two presenter tabs open with the same `quizGroupId` will fight: each ignores the other's sync and broadcasts its own state. Close all but one.
4. Sync history: late joiners receive the last five minutes of the sync stream. If the presenter has been idle on a quiz slide for longer than that, the keepalive (every 120 seconds) should still cover it. If it does not, the keepalive timer was cancelled, which happens after `destroy()`; reload the deck.
5. The audience page ran a probe after ten seconds without sync and shows a specific hint. Quote that hint; it distinguishes "functions missing" from "presenter idle".

## 6. Votes are cast but results do not move

**Symptom:** the audience page says "submitted!", the `answered` count stays at zero on the deck.

1. The answer function broadcasts to `quiz:<quizGroupId>:results`, and the presenter subscribes to the same stream. Check the function log line `[quiz-answer]` shows the same `quizGroupId` as the presenter console's `subscribing to stream:` line.
2. The presenter ignores answers carrying its own `sessionId`. A phone that shares `sessionStorage` with the presenter (same browser profile, same tab group) can collide. Use a different browser or a private window.
3. For free-text questions, answers are trimmed and lowercased before counting, so "React" and "react " are one word. This is by design.
4. Results persist in the presenter's `sessionStorage`. To reset, close the presenter tab and reopen it. Reloading keeps the results.

## 7. Slide or QR code does not render

**Symptom:** the quiz slide is blank, or no QR code appears.

- Reveal.js: `data-quiz-options` must be valid JSON in single quotes. The plugin logs `Failed to render question slide` with the parse error. Check for smart quotes or trailing commas.
- Reveal.js: the plugin must be in `plugins: [...]` and `slide-quiz/style.css` must be imported. A missing config logs `Missing required config: wsUrl and quizGroupId`.
- Slidev: the addon must be listed under `addons:` in the headmatter, and the `slideQuiz` block must be in the same headmatter, not in a later slide's frontmatter. A missing or invalid config renders an inline error box on the quiz layout with the field name.
- No QR code but everything else works: `quizUrl` is unset. Set it to the audience page URL.
- Scanning the QR code gives a 404 on a Slidev deck: Slidev serves addon assets under `/theme/`, so the shipped page is at `/theme/quiz.html`. Set `quizUrl: /theme/quiz.html`, or copy the page into the deck's own `public/` folder if `quizUrl: /quiz.html` is wanted.
- Slides jumped to via a deep link (`#/5`) not activating: fixed in slide-quiz 0.5.2, upgrade.
- Audience page crashes with `process is not defined`: fixed in slide-quiz 0.5.2, upgrade.

## 8. Everything above passes and it still fails

File a bug at https://github.com/anycable/slide-quiz/issues/new?template=bug_report.yml with the facts from section 0, which section you got stuck on, and the curl output. A link to the deployed deck is the single most useful thing to include.

## Verification after a fix

1. `curl -si` on the sync endpoint returns 405.
2. Presenter console shows `subscribing to stream:` and no banner after ten seconds.
3. Audience page opened from the QR code shows the `online` count going up on the deck.
4. Navigate to a quiz slide, vote from the audience page, and the slide updates within a second.
