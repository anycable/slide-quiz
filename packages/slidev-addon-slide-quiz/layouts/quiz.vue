<script setup lang="ts">
import { inject, onMounted } from "vue";
import { onSlideEnter, onSlideLeave, useIsSlideActive, useSlideContext } from "@slidev/client";
import SlideQuizQuestion from "../components/SlideQuizQuestion.vue";
import SlideQuizError from "../components/SlideQuizError.vue";
import SlideQuizSyncError from "../components/SlideQuizSyncError.vue";
import { useQuizManager } from "../composables/useQuizManager";
import { QUIZ_CONFIG_ERROR_KEY } from "../injectionKeys";
import type { QuizType } from "slide-quiz";

const props = defineProps<{
  quizId?: string;
  question?: string;
  type?: string;
  options?: { label: string | number; text: string | number }[];
  titleText?: string;
  hintText?: string;
}>();

const type = (props.type ?? "choice") as QuizType;
// YAML reads `text: 27` as a number; the engine and the sync function expect strings.
const options = (props.options ?? []).map((o) => ({ label: String(o.label), text: String(o.text) }));
const { configured, registerQuestion, setActive, clearActive } = useQuizManager();
const configError = inject(QUIZ_CONFIG_ERROR_KEY, null);
// Slidev mounts slides ahead of time; only the slide on screen may activate its question.
const isSlideActive = useIsSlideActive();
const { $page } = useSlideContext();

const validTypes = ["choice", "multi", "text"];
const missingProps = [
  !props.quizId && "quizId",
  !props.question && "question",
  props.type && !validTypes.includes(props.type) && `type (must be "choice", "multi" or "text", got "${props.type}")`,
  type !== "text" && options.length === 0 && "options",
].filter(Boolean);

onMounted(() => {
  if (!configured || missingProps.length) return;
  registerQuestion({
    quizId: props.quizId!,
    question: props.question!,
    type,
    options,
  }, $page.value);
  if (props.quizId && isSlideActive.value) setActive(props.quizId, $page.value);
});

onSlideEnter((to) => {
  if (configured && props.quizId) setActive(props.quizId, to);
});

onSlideLeave((_to, from) => {
  if (configured && from !== undefined) clearActive(from);
});
</script>

<template>
  <div class="slidev-layout sq-layout">
    <SlideQuizError
      v-if="configError"
      title="slide-quiz config error"
      :message="configError"
      :fix="`---\nslideQuiz:\n  wsUrl: wss://<YOUR-ANYCABLE-URL>/cable\n  quizGroupId: <YOUR-GROUP-ID>\n  quizUrl: https://<YOUR-SITE>/quiz.html\n---`"
    />
    <SlideQuizError
      v-else-if="!configured"
      title="slide-quiz not configured"
      message="Add a slideQuiz block to your first slide's frontmatter:"
      :fix="`---\nslideQuiz:\n  wsUrl: wss://<YOUR-ANYCABLE-URL>/cable\n  quizGroupId: <YOUR-GROUP-ID>\n  quizUrl: https://<YOUR-SITE>/quiz.html\n---`"
    />
    <SlideQuizError
      v-else-if="missingProps.length"
      title="Missing quiz frontmatter"
      :message="`This slide is missing required fields: ${missingProps.join(', ')}`"
      :fix="`---\nlayout: quiz\nquizId: q1\nquestion: Your question here?\noptions:\n  - { label: A, text: Option 1 }\n  - { label: B, text: Option 2 }\n---`"
    />
    <SlideQuizQuestion
      v-else
      :quiz-id="props.quizId!"
      :question="props.question!"
      :type="type"
      :options="options"
      :title-text="props.titleText"
      :hint-text="props.hintText"
    />
    <SlideQuizSyncError />
  </div>
</template>
