---
name: slide-quiz-setup
description: Add live audience quizzes (slide-quiz) to an existing Reveal.js or Slidev deck and deploy it to Netlify or Vercel. Use when asked to add a quiz, poll, or word cloud to a presentation, to wire up AnyCable for slides, or to set up slide-quiz / slidev-addon-slide-quiz. Covers cable creation, install, slide markup, the audience page, serverless functions, deploy, and a verification pass.
---

# Set up slide-quiz in an existing deck

slide-quiz adds live multiple-choice and free-text questions to a presentation. The audience scans a QR code, votes on their phones, and results animate on the slides. Everything runs through an AnyCable WebSocket cable plus two serverless functions that the deck's host (Netlify or Vercel) runs.

Read this whole file before starting. Steps 1 through 6 are sequential. Step 7 verifies the result; do not report success until it passes.

## Before you start: gather three facts

1. **Framework**: Reveal.js or Slidev. Check `package.json` for `reveal.js` or `@slidev/cli`. If the deck is neither, stop and tell the user this skill covers only those two.
2. **Host**: Netlify or Vercel. Look for `netlify.toml`, `vercel.json`, a `.netlify/` or `.vercel/` directory, or ask. The functions and default endpoints differ between the two.
3. **Whether a cable already exists**: search the repo for `wss://` and `slideQuiz`. If found, reuse the `wsUrl` and skip step 1.

If the deck is brand new rather than existing, `npx create-slide-quiz` scaffolds everything and this skill is unnecessary.

## Step 1: Create an AnyCable Plus cable (public mode)

The cable must be in **public streams mode** (empty secret). Signed streams will make every subscription fail with `unauthorized`.

Preferred, via the CLI (the user may need to run the install line themselves):

```sh
curl -LSs https://anycable-plus.terminalwire.sh | bash
anycable-plus cable create <deck-name>-cable --public --wait
```

The output includes a `WebSocket URL` (`wss://...fly.dev/cable`) and a `Broadcast URL` (`https://...fly.dev/_broadcast`). Record both. If the CLI is unavailable, the user can do it in the browser at https://plus.anycable.io: New Cable, backend JavaScript, **clear the application secret**, deploy, copy the two URLs.

The Broadcast URL is a secret in effect (anyone with it can push to streams). It goes into the host's environment variables in step 5, never into source.

## Step 2: Install

Reveal.js:

```sh
npm install slide-quiz
```

Slidev:

```sh
npm install slidev-addon-slide-quiz
```

Both packages ship the serverless functions under `node_modules/slide-quiz/functions/`.

## Step 3: Configure the deck

### Reveal.js

In the file that calls `Reveal.initialize`, add the plugin, its stylesheet, and the `slideQuiz` block:

```js
import RevealSlideQuiz from 'slide-quiz';
import 'slide-quiz/style.css';

Reveal.initialize({
  plugins: [RevealSlideQuiz, /* existing plugins */],
  slideQuiz: {
    wsUrl: 'wss://<from step 1>/cable',
    quizGroupId: '<short-unique-id-for-this-talk>',
    quizUrl: `${window.location.origin}/quiz.html`,
    // Vercel only:
    // endpoints: { answer: '/api/quiz-answer', sync: '/api/quiz-sync' },
  },
});
```

If the deck loads Reveal from a `<script>` tag instead of a bundler, use the UMD build: `<script src="node_modules/slide-quiz/dist/slide-quiz.umd.js">` exposes `RevealSlideQuiz` on `window`, and link `dist/slide-quiz.css`.

### Slidev

In the headmatter of `slides.md` (the very first frontmatter block):

```yaml
---
addons:
  - slidev-addon-slide-quiz
slideQuiz:
  wsUrl: wss://<from step 1>/cable
  quizGroupId: <short-unique-id-for-this-talk>
  quizUrl: /theme/quiz.html   # the addon ships this page; Slidev serves addon assets under /theme/
  # Vercel only:
  # endpoints:
  #   answer: /api/quiz-answer
  #   sync: /api/quiz-sync
---
```

`quizGroupId` namespaces the streams (`quiz:<id>:results` and `quiz:<id>:sync`). Two decks on the same cable must use different ids. Keep it URL-safe.

## Step 4: Add quiz slides

Ask the user for the questions, or propose two or three that fit the talk. Multiple choice takes up to four options. Free text produces a word cloud.

### Reveal.js

A single results slide is the common case: the audience votes while it is on screen and the bars update live.

```html
<section data-quiz-results="q1"
         data-quiz-question="Where are you joining from?"
         data-quiz-options='[
           {"label":"A","text":"San Francisco"},
           {"label":"B","text":"New York"},
           {"label":"C","text":"Europe","correct":true},
           {"label":"D","text":"Elsewhere"}
         ]'>
</section>

<section data-quiz-results="q2" data-quiz-type="text"
         data-quiz-question="What's your favorite framework?">
</section>
```

`data-quiz-options` is a JSON string inside single quotes. Double quotes inside the JSON must stay double. `correct` is optional and highlights that bar. For a separate question slide (vote first, reveal later), use `data-quiz-id="q1"` on one slide and `data-quiz-results="q1"` on the next.

### Slidev

```markdown
---
layout: quiz-results
quizId: q1
question: Where are you joining from?
options:
  - { label: A, text: San Francisco }
  - { label: B, text: New York }
  - { label: C, text: Europe, correct: true }
  - { label: D, text: Elsewhere }
---

---
layout: quiz-results
quizId: q2
question: What's your favorite framework?
type: text
---
```

