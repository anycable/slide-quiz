# slide-quiz

[![npm version](https://img.shields.io/npm/v/slide-quiz)](https://www.npmjs.com/package/slide-quiz)

Add live audience quizzes to your [Reveal.js](https://revealjs.com) and [Slidev](https://sli.dev) presentations. Powered by [AnyCable](https://anycable.io).

**[Live Demo](https://slide-quiz-demo.netlify.app/)** — open the presenter view in one tab and the [audience page](https://slide-quiz-demo.netlify.app/quiz.html) on your phone.

---

<img src="https://cdn.evilmartians.com/badges/logo-no-label.svg" alt="" width="22" height="16" />  slide-quiz is built by <b><a href="https://evilmartians.com/">Evil Martians</a></b>, an American design and engineering consultancy for <b>developer tools, AI, and cybersecurity startups</b>.

---

## What You Get

You build a presentation deck with quiz slides, deploy it to the web, and present it. When you land on a quiz slide, your audience sees a QR code, scans it on their phones, and votes — results animate on your slides in real time.

- **Multiple-choice questions** with up to 4 options and live bar charts
- **Multi-select questions** ("select all that apply"), with bars showing the share of respondents who picked each option
- **Free-text questions** with live word cloud results
- **QR code** auto-generated on quiz and results slides so the audience can join or vote at any time
- **Live results** that update as votes come in (sub-second via WebSockets)
- **Participant counter** showing how many people are connected
- **Mobile-friendly voting page** — no app install, just a browser
- **Automatic question sync** — define questions once on your slides, the audience page receives them automatically
- **Theming** — inherits your presentation theme's fonts and colors automatically

## How It Works

Your presentation needs to be **deployed to the web** (not just opened locally) because the audience connects to it from their phones. The setup has three parts:

1. **AnyCable** — a managed WebSocket service that relays votes between the audience and your slides. The free tier supports up to **2,000 concurrent connections**, which is plenty for conference talks and meetups.

2. **Your presentation** — a static site (HTML + JS) deployed to **Netlify** or **Vercel**. The plugin adds quiz UI to your slides automatically.

3. **Serverless functions** — 3 small files that run on Netlify or Vercel. They receive answers from the audience and broadcast results via AnyCable. Secrets stay in environment variables, never in your code.

```
Presenter's slides              AnyCable              Audience phones
       │                           │                        │
       │   show quiz slide         │                        │
       ├── broadcast state ───────►│── push state ─────────►│
       │  (questions + results)    │  (questions + results)  │
       │                           │                        │
       │                           │◄──── submit vote ──────┤
       │◄── broadcast results ─────┤     (serverless fn)    │
       │   update results           │                        │
```

Questions are defined once — as `data-quiz-*` attributes on your slides. The presenter broadcasts them to the audience page via the sync channel, so the participant widget doesn't need its own copy.

## Getting Started

There are two ways to set up: the **interactive CLI** (recommended) or **manual setup**.

Both follow the same steps:

1. Create a free AnyCable Plus app (provides the WebSocket infrastructure)
2. Scaffold your project with quiz slides (Reveal.js or Slidev)
3. Deploy to Netlify or Vercel

### Option A: Interactive CLI (recommended)

One command that walks you through everything — creates your AnyCable app, scaffolds the project, and optionally deploys it:

```bash
npx create-slide-quiz
```

The CLI will:
1. Open [plus.anycable.io](https://plus.anycable.io) and guide you through creating an AnyCable app
2. Ask for your **WebSocket URL** and **Broadcast URL** (the two values AnyCable gives you)
3. Scaffold a complete project with quiz slides, audience page, and serverless functions
4. Install dependencies and initialize git
5. Deploy via Netlify/Vercel CLI (if installed) or show manual deploy instructions

### Option B: Add to an existing Slidev presentation

If you already have a Slidev deck, install the addon and configure it in your frontmatter:

#### 1. Create an AnyCable Plus app

Same as above — sign in at [plus.anycable.io](https://plus.anycable.io), create a cable with an empty secret, and copy your URLs.

You can do that via the AnyCable+ CLI as follows:

```sh
curl -LSs https://anycable-plus.terminalwire.sh | bash

anycable-plus cable create my-slides-cable --public --wait

Cable my-slides-cable is being provisioned
...

ID              43
Name            my-slides-cable
Status          created
WebSocket URL   wss://my-slides-cable-sv7m.fly.dev/cable
Broadcast URL   https://my-slides-cable-sv7m.fly.dev/_broadcast
Secret          none (public mode)
```

#### 2. Install the addon

```bash
npm install slidev-addon-slide-quiz
```

#### 3. Configure slides.md

Add the addon and quiz config to your frontmatter:

```yaml
---
addons:
  - slidev-addon-slide-quiz
slideQuiz:
  wsUrl: wss://your-cable.anycable.io/cable
  quizGroupId: my-talk
  quizUrl: /quiz.html
---
```

Then copy the ready-made audience page into your deck's `public/` folder:

```sh
mkdir -p public && cp node_modules/slidev-addon-slide-quiz/public/quiz.html public/
```

The page needs no configuration: the QR code passes `wsUrl`, `quizGroupId`, any custom `endpoints`, and the deck's accent colour as query parameters. Copying it is required because where Slidev puts addon assets changes between Slidev versions (`/theme/quiz.html` on 0.50, a longer path on 52), so `quizUrl` cannot point at the addon's copy reliably.

The copy loads slide-quiz from a CDN pinned to one version, so **copy it again whenever you upgrade the addon** (see [Upgrading](#upgrading)).

For Vercel, also add custom endpoints (the QR code passes them to the audience page):

```yaml
slideQuiz:
  wsUrl: wss://your-cable.anycable.io/cable
  quizGroupId: my-talk
  quizUrl: /quiz.html
  endpoints:
    answer: /api/quiz-answer
    sync: /api/quiz-sync
```

For Netlify, deep links to slides need a SPA redirect. Add `public/_redirects` to your deck:

```
/*  /index.html  200
```

#### 4. Add quiz slides

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
```

For a free-text question (word cloud results), set `type: text` and omit `options`:

```markdown
---
layout: quiz-results
quizId: q2
question: What's your favorite framework?
type: text
---
```

For a multi-select question, set `type: multi`. Participants tick any number of options and press Submit; each bar shows the share of respondents who picked that option, so the bars can add up to more than 100%:

```markdown
---
layout: quiz-results
quizId: q3
question: Which of these have you shipped with an agent?
type: multi
options:
  - { label: A, text: Migrations }
  - { label: B, text: Background jobs }
  - { label: C, text: Turbo Streams }
---
```

> **Tip:** Use `layout: quiz` instead of `layout: quiz-results` if you want a separate question slide where the audience votes _before_ seeing results.

An option marked `correct: true` is highlighted after one click on the results slide, so the answer stays hidden while people vote. `hintText` on a slide adds a hint under a free-text or multi-select question, on the slide and on the phones.

#### 5. Copy serverless functions and deploy

Copy the functions for your host from the `slide-quiz` package (installed with the addon) and add their two dependencies:

```sh
# Netlify
mkdir -p netlify/functions && cp node_modules/slide-quiz/functions/netlify/*.mts netlify/functions/
# Vercel (also set the endpoints shown in step 3)
mkdir -p api && cp node_modules/slide-quiz/functions/vercel/*.ts api/

npm install @anycable/serverless-js valibot
```

Set `ANYCABLE_BROADCAST_URL` (and `ANYCABLE_BROADCAST_KEY`, if your cable has one) in your host's environment variables, then deploy. A change to environment variables takes effect only after a redeploy. See [functions/README.md](./functions/README.md) for details.

### Option C: Add to an existing Reveal.js presentation

If you already have a Reveal.js deck, you can add live quizzes to it manually.

#### 1. Create an AnyCable Plus app

You can do that via the AnyCable+ CLI as follows:

```sh
curl -LSs https://anycable-plus.terminalwire.sh | bash

anycable-plus cable create my-slides-cable --public --wait

Cable my-slides-cable is being provisioned
...

ID              43
Name            my-slides-cable
Status          created
WebSocket URL   wss://my-slides-cable-sv7m.fly.dev/cable
Broadcast URL   https://my-slides-cable-sv7m.fly.dev/_broadcast
Secret          none (public mode)
```

Alternatively, go to [plus.anycable.io](https://plus.anycable.io), create a new account with GitHub and:

1. Click **New Cable**, name it anything, pick **JavaScript** as your backend
2. On the Application secret screen, **clear the secret** (empty the input) — this enables public streams mode
3. After deploy, copy the **WebSocket URL** and **Broadcast URL**

#### 2. Install the plugin

```bash
npm install slide-quiz
```

#### 3. Wire up the plugin

Add two imports and the `slideQuiz` config to your existing `Reveal.initialize()` call:

```js
import RevealSlideQuiz from 'slide-quiz';
import 'slide-quiz/style.css';

// In your existing Reveal.initialize() call, add:
Reveal.initialize({
  plugins: [RevealSlideQuiz],  // add to your plugins array
  slideQuiz: {
    wsUrl: 'wss://your-cable.anycable.io/cable',   // ← from step 1
    quizGroupId: 'my-talk',
    quizUrl: `${window.location.origin}/quiz.html`,
  },
  // ...your existing config
});
```

`quizUrl` resolves dynamically — it will point to the right domain wherever you deploy.

#### 4. Add quiz slides

Add data attributes to your slides — the plugin injects all the UI automatically:

```html
<!-- Multiple-choice — audience sees live responses -->
<section data-quiz-results="q1"
         data-quiz-question="Where are you joining from?"
         data-quiz-options='[
           {"label":"A","text":"San Francisco"},
           {"label":"B","text":"New York"},
           {"label":"C","text":"Europe"},
           {"label":"D","text":"Elsewhere"}
         ]'>
</section>

<!-- Multi-select: participants tick any number of options -->
<section data-quiz-results="q3" data-quiz-type="multi"
         data-quiz-question="Which of these have you shipped with an agent?"
         data-quiz-options='[
           {"label":"A","text":"Migrations"},
           {"label":"B","text":"Background jobs"},
           {"label":"C","text":"Turbo Streams"}
         ]'>
</section>

<!-- Free-text question (word cloud results) -->
<section data-quiz-results="q2" data-quiz-type="text"
         data-quiz-question="What's your favorite framework?">
</section>
```

> **Tip:** Use `data-quiz-id` instead of `data-quiz-results` if you want a separate question slide where the audience votes _before_ seeing results.

`data-quiz-type` defaults to `"choice"` when omitted, so existing slides work without changes. An option marked `"correct": true` is highlighted on the next fragment step of the results slide, so the answer stays hidden while people vote. `data-quiz-hint` adds a hint under a free-text or multi-select question, on the slide and on the phones.

#### 5. Create the audience page

The audience needs a separate page to vote from their phones. Create `quiz.html` at the site root:

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

and `quiz.js` next to it, which mounts the participant widget:

```js
import { createParticipantUI } from 'slide-quiz/participant';
import 'slide-quiz/participant.css';

createParticipantUI('#quiz-root', {
  wsUrl: 'wss://your-cable.anycable.io/cable',   // same as the deck
  quizGroupId: 'my-talk',                         // same as the deck
  // Vercel only:
  // endpoints: { answer: '/api/quiz-answer', sync: '/api/quiz-sync' },
  // The QR code passes the deck's accent colour:
  accent: new URLSearchParams(location.search).get('accent') ?? undefined,
});
```

If your bundler lists entry points, add `quiz.html` to them (Vite: `build.rollupOptions.input`). Questions are synced automatically from your presentation slides, so there is no need to repeat them here.

#### 6. Add serverless functions and deploy

Your presentation must be deployed — the audience needs to reach it from their phones.

Copy the serverless functions from `functions/netlify/` or `functions/vercel/` into your project and set one environment variable:

| Variable | Required | Description |
|---|---|---|
| `ANYCABLE_BROADCAST_URL` | Yes | Broadcast URL from step 1 |
| `ANYCABLE_BROADCAST_KEY` | No | Broadcast key (if your AnyCable app uses one) |

Set them in your host's dashboard, then redeploy: a change to environment variables takes effect only after a redeploy. See [functions/README.md](./functions/README.md) for step-by-step deploy instructions for each platform.

## Upgrading

Each slide-quiz minor release (0.6 to 0.7, for example) can change what the deck, the audience page and the functions send each other. After upgrading:

1. **Copy the serverless functions again** and redeploy. Functions older than the deck reject new question types with a 400, and the banner says so.
2. **Update the audience page.** Slidev: copy `node_modules/slidev-addon-slide-quiz/public/quiz.html` into `public/` again, since your copy loads slide-quiz from a CDN pinned to the old version. Reveal.js: rebuild, so `quiz.js` bundles the new `slide-quiz/participant`. A page older than 0.7 lets people pick only one option on multi-select questions; the presenter's banner warns when that happens.

## AnyCable Plus

This plugin uses [AnyCable Plus](https://plus.anycable.io) — a managed WebSocket service. The free tier includes:

- Up to **2,000 concurrent connections**
- Public streams mode (no backend auth needed)
- WebSocket + HTTP broadcast endpoints

### A note on public streams

By default, the plugin uses **public streams** — WebSocket messages are not authenticated. This means anyone who knows the channel name could technically observe or interact with the quiz data. For most use cases (conference talks, meetups, workshops) this is perfectly fine — quiz votes aren't sensitive.

If your votes are confidential or you need to restrict who can participate, see [Appendix: Authorized Streams](#appendix-authorized-streams).

## Configuration

### Plugin Options (`slideQuiz`)

| Option | Type | Required | Description |
|---|---|---|---|
| `wsUrl` | `string` | Yes | AnyCable WebSocket URL |
| `quizGroupId` | `string` | Yes | Unique ID grouping quizzes in this talk |
| `quizUrl` | `string` | No | Audience page URL (shown as QR code) |
| `endpoints` | `object` | No | Custom endpoint paths (default: `/.netlify/functions/*`) |
| `titleText` | `string` | No | Title shown on question slides (omitted by default) |
| `hintText` | `string` | No | Hint under free-text questions that set none of their own (`data-quiz-hint` / `hintText` on the slide) |
| `onError` | `function` | No | Receives every error the engine detects, see [Error reporting](#error-reporting) |

### Custom Endpoints

For Vercel, override the default Netlify paths:

```js
slideQuiz: {
  endpoints: {
    answer: '/api/quiz-answer',
    sync: '/api/quiz-sync',
  }
}
```

### Error reporting

slide-quiz sends nothing to any server of its own: no analytics, no crash reports. Problems are shown on screen instead, worded as a cause and a fix: when the WebSocket stays down, the sync function fails, or phones run an outdated audience page. On the projected slide this is a small red pill in the corner that expands when clicked; Slidev's presenter view shows the full message. The audience page explains why it is waiting.

To forward those errors to your own monitoring, pass `onError`. It receives a `QuizError` with `kind` (`connection`, `sync`, `answer`, `invalid-payload`, or `outdated-audience-page`), a `message` safe to display, the underlying `cause`, and a `context` object with the URL or quiz id involved.

```js
slideQuiz: {
  wsUrl, quizGroupId, quizUrl,
  onError: (err) => Sentry.captureMessage(`[slide-quiz:${err.kind}] ${err.message}`, { extra: err.context }),
}
```

The same option works on `createParticipantUI` for the audience page. The manager also exposes `onError(handler)` for registering later, and `store.connection` / `store.connectionError` if you want to render connection state yourself.

For Slidev, config comes from YAML and cannot hold a function. Register the handler from the deck's own `setup/main.ts`; `getQuizPresenter` returns the instance the addon already created:

```ts
import { defineAppSetup } from '@slidev/types';
import { configs } from '@slidev/client';
import { getQuizPresenter } from 'slide-quiz';

export default defineAppSetup(() => {
  const cfg = (configs as any).slideQuiz;
  if (cfg) getQuizPresenter(cfg).onError((err) => console.error('[slide-quiz]', err));
});
```

## Theming

The plugin inherits your Reveal.js theme's fonts and colors automatically via `--r-*` custom properties. Override `--sq-*` variables to fine-tune:

| Variable | Default | Description |
|---|---|---|
| `--sq-accent` | `var(--r-link-color, #f59e0b)` | Accent color (bar highlights, word cloud top word) |
| `--sq-text` | `var(--r-main-color, inherit)` | Main text color |
| `--sq-text-muted` | 50% of `--sq-text` | Secondary text |
| `--sq-font` | `var(--r-main-font, inherit)` | Body font |
| `--sq-heading-font` | `var(--r-heading-font, inherit)` | Heading font |
| `--sq-mono` | `var(--r-code-font, ...)` | Monospace font |
| `--sq-bar-fill` | 35% of `--sq-text` | Bar fill color |
| `--sq-bar-correct` | `var(--sq-accent)` | Correct answer bar color |
| `--sq-bar-track` | 10% of `--sq-text` | Bar track background |
| `--sq-border-radius` | `0.5rem` | Border radius |

Participant widget uses `--sq-p-*` variables — see `participant/participant.css` for the full list. The QR code passes the deck's `--sq-accent` to the audience page as its `accent` option, which becomes `--sq-p-accent`, so setting `--sq-accent` once themes both the slides and the phones.

## Data Attributes Reference

### Question Slide

| Attribute | Description |
|---|---|
| `data-quiz-id` | Unique quiz identifier |
| `data-quiz-question` | Question text |
| `data-quiz-type` | `"choice"` (default), `"multi"` or `"text"` |
| `data-quiz-options` | JSON array of `{label, text, correct?}` (choice and multi) |
| `data-quiz-hint` | Hint under a free-text or multi-select question, also shown on the phones. Multi-select defaults to "Select all that apply"; free text to the `hintText` option |

### Results Slide

| Attribute | Description |
|---|---|
| `data-quiz-results` | Quiz ID to show results for |
| `data-quiz-question` | Question text (shown as title) |
| `data-quiz-type` | `"choice"` (default), `"multi"` or `"text"` |
| `data-quiz-options` | JSON array of `{label, text, correct?}` (choice and multi) |

## Limitations

- **Three question types** — multiple choice (up to 4 options), multi-select, and free text (word cloud). No ratings or scales yet.
- **Requires deployment** — the audience connects over the internet, so the presentation must be hosted, not served locally.
- **AnyCable free tier** — supports up to 2,000 concurrent connections. For larger audiences, upgrade to a paid AnyCable Plus plan.
- **No long-term storage** — quiz results persist in sessionStorage across page refreshes, but are lost when the presenter closes the tab or browser. See [Answer Lifecycle](#answer-lifecycle) for details.
- **Netlify and Vercel only** — the serverless functions are provided for these two platforms. Other platforms (Cloudflare Workers, AWS Lambda) would need manual porting.

## Answer Lifecycle

There is no explicit "reset" button — answer state is managed automatically through sessionStorage and sync detection.

- **Results persist across refreshes.** Both presenter results and participant submitted answers are stored in sessionStorage, so they survive page reloads but are cleared when the tab or browser is closed.
- **Participants can change their vote** while the presenter is on the same active question. The presenter tracks per-session votes, so totals stay accurate even when someone switches their answer.
- **Answers reset automatically.** When a participant connects (or reconnects) and sees that the presenter's results show `total: 0` for a quiz, their locally stored answer for that quiz is cleared — they can vote again.
- **Starting fresh:** close the presenter tab and reopen it. Results will be empty, and any reconnecting participants will see `total: 0`, which clears their stored votes automatically.

## Using with AI agents

The package ships two skills in `skills/` for Claude Code, Cursor, and other agents that read `SKILL.md` files:

| Skill | Use it when |
|---|---|
| [`slide-quiz-setup`](./skills/slide-quiz-setup/SKILL.md) | Adding quizzes to an existing Reveal.js or Slidev deck, from cable creation through deploy and a verification pass |
| [`slide-quiz-debug`](./skills/slide-quiz-debug/SKILL.md) | A deck where the audience cannot join, votes do not land, or a red banner appears. Ordered checklist with the exact curl commands |

Point your agent at the file, or copy the directory into your project's skills folder (for Claude Code: `.claude/skills/`). After `npm install slide-quiz` they are at `node_modules/slide-quiz/skills/`. [AGENTS.md](./AGENTS.md) describes the architecture for agents working on slide-quiz itself.

## Contributing

Bug reports, questions, and pull requests are welcome.

- **Found a bug?** Open an [issue](https://github.com/anycable/slide-quiz/issues/new?template=bug_report.yml). The template asks for the console output and config we need, since slide-quiz collects nothing on its own. The debug skill above walks through the checks first.
- **Have a question or an idea?** Start a [discussion](https://github.com/anycable/slide-quiz/discussions).
- **Want to contribute code?** See [CONTRIBUTING.md](./CONTRIBUTING.md) for the repo layout, how to run tests, and what a good PR looks like.
- **Security issue?** See [SECURITY.md](./SECURITY.md).

Changes are tracked in [CHANGELOG.md](./CHANGELOG.md).

## Appendix: Authorized Streams

> **TODO** — Instructions for setting up AnyCable [signed streams](https://docs.anycable.io/anycable-go/signed_streams) for private quizzes. Coming soon.

## License

MIT
