import { defineAppSetup } from "@slidev/types";
import { configs } from "@slidev/client";
import * as v from "valibot";
import { getQuizPresenter } from "live-quiz";
import { SlidevLiveQuizConfigSchema } from "../schemas";
import { QUIZ_MANAGER_KEY, QUIZ_CONFIG_KEY, QUIZ_CONFIG_ERROR_KEY } from "../injectionKeys";

export default defineAppSetup(({ app }) => {
  const raw = (configs as Record<string, unknown>).liveQuiz;
  if (!raw) return; // layouts will show the inline error

  const parsed = v.safeParse(SlidevLiveQuizConfigSchema, raw);
  if (!parsed.success) {
    const flat = v.flatten(parsed.issues);
    const msg = Object.entries(flat.nested ?? {})
      .map(([k, msgs]) => `${k}: ${msgs?.[0]}`)
      .join(", ");
    console.warn("[live-quiz] Invalid config:", msg);
    app.provide(QUIZ_CONFIG_ERROR_KEY, msg);
    return;
  }

  try {
    const manager = getQuizPresenter(parsed.output);
    app.provide(QUIZ_MANAGER_KEY, manager);
    app.provide(QUIZ_CONFIG_KEY, parsed.output);
    console.log("[live-quiz] Connected — group:", parsed.output.quizGroupId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[live-quiz] Failed to initialize:", msg);
    app.provide(QUIZ_CONFIG_ERROR_KEY, msg);
  }
});
