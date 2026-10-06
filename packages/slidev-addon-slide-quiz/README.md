# slidev-addon-slide-quiz

[![npm version](https://img.shields.io/npm/v/slidev-addon-slide-quiz)](https://www.npmjs.com/package/slidev-addon-slide-quiz)

Add live audience quizzes to your [Slidev](https://sli.dev) presentations. Powered by [AnyCable](https://anycable.io).

**[Live Demo](https://slide-quiz-demo.netlify.app/)** — open the presenter view in one tab and the [audience page](https://slide-quiz-demo.netlify.app/quiz.html) on your phone.

## What You Get

You add quiz slides to your Slidev deck, deploy it, and present. When you land on a quiz slide, your audience sees a QR code, scans it on their phones, and votes — results animate on your slides in real time.

- **Multiple-choice questions** with up to 4 options and live bar charts
- **Multi-select questions** ("select all that apply") with bars showing the share of respondents per option
- **Free-text questions** with live word cloud results
- **QR code** auto-generated on each quiz slide so the audience can join instantly
- **Live results** that update as votes come in (sub-second via WebSockets)
- **Participant counter** showing how many people are connected
- **Mobile-friendly voting page** — no app install, just a browser

## Getting Started

Run the interactive installer in your Slidev project directory:

```bash
npx create-slide-quiz
```

The CLI will:
1. Detect your Slidev project
2. Walk you through creating a free [AnyCable Plus](https://plus.anycable.io) app (provides the WebSocket infrastructure)
3. Install `slidev-addon-slide-quiz` and configure `slides.md`
4. Copy the audience page and serverless functions
5. Optionally deploy to Netlify or Vercel

That's it — run `npx slidev` and try your quiz.

## Layouts

The addon provides two slide layouts:

### `quiz` — Question Slide

Displays the question, answer options, a QR code for the audience to join, and a live participant counter.

```md
---
layout: quiz
quizId: q1
question: What's your favorite color?
options:
  - { label: A, text: Red }
  - { label: B, text: Blue, correct: true }
  - { label: C, text: Green }
  - { label: D, text: Yellow }
---
```

### `quiz-results` — Results Slide

Displays live results as a bar chart (for choice questions) or word cloud (for text questions), with the number of responses. The audience can still vote from a results slide through its QR code, so an option marked `correct: true` is highlighted only after one click.

```md
---
layout: quiz-results
quizId: q1
question: What's your favorite color?
options:
  - { label: A, text: Red }
  - { label: B, text: Blue, correct: true }
  - { label: C, text: Green }
  - { label: D, text: Yellow }
---
```

### Multi-select Questions

Set `type: multi` to let participants tick any number of options and press Submit. Each bar shows the share of respondents who picked that option, so the bars can add up to more than 100%. The question slide and the phones show "Select all that apply" unless the slide sets `hintText`.

```md
---
layout: quiz
quizId: q3
type: multi
question: Which of these have you shipped with an agent?
options:
  - { label: A, text: Migrations }
  - { label: B, text: Background jobs }
  - { label: C, text: Turbo Streams }
---
```

Set `type: multi` on the matching `quiz-results` slide as well, so it notes that the bars are a share of respondents.

Multi-select needs the serverless functions and the audience page from slide-quiz 0.7 or later. Older functions reject the question with a 400. An older audience page lets people pick only one option, and the presenter's banner says so. See [Upgrading](#upgrading).

### Free-text Questions

Omit `options` and set `type: text` to get a word cloud instead of a bar chart:

```md
---
layout: quiz
quizId: q2
type: text
question: What's your favorite framework?
---

---
layout: quiz-results
quizId: q2
type: text
question: What's your favorite framework?
---
```

### Frontmatter Reference

| Property | Layout | Required | Description |
|---|---|---|---|
| `quizId` | both | Yes | Unique quiz identifier |
| `question` | both | Yes | Question text |
| `type` | both | No | `"choice"` (default), `"multi"` or `"text"` |
| `options` | both | No | Array of `{label, text, correct?}` (choice and multi types) |
| `titleText` | quiz | No | Title shown above the question; overrides the deck-wide `titleText` |
| `hintText` | quiz | No | Hint under a free-text or multi-select question, on the slide and the phones. Free text falls back to the deck-wide `hintText`; multi-select to "Select all that apply" |

## Configuration

The installer adds a `slideQuiz` block to your `slides.md` frontmatter:

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

| Option | Required | Description |
|---|---|---|
| `wsUrl` | Yes | AnyCable WebSocket URL |
| `quizGroupId` | Yes | Unique ID grouping quizzes in this talk |
| `quizUrl` | No | Audience page URL (shown as QR code) |
| `titleText` | No | Title on every question slide (none by default) |
| `hintText` | No | Hint under free-text questions that set none of their own |
| `endpoints` | No | Custom serverless function paths (for Vercel) |

### Audience page

The addon ships a ready-made audience page in its `public/` folder. Copy it into your deck's own `public/` folder so it is served at `/quiz.html`:

```sh
mkdir -p public && cp node_modules/slidev-addon-slide-quiz/public/quiz.html public/
```

`npx create-slide-quiz` does this for you. The QR code passes `wsUrl`, `quizGroupId`, any custom `endpoints`, and the deck's `--sq-accent` colour to the page as query parameters, so it needs no config of its own, and you can edit the copy freely. Opened without those parameters, it asks people to scan the QR code.

The page loads slide-quiz from a CDN pinned to one version. **Copy it again whenever you upgrade the addon.**

Where Slidev places addon assets changes between versions (`/theme/quiz.html` on Slidev 0.50, `/theme/node_modules/slidev-addon-slide-quiz/public/quiz.html` on 52), so do not point `quizUrl` at the addon's own copy.

### Netlify redirects

Slidev uses history routing, so deep links such as `/5` need a SPA redirect on Netlify. Add `public/_redirects` to your deck:

```
/*  /index.html  200
```

Function paths under `/.netlify/functions/` are resolved before redirects, so this rule does not interfere with the quiz endpoints.

### Vercel Endpoints

If deploying to Vercel, add custom endpoint paths:

```yaml
slideQuiz:
  wsUrl: wss://your-cable.anycable.io/cable
  quizGroupId: my-talk
  quizUrl: /quiz.html
  endpoints:
    answer: /api/quiz-answer
    sync: /api/quiz-sync
```

## Upgrading

After upgrading the addon:

1. Copy `node_modules/slidev-addon-slide-quiz/public/quiz.html` into `public/` again.
2. Copy the serverless functions from `node_modules/slide-quiz/functions/` again (see the [functions README](https://github.com/anycable/slide-quiz/tree/main/functions)).
3. Redeploy.

Functions older than the deck reject new question types with a 400. An audience page older than slide-quiz 0.7 lets people pick only one option on multi-select questions. The presenter's banner names either problem.

## Errors during a talk

Connection and sync problems show in full in Slidev's presenter view. The projected slide shows only a small red pill in the corner, which expands when clicked, so the audience doesn't see an error banner. Each message names the cause and the fix.

## Theming

The addon inherits your Slidev theme's colors via `currentColor`. Override `--sq-*` CSS variables to customize:

| Variable | Default | Description |
|---|---|---|
| `--sq-accent` | `#f59e0b` | Accent color (correct answers, top words), also passed to the audience page |
| `--sq-text` | `currentColor` | Main text color |
| `--sq-bar-fill` | 35% of `--sq-text` | Bar chart fill |
| `--sq-bar-correct` | `var(--sq-accent)` | Correct answer highlight |
| `--sq-border-radius` | `0.5rem` | Border radius |

## How It Works

Your presentation must be **deployed** (not just run locally) because the audience connects from their phones. The architecture has three parts:

1. **AnyCable** — a managed WebSocket service that relays votes. The free tier supports up to 2,000 concurrent connections.
2. **Your Slidev deck** — deployed to Netlify or Vercel as a static site.
3. **Serverless functions** — receive audience votes and broadcast them via AnyCable.

See the [slide-quiz README](https://github.com/anycable/slide-quiz#readme) for the full architecture overview.

## License

MIT
