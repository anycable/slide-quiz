import { defineAppSetup } from "@slidev/types";
import { configs } from "@slidev/client";
import * as v from "valibot";
import { getQuizPresenter } from "live-quiz";
import { SlidevLiveQuizConfigSchema } from "../schemas";
import { QUIZ_MANAGER_KEY, QUIZ_CONFIG_KEY } from "../injectionKeys";

export default defineAppSetup(({ app }) => {
  const raw = (configs as Record<string, unknown>).liveQuiz;
  if (!raw) return; // layouts will show the inline error

  const parsed = v.safeParse(SlidevLiveQuizConfigSchema, raw);
  if (!parsed.success) {
    console.warn("[live-quiz] Invalid liveQuiz config:", v.flatten(parsed.issues));
    return;
  }

  const manager = getQuizPresenter(parsed.output);
  app.provide(QUIZ_MANAGER_KEY, manager);
  app.provide(QUIZ_CONFIG_KEY, parsed.output);
});