`layout: quiz` is the vote-first variant. Every `quizId` must be unique within the deck.

## Step 5: Audience page and serverless functions

### Audience page

Slidev: the addon ships `quiz.html` in its `public/` directory. Slidev copies addon assets into the build under `theme/`, so the page is served at `/theme/quiz.html`. Confirm `quizUrl: /theme/quiz.html` is in the headmatter. The QR code appends `wsUrl`, `quizGroupId`, and any custom `endpoints` as query parameters, so the page needs no config. If the user wants the page at `/quiz.html` or wants to restyle it, copy `node_modules/slidev-addon-slide-quiz/public/quiz.html` into the deck's own `public/` folder and set `quizUrl` to match.

Reveal.js: create `quiz.html` at the site root and a module that mounts the widget. With Vite:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Quiz</title>
</head>
<body>
  <div id="quiz-root"></div>
  <script type="module" src="/quiz.js"></script>
</body>
</html>
```

```js
// quiz.js
import { createParticipantUI } from 'slide-quiz/participant';
import 'slide-quiz/participant.css';

createParticipantUI('#quiz-root', {
  wsUrl: 'wss://<same as the deck>/cable',
  quizGroupId: '<same as the deck>',
  // Vercel only:
  // endpoints: { answer: '/api/quiz-answer', sync: '/api/quiz-sync' },
});
```

Add `quiz.html` to the bundler's inputs if it lists entry points (Vite: `build.rollupOptions.input`). Questions are not repeated here; the presenter broadcasts them.

### Serverless functions

Copy from `node_modules/slide-quiz/functions/`:

| Host | Copy from | Copy to | Endpoints |
|---|---|---|---|
| Netlify | `functions/netlify/*.mts` | `netlify/functions/` | `/.netlify/functions/quiz-answer`, `/.netlify/functions/quiz-sync` (the defaults) |
| Vercel | `functions/vercel/*.ts` | `api/` | `/api/quiz-answer`, `/api/quiz-sync` (set `endpoints` in the config) |

Then add the two runtime dependencies to the project's own `package.json` (the functions import them):

```sh
npm install @anycable/serverless-js valibot
```

Set the environment variable on the host, in the dashboard or CLI, never in a committed file:

```
ANYCABLE_BROADCAST_URL=https://<from step 1>/_broadcast
```

`ANYCABLE_BROADCAST_KEY` is only needed if the cable has a broadcast key. Public-mode cables created in step 1 do not.

Slidev on Netlify also needs a SPA redirect for deep links to slides. Create `public/_redirects` in the deck with one line: `/*  /index.html  200`. Netlify resolves `/.netlify/functions/*` before redirects, so the quiz endpoints are unaffected.

## Step 6: Deploy

```sh
# Netlify
netlify deploy --prod
# Vercel
vercel --prod
```

Or push to the branch the host builds from. Note the production URL.

Local `npm run dev` will show the slides and the QR code, but voting cannot work locally: the functions are not running and the audience cannot reach `localhost`. The presenter view will show a red banner saying so. That banner disappearing after deploy is part of the verification.

## Step 7: Verify

Do all of these against the deployed URL. Use a browser tool if one is available; otherwise ask the user to do it and report back.

1. **Functions respond.** `curl -X GET https://<site>/.netlify/functions/quiz-sync` (or `/api/quiz-sync`) returns HTTP 405 with `{"error":"Method not allowed"}`. A 404 means the functions did not deploy. A 200 or HTML page means the path is being served as a static file.
2. **Broadcast works.** POST a minimal sync payload and expect `{"ok":true}`:
   ```sh
   curl -X POST https://<site>/.netlify/functions/quiz-sync \
     -H 'Content-Type: application/json' \
     -d '{"activeQuestionId":null,"sessionId":"verify","quizGroupId":"<id>","results":{}}'
   ```
   A 502 with `Broadcast failed` means `ANYCABLE_BROADCAST_URL` is wrong or unset on the host.
3. **Presenter connects.** Open the deck. In the console, `[slide-quiz] subscribing to stream: quiz:<id>:sync` appears and no red banner is on screen after ten seconds.
4. **Audience joins.** Open `<site>/quiz.html` in a second browser or on a phone. The `online` counter on the deck goes to 1 or more. The audience page shows "Waiting for the next question" until the deck is on a quiz slide.
5. **A vote lands.** Navigate the deck to a quiz slide, vote on the audience page, and watch the bar or word appear on the slide within a second.

If any check fails, switch to the `slide-quiz-debug` skill.

## Optional: forward errors to the user's monitoring

slide-quiz never sends anything anywhere itself. If the project already uses Sentry or similar, offer to pass `onError`:

```js
slideQuiz: {
  // ...
  onError: (err) => Sentry.captureMessage(`[slide-quiz:${err.kind}] ${err.message}`, { extra: err.context }),
}
```

For Slidev, config comes from YAML and cannot hold a function. Register the handler from the deck's own `setup/main.ts` instead:

```ts
import { defineAppSetup } from '@slidev/types';
import { configs } from '@slidev/client';
import { getQuizPresenter } from 'slide-quiz';

export default defineAppSetup(() => {
  const cfg = (configs as any).slideQuiz;
  if (cfg) getQuizPresenter(cfg).onError((err) => console.error('[slide-quiz]', err));
});
```

`getQuizPresenter` returns the same instance the addon created for that `quizGroupId`.
