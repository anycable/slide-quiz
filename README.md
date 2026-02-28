# live-quiz

Add live audience quizzes to your [Reveal.js](https://revealjs.com) presentations. Powered by [AnyCable](https://anycable.io).

**[Live Demo](https://livequizdemo.netlify.app/)** — open the presenter view in one tab and the [audience page](https://livequizdemo.netlify.app/quiz.html) on your phone.

## What You Get

You build a Reveal.js deck with quiz slides, deploy it to the web, and present it. When you land on a quiz slide, your audience sees a QR code, scans it on their phones, and votes — results animate on your slides in real time.

- **Multiple-choice questions** with up to 4 options and live bar charts
- **Free-text questions** with live word cloud results
- **QR code** auto-generated on each quiz slide so the audience can join instantly
- **Live results** that update as votes come in (sub-second via WebSockets)
- **Participant counter** showing how many people are connected
- **Mobile-friendly voting page** — no app install, just a browser
- **Automatic question sync** — define questions once on your slides, the audience page receives them automatically
- **Theming** — inherits your Reveal.js theme's fonts and colors automatically

## How It Works

Your presentation needs to be **deployed to the web** (not just opened locally) because the audience connects to it from their phones. The setup has three parts:

1. **AnyCable** — a managed WebSocket service that relays votes between the audience and your slides. The free tier supports up to **2,000 concurrent connections**, which is plenty for conference talks and meetups.

2. **Your presentation** — a static site (HTML + JS) deployed to **Netlify** or **Vercel**. The plugin adds quiz UI to your slides automatically.

3. **Serverless functions** — 3 small files (~60 lines total) that run on Netlify or Vercel. They receive votes from the audience and broadcast results via AnyCable. Secrets stay in environment variables, never in your code.

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
2. Scaffold a Reveal.js project with quiz slides
3. Deploy to Netlify or Vercel

### Option A: Interactive CLI (recommended)

One command that walks you through everything — creates your AnyCable app, scaffolds the project, and optionally deploys it:

```bash
npx create-live-quiz
```

The CLI will:
1. Open [plus.anycable.io](https://plus.anycable.io) and guide you through creating an AnyCable app
2. Ask for your **WebSocket URL** and **Broadcast URL** (the two values AnyCable gives you)
3. Scaffold a complete project with quiz slides, audience page, and serverless functions
4. Install dependencies and initialize git
5. Deploy via Netlify/Vercel CLI (if installed) or show manual deploy instructions

### Option B: Add to an existing Reveal.js presentation

If you already have a Reveal.js deck, you can add live quizzes to it manually.

#### 1. Create an AnyCable Plus app

1. Sign in at [plus.anycable.io](https://plus.anycable.io) with GitHub
2. Click **New Cable**, name it anything, pick **JavaScript** as your backend
3. On the Application secret screen, **clear the secret** (empty the input) — this enables public streams mode
4. After deploy, copy the **WebSocket URL** and **Broadcast URL**

#### 2. Install the plugin

```bash
npm install live-quiz
```

#### 3. Wire up the plugin

Add two imports and the `liveQuiz` config to your existing `Reveal.initialize()` call:

```js
import RevealLiveQuiz from 'live-quiz';
import 'live-quiz/style.css';

// In your existing Reveal.initialize() call, add:
Reveal.initialize({
  plugins: [RevealLiveQuiz],  // add to your plugins array
  liveQuiz: {
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
<!-- Multiple-choice question -->
<section data-quiz-id="q1"
         data-quiz-question="Where are you joining from?"
         data-quiz-options='[
           {"label":"A","text":"San Francisco"},
           {"label":"B","text":"New York"},
           {"label":"C","text":"Europe"},
           {"label":"D","text":"Elsewhere"}
         ]'>
</section>

<!-- Results slide (references the quiz above) -->
<section data-quiz-results="q1"
         data-quiz-question="Where are you joining from?"
         data-quiz-options='[
           {"label":"A","text":"San Francisco"},
           {"label":"B","text":"New York"},
           {"label":"C","text":"Europe"},
           {"label":"D","text":"Elsewhere"}
         ]'>
</section>

<!-- Free-text question (word cloud results) -->
<section data-quiz-id="q2" data-quiz-type="text"
         data-quiz-question="What's your favorite framework?">
</section>

<section data-quiz-results="q2" data-quiz-type="text"
         data-quiz-question="What's your favorite framework?">
</section>
```

`data-quiz-type` defaults to `"choice"` when omitted, so existing slides work without changes.

#### 5. Create the audience page

The audience needs a separate page to vote from their phones. Create a `quiz.html` and a script that mounts the participant widget:

```js
import { createParticipantUI } from 'live-quiz/participant';
import 'live-quiz/participant.css';

createParticipantUI('#quiz-root', {
  wsUrl: 'wss://your-cable.anycable.io/cable',
  quizGroupId: 'my-talk',
});
```

That's it — questions are synced automatically from your presentation slides. No need to duplicate them here.

#### 6. Add serverless functions and deploy

Your presentation must be deployed — the audience needs to reach it from their phones.

Copy the serverless functions from `functions/netlify/` or `functions/vercel/` into your project and set one environment variable:

| Variable | Description |
|---|---|
| `ANYCABLE_BROADCAST_URL` | Broadcast URL from step 1 |

See [functions/README.md](./functions/README.md) for step-by-step deploy instructions for each platform.

## AnyCable Plus

This plugin uses [AnyCable Plus](https://plus.anycable.io) — a managed WebSocket service. The free tier includes:

- Up to **2,000 concurrent connections**
- Public streams mode (no backend auth needed)
- WebSocket + HTTP broadcast endpoints

### A note on public streams

By default, the plugin uses **public streams** — WebSocket messages are not authenticated. This means anyone who knows the channel name could technically observe or interact with the quiz data. For most use cases (conference talks, meetups, workshops) this is perfectly fine — quiz votes aren't sensitive.

If your votes are confidential or you need to restrict who can participate, see [Appendix: Authorized Streams](#appendix-authorized-streams).

## Configuration

### Plugin Options (`liveQuiz`)

| Option | Type | Required | Description |
|---|---|---|---|
| `wsUrl` | `string` | Yes | AnyCable WebSocket URL |
| `quizGroupId` | `string` | Yes | Unique ID grouping quizzes in this talk |
| `quizUrl` | `string` | No | Audience page URL (shown as QR code) |
| `endpoints` | `object` | No | Custom endpoint paths (default: `/.netlify/functions/*`) |

### Custom Endpoints

For Vercel, override the default Netlify paths:

```js
liveQuiz: {
  endpoints: {
    answer: '/api/quiz-answer',
    sync: '/api/quiz-sync',
  }
}
```

## Theming

The plugin inherits your Reveal.js theme's fonts and colors via CSS custom properties. Override `--lq-*` variables to fine-tune:

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
| `data-quiz-type` | `"choice"` (default) or `"text"` |
| `data-quiz-options` | JSON array of `{label, text, correct?}` (choice only) |

### Results Slide

| Attribute | Description |
|---|---|
| `data-quiz-results` | Quiz ID to show results for |
| `data-quiz-question` | Question text (shown as title) |
| `data-quiz-type` | `"choice"` (default) or `"text"` |
| `data-quiz-options` | JSON array of `{label, text, correct?}` (choice only) |

## Limitations

- **Two question types** — multiple choice (up to 4 options) and free text (word cloud). No ratings or scales yet.
- **Requires deployment** — the audience connects over the internet, so the presentation must be hosted, not served locally.
- **AnyCable free tier** — supports up to 2,000 concurrent connections. For larger audiences, upgrade to a paid AnyCable Plus plan.
- **No persistent storage** — quiz results live in memory during the presentation. Once the presenter closes the tab, results are gone.
- **Netlify and Vercel only** — the serverless functions are provided for these two platforms. Other platforms (Cloudflare Workers, AWS Lambda) would need manual porting.

## Appendix: Authorized Streams

> **TODO** — Instructions for setting up AnyCable [signed streams](https://docs.anycable.io/anycable-go/signed_streams) for private quizzes. Coming soon.

## License

MIT
