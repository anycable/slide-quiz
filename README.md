# live-quiz

Live audience quiz plugin for [Reveal.js](https://revealjs.com), powered by [AnyCable](https://anycable.io).

Presenter shows a question slide with QR code → audience scans and votes on their phones → results update in real-time on the presenter's bar chart slide.

## Quick Start

The fastest way to get started is with the interactive scaffolder — it walks you through AnyCable setup, creates your project, and optionally deploys it:

```bash
npx create-live-quiz
```

Or set things up manually:

### 1. Install

```bash
npm install live-quiz
```

### 2. Author Quiz Slides

```html
<!-- Quiz question slide -->
<section data-quiz-id="q1"
         data-quiz-question="Which metric is NOT included in the PMF Compass?"
         data-quiz-options='[
           {"label":"A","text":"Time to First Value"},
           {"label":"B","text":"GitHub stars","correct":true},
           {"label":"C","text":"Net Revenue Retention"},
           {"label":"D","text":"Organic signups"}
         ]'>
</section>

<!-- Results slide (references the quiz above) -->
<section data-quiz-results="q1"
         data-quiz-question="Which metric is NOT included in the PMF Compass?"
         data-quiz-options='[
           {"label":"A","text":"Time to First Value"},
           {"label":"B","text":"GitHub stars","correct":true},
           {"label":"C","text":"Net Revenue Retention"},
           {"label":"D","text":"Organic signups"}
         ]'>
</section>
```

### 3. Register Plugin

```js
import Reveal from 'reveal.js';
import RevealLiveQuiz from 'live-quiz';
import 'live-quiz/style.css';

Reveal.initialize({
  plugins: [RevealLiveQuiz],
  liveQuiz: {
    wsUrl: 'wss://your-cable.fly.dev/cable',
    quizGroupId: 'my-talk',
    quizUrl: 'https://my-talk.example.com/quiz',
  }
});
```

### 4. Deploy Backend

Copy the 3 files from `functions/` to your serverless platform. See [functions/README.md](./functions/README.md) for Netlify, Cloudflare, and Vercel setup.

### 5. Create Audience Page

```js
import { createParticipantUI } from 'live-quiz/participant';
import 'live-quiz/participant.css';

createParticipantUI('#quiz-root', {
  wsUrl: 'wss://your-cable.fly.dev/cable',
  quizGroupId: 'my-talk',
  questions: [
    {
      quizId: 'q1',
      question: 'Which metric is NOT included in the PMF Compass?',
      options: [
        { label: 'A', text: 'Time to First Value' },
        { label: 'B', text: 'GitHub stars' },
        { label: 'C', text: 'Net Revenue Retention' },
        { label: 'D', text: 'Organic signups' },
      ]
    }
  ]
});
```

## Configuration

### Plugin Options (`liveQuiz`)

| Option | Type | Required | Description |
|---|---|---|---|
| `wsUrl` | `string` | Yes | AnyCable WebSocket URL |
| `quizGroupId` | `string` | Yes | Unique ID grouping quizzes in this talk |
| `quizUrl` | `string` | No | Audience page URL (shown as QR code) |
| `endpoints` | `object` | No | Custom endpoint paths (default: `/.netlify/functions/*`) |

### Custom Endpoints

```js
liveQuiz: {
  endpoints: {
    answer: '/api/quiz-answer',
    sync: '/api/quiz-sync',
  }
}
```

## Theming

Override CSS custom properties to match your brand:

```css
:root {
  --lq-accent: #e11d48;
  --lq-text-muted: #a1a1aa;
  --lq-font: "Inter", sans-serif;
  --lq-mono: "JetBrains Mono", monospace;
  --lq-bar-fill: #52525b;
  --lq-bar-correct: #22c55e;
  --lq-bar-track: rgba(255, 255, 255, 0.1);
  --lq-border-radius: 0.25rem;
}
```

Participant widget uses `--lq-p-*` variables — see `participant/participant.css` for the full list.

## Data Attributes Reference

### Question Slide

| Attribute | Description |
|---|---|
| `data-quiz-id` | Unique quiz identifier |
| `data-quiz-question` | Question text |
| `data-quiz-options` | JSON array of `{label, text, correct?}` |

### Results Slide

| Attribute | Description |
|---|---|
| `data-quiz-results` | Quiz ID to show results for |
| `data-quiz-question` | Question text (shown as title) |
| `data-quiz-options` | JSON array of `{label, text, correct?}` |

## How It Works

1. Plugin scans slides for `data-quiz-id` and `data-quiz-results` during `init()`
2. DOM is injected (question UI, QR codes, bar charts) and `deck.sync()` is called
3. On `slidechanged`, plugin activates the current quiz via `QuizManager.setActiveQuiz()`
4. QuizManager broadcasts state over AnyCable public streams
5. Participant widget receives state updates and submits answers via serverless functions
6. Results bars animate when the results slide becomes active

## Architecture

```
Presenter (Reveal.js)          AnyCable            Audience (Mobile)
    │                             │                      │
    │  slidechanged → setActive   │                      │
    ├────────────── sync ────────►│◄──── quiz-sync ──────┤
    │                             │                      │
    │◄─── quiz:group:results ─────┤◄── quiz-answer ──────┤
    │  aggregate + dedup          │    (serverless fn)    │
    │                             │                      │
    ├───── quiz:group:sync ──────►│──────────────────────►│
    │  broadcast state            │    update UI          │
```

## License

MIT
