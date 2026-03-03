import { defineAppSetup } from "@slidev/types";
import { configs } from "@slidev/client";
import * as v from "valibot";
import { getQuizPresenter } from "live-quiz";
import { SlidevLiveQuizConfigSchema } from "../schemas";

export default defineAppSetup(({ app }) => {
  const raw = (configs as Record<string, unknown>).liveQuiz;
  const parsed = v.safeParse(SlidevLiveQuizConfigSchema, raw);
  if (!parsed.success) {
    console.warn(
      "[live-quiz] Missing or invalid liveQuiz config in headmatter. " +
      "Add liveQuiz: { wsUrl, quizGroupId } to your first slide."
    );
    return;
  }

  const manager = getQuizPresenter(parsed.output);
  app.provide("liveQuizManager", manager);
  app.provide("liveQuizConfig", parsed.output);
});
