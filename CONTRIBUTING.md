# Contributing to slide-quiz

Thanks for helping. This document covers how the repo is laid out, how to run it, and what a good pull request looks like. Architecture and design rules live in [AGENTS.md](./AGENTS.md); read that first if you plan to touch `src/` or `participant/`.

## Where things live

| Path | What it is | Published as |
|---|---|---|
| `src/` | Quiz engine + Reveal.js plugin | `slide-quiz` |
| `participant/` | Audience page widget | `slide-quiz/participant` |
| `functions/` | Netlify and Vercel serverless functions users copy into their project | inside `slide-quiz` |
| `packages/slidev-addon-slide-quiz/` | Slidev addon (Vue components and layouts) | `slidev-addon-slide-quiz` |
| `skills/` | Agent skills for setting up and debugging a deck | inside `slide-quiz` |
| `tests/` | Vitest unit tests | |

The interactive scaffolder, `npx create-slide-quiz`, lives in its own repo: [anycable/create-slide-quiz](https://github.com/anycable/create-slide-quiz).

## Running locally

```bash
npm install
npm test            # vitest, once
npm run test:watch  # vitest, watch mode
npm run build       # library + participant bundle + type declarations
npx tsc --noEmit -p .
```

To try the Slidev addon against your local engine:

```bash
cd packages/slidev-addon-slide-quiz
npm run dev         # starts Slidev with the demo slides.md
```

The addon depends on the **published** `slide-quiz` package, pinned by `package-lock.json`, since the root package is not itself a workspace. To test the addon against unreleased engine changes, run `npm run build` at the root and copy `dist/` over `packages/slidev-addon-slide-quiz/node_modules/slide-quiz/dist/`, or point the dependency at `"file:../.."` temporarily. The `prepublishOnly` hook refuses to publish while a `file:` dependency is present, so you cannot ship that by accident. Engine changes the addon relies on must be guarded (optional chaining) until the addon's minimum engine version is raised.

There is no local WebSocket server in this repo. For end-to-end checks, create a free public cable at [plus.anycable.io](https://plus.anycable.io) and deploy a deck to Netlify or Vercel. The [setup skill](./skills/slide-quiz-setup/SKILL.md) is the shortest path.

## Reporting bugs

Use the [bug report template](https://github.com/anycable/slide-quiz/issues/new?template=bug_report.yml). slide-quiz never sends telemetry from your deck or your audience's phones, so the console output and config you paste are all we have. The [debug skill](./skills/slide-quiz-debug/SKILL.md) lists the checks to run before filing, and an AI agent can run them for you.

Questions and "how do I" threads go in [Discussions](https://github.com/anycable/slide-quiz/discussions).

## Pull requests

1. Open an issue or discussion first for anything larger than a bug fix, so the design is agreed before you write code.
2. Branch from `main`. Keep the PR to one change.
3. Add a test. The engine is well covered by `tests/quiz-manager.test.ts`; look there for the mocking pattern for AnyCable.
4. Follow the rules in AGENTS.md. The two that catch most reviewers: every boundary payload has a Valibot schema, and every class name used in both a template and a `querySelector` is a constant in `selectors.ts`.
5. Add a line to `CHANGELOG.md` under "Unreleased".
6. CI runs typecheck, tests, build, and a tarball check on Node 20 and 22. It has to be green.

## Releasing

Maintainers only. The two packages version independently.

```bash
# engine + Reveal.js plugin + participant widget
npm version minor        # or patch
npm publish
git push --follow-tags

# Slidev addon: after the engine is on npm, raise its slide-quiz range,
# refresh the lockfile, then publish
cd packages/slidev-addon-slide-quiz
#   edit package.json: "slide-quiz": "^0.6.0"
cd ../.. && npm install && cd packages/slidev-addon-slide-quiz
npm version minor
npm publish
```

The shipped `public/quiz.html` loads the participant bundle from a CDN pinned to the engine's major.minor (`slide-quiz@0.6`). Bump that too when the engine's minor changes.

Move the "Unreleased" section of `CHANGELOG.md` under the new version before publishing.

## Code of conduct

Be kind. Assume the other person is doing their best. Maintainers may close or lock threads that stop being constructive.
