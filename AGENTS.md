# Architecture & Design Principles

This document describes the internal design of live-quiz for contributors and AI agents working on the codebase.

## Layered Architecture

The codebase separates the **quiz engine** (framework-agnostic) from **presentation adapters** (framework-specific):

```
┌─────────────────────────────────────────────────┐
│  Presentation Adapters                          │
│  ┌──────────────────┐  ┌──────────────────────┐ │
│  │ Reveal.js Plugin  │  │ Slidev Addon         │ │
│  │ src/plugin.ts     │  │ packages/slidev-…/   │ │
│  │ src/dom/render-*  │  │ Vue components +     │ │
│  │ imperative DOM    │  │ layouts              │ │
│  └────────┬─────────┘  └──────────┬───────────┘ │
│           │                       │              │
│  ─────────┴───────────────────────┴──────────    │
│                                                  │
│  Quiz Engine (framework-agnostic)                │
│  ┌──────────────────────────────────────────┐    │
│  │ QuizManager classes    (quiz-manager.ts) │    │
│  │ Schemas & types        (quiz-types.ts)   │    │
│  │ Participant widget     (participant/)    │    │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

The quiz engine handles WebSocket connections, vote aggregation, state broadcasting, and persistence. Presentation adapters handle rendering — the Reveal.js plugin uses imperative DOM; the Slidev addon uses Vue components. Both call `getQuizPresenter()` to get a shared `PresenterQuizManager` instance.

This separation means adding support for another presentation framework only requires writing a new adapter — the quiz engine stays unchanged.

## Presenter as Source of Truth

The system has two roles — **presenter** and **participant** — with asymmetric responsibilities:

- **Presenter** (`PresenterQuizManager`): subscribes to the `:results` stream, aggregates votes (with deduplication by session ID), maintains the authoritative state, and broadcasts it via the `:sync` stream. Ignores incoming sync messages from other presenters.

- **Participant** (`ParticipantQuizManager`): subscribes to the `:sync` stream, applies incoming state, joins presence (for online count), and submits answers via a serverless function. Never aggregates — it trusts the presenter's state.

There is no server-side state. The presenter's browser tab is the database. Session storage provides persistence across page reloads, but closing the tab loses results.

## Schema-First Design

All data that crosses a boundary — WebSocket messages, serverless function payloads, `data-*` attributes, session storage — is defined as a [Valibot](https://valibot.dev) schema first. TypeScript types are derived from schemas, never the other way around:

```ts
// quiz-types.ts — schema is the source of truth
export const AnswerPayloadSchema = v.object({
  quizId: v.string(),
  answer: v.string(),
  sessionId: v.string(),
});
export type AnswerPayload = v.InferOutput<typeof AnswerPayloadSchema>;
```

This guarantees that validation logic and types can never drift apart. The same schemas are used by the quiz engine, the Reveal.js plugin, the Slidev addon, and the serverless functions.

For `data-*` attributes that contain JSON strings (like `data-quiz-options`), Valibot's `v.pipe()` with `v.rawTransform()` handles parsing and validation in a single pipeline:

```ts
export const JsonQuizOptionsSchema = v.pipe(
  v.optional(v.string(), "[]"),
  v.rawTransform(({ dataset, addIssue, NEVER }) => {
    try { return JSON.parse(dataset.value); }
    catch { addIssue({ message: "Invalid JSON" }); return NEVER; }
  }),
  v.array(QuizOptionSchema),
);
```

## Shared Identifiers as Constants

Any string that appears in both a **producer** role (writing it into the DOM, providing a value) and a **consumer** role (reading it back via a query, injecting a value) must be defined as a constant.

Class names used in both templates and `querySelector` calls live in `src/dom/selectors.ts` and `participant/selectors.ts`:

```ts
export const CLS = {
  results: "lq-results",
  resultBar: "lq-result-bar",
  resultBarFill: "lq-result-bar__fill",
  // ...
} as const;
```

The same principle applies to:
- **Provide/inject keys** in the Slidev addon (`injectionKeys.ts`)
- **WebSocket stream names** via `resultsStream()` / `syncStream()` builders in `quiz-types.ts`
- **Data attribute names** like `data-lq-quiz`

Classes that only appear in templates and CSS (never queried) don't need constants.

## Declarative DOM with Tagged Templates

The Reveal.js plugin renders DOM using an `html` tagged template literal (`src/dom/html.ts`) instead of imperative `createElement`/`appendChild` chains:

```ts
const fragment = html`
  <div class="${CLS.results}" data-lq-quiz="${quizId}">
    <h2>${question}</h2>
    ${options.map(opt => html`
      <div class="${CLS.resultBar}" data-option="${opt.label}">...</div>
    `)}
  </div>
`;
slide.appendChild(fragment);
```

Interpolated values are HTML-escaped by default. `Node` values compose naturally. `null`, `undefined`, and `false` produce no output, enabling `${condition ? html`...` : null}`.

## WebSocket Streams

Each `quizGroupId` uses two AnyCable public streams:

| Stream | Direction | Purpose |
|---|---|---|
| `quiz:{id}:results` | Participant → Presenter | Individual answer submissions |
| `quiz:{id}:sync` | Presenter → Participant | Full state broadcasts (active quiz, all results, questions) |

Answers are POSTed to a serverless function, which broadcasts to the `:results` stream via AnyCable's HTTP broadcast API. This keeps the broadcast key server-side.

Both sides throttle at 200ms — the presenter throttles outgoing sync broadcasts, the participant throttles incoming sync application.

## CSS for Motion, JS for State

Use CSS `transition` and `animation` for visual changes (opacity, width, transform, color). Use JS only to *trigger* those changes — toggling a class, setting a CSS variable, or updating a target value. JS animation loops (`requestAnimationFrame`) are a last resort for things CSS can't express (like counting up numbers).

CSS animations are GPU-accelerated, automatically composable, and `prefers-reduced-motion: reduce` can disable them all with a single `transition: none` rule.

In practice, bar fills and word cloud entrances use CSS `transition` with JS setting the target `width`/`opacity` and a staggered `transitionDelay`. The only JS-driven animation is `animateCount()`, which changes text content over time.

## UI & Theming

- **Inherit, don't impose.** The presenter CSS reads from the framework (`--r-*` for Reveal.js, `currentColor` for Slidev) and only overrides for quiz-specific identity (accent color).

- **Derive colors, don't define them.** Secondary colors are computed from primary ones via `color-mix()`: `--lq-text-muted: color-mix(in srgb, var(--lq-text) 50%, transparent)`. Define 2-3 base colors; derive the rest.

- **Scale with `clamp()`, not breakpoints.** No media queries (except `prefers-reduced-motion`). Typography scales fluidly: `clamp(1rem, 2.2vw, 1.5rem)`. Presentations are fullscreen — the viewport is the slide.

- **BEM naming under `lq-` namespace.** All classes follow `.lq-<block>__<element>--<modifier>`. The prefix prevents collisions with any framework theme.

- **Respect motion preferences.** Both CSS (`@media (prefers-reduced-motion: reduce)`) and JS (`window.matchMedia(...)`) honor the user's reduced motion setting.

## Testing

- **Test the engine, not the framework glue.** The quiz engine contains all the interesting logic (vote aggregation, dedup, throttling, persistence). Adapters are thin wiring — testing them requires mocking the framework, which is brittle and low-value.

- **Test each layer's own decisions, not the layers below it.** Engine tests cover computation and state. Adapter tests (if any) cover wiring and rendering. An adapter test that asserts on vote counts or percentage values is testing the wrong layer.

- **Mock at the infrastructure boundary, not at internal seams.** Mock `@anycable/web` (the WebSocket library). Use real `sessionStorage`, real `fetch` stubs, real timers. No internal classes are mocked.

- **Test behavior, not implementation.** Tests say "deduplicates votes by sessionId" — they verify outcomes, not how the code gets there. Refactoring internals doesn't break tests.

- **Test computations that encode design decisions.** Percentage rounding, word cloud font scaling, and animation easing are UX decisions that deserve unit tests. Schema declarations (like `v.object({ quizId: v.string() })`) do not — that's testing Valibot, not your code. Test your *pipelines* (like `JsonQuizOptionsSchema` which does JSON parsing + validation), not your declarations.
