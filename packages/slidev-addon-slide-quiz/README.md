# slidev-addon-slide-quiz

[![npm version](https://img.shields.io/npm/v/slidev-addon-slide-quiz)](https://www.npmjs.com/package/slidev-addon-slide-quiz)

Add live audience quizzes to your [Slidev](https://sli.dev) presentations. Powered by [AnyCable](https://anycable.io).

**[Live Demo](https://livequizdemo.netlify.app/)** — open the presenter view in one tab and the [audience page](https://livequizdemo.netlify.app/quiz.html) on your phone.

## What You Get

You add quiz slides to your Slidev deck, deploy it, and present. When you land on a quiz slide, your audience sees a QR code, scans it on their phones, and votes — results animate on your slides in real time.

- **Multiple-choice questions** with up to 4 options and live bar charts
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

Displays live results as a bar chart (for choice questions) or word cloud (for text questions).

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
| `type` | both | No | `"choice"` (default) or `"text"` |
| `options` | both | No | Array of `{label, text, correct?}` (choice type only) |
| `titleText` | quiz | No | Override title shown above the question |
| `hintText` | quiz | No | Hint text (text type only) |

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
| `titleText` | No | Default title on question slides (default: `"Pop quiz!"`) |
| `endpoints` | No | Custom serverless function paths (for Vercel) |

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

## Theming

The addon inherits your Slidev theme's colors via `currentColor`. Override `--sq-*` CSS variables to customize:

| Variable | Default | Description |
|---|---|---|
| `--sq-accent` | `#f59e0b` | Accent color (correct answers, top words) |
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
