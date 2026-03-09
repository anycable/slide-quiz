import type { InjectionKey } from "vue";
import type { PresenterQuizManager } from "slide-quiz";
import type { SlidevSlideQuizConfig } from "./schemas";

export const QUIZ_MANAGER_KEY: InjectionKey<PresenterQuizManager> =
  Symbol("slideQuizManager");

export const QUIZ_CONFIG_KEY: InjectionKey<SlidevSlideQuizConfig> =
  Symbol("slideQuizConfig");

export const QUIZ_CONFIG_ERROR_KEY: InjectionKey<string> =
  Symbol("slideQuizConfigError");
