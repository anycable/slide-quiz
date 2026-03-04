import type { InjectionKey } from "vue";
import type { PresenterQuizManager } from "live-quiz";
import type { SlidevLiveQuizConfig } from "./schemas";

export const QUIZ_MANAGER_KEY: InjectionKey<PresenterQuizManager> =
  Symbol("liveQuizManager");

export const QUIZ_CONFIG_KEY: InjectionKey<SlidevLiveQuizConfig> =
  Symbol("liveQuizConfig");
