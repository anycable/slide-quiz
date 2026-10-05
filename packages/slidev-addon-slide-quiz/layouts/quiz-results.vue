<script setup lang="ts">
import { inject, ref, onMounted } from "vue";
import { onSlideEnter, onSlideLeave, useIsSlideActive, useSlideContext } from "@slidev/client";
import SlideQuizResults from "../components/SlideQuizResults.vue";
import SlideQuizWordCloud from "../components/SlideQuizWordCloud.vue";
import SlideQuizError from "../components/SlideQuizError.vue";
import SlideQuizSyncError from "../components/SlideQuizSyncError.vue";
import { useQuizManager } from "../composables/useQuizManager";
import { QUIZ_CONFIG_ERROR_KEY } from "../injectionKeys";
import type { QuizType } from "slide-quiz";

const props = defineProps<{
  quizId?: string;
  question?: string;
  type?: string;
  options?: { label: string | number; text: string | number; correct?: boolean }[];
}>();

const type = (props.type ?? "choice") as QuizType;
// YAML reads `text: 27` as a number; the engine and the sync function expect strings.
const options = (props.options ?? []).map((o) => ({ label: String(o.label), text: String(o.text), correct: o.correct }));
const { configured, registerQuestion, setActive, clearActive } = useQuizManager();
const configError = inject(QUIZ_CONFIG_ERROR_KEY, null);
// Slidev mounts slides ahead of time; only the slide on screen may activate its question.
const isSlideActive = useIsSlideActive();
const { $page } = useSlideContext();

const validTypes = ["choice", "multi", "text"];
// A misspelled type would otherwise render as single choice and make the sync function answer 400
const typeError = props.type && !validTypes.includes(props.type)
  ? `type must be "choice", "multi" or "text", got "${props.type}"`
  : null;
const isText = type === "text";
const entered = ref(false);

// Register question so standalone results slides (no matching quiz slide) work
if (configured && props.quizId && !typeError) {
  registerQuestion({
    quizId: props.quizId,
    question: props.question ?? "",
    type,
    options: options.map((o) => ({ label: o.label, text: o.text })),
  }, $page.value, { fromResults: true });
}

onMounted(() => {
  if (configured && props.quizId && isSlideActive.value) setActive(props.quizId, $page.value);
  entered.value = true;
});

onSlideEnter((to) => {
  if (configured && props.quizId) setActive(props.quizId, to);
  entered.value = true;
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
      v-else-if="!props.quizId"
      title="Missing quiz frontmatter"
      message="This results slide is missing the required quizId field."
      :fix="`---\nlayout: quiz-results\nquizId: q1\nquestion: Your question here?\n---`"
    />
    <SlideQuizError
      v-else-if="typeError"
      title="Unknown quiz type"
      :message="typeError"
      :fix="`---\nlayout: quiz-results\nquizId: ${props.quizId}\ntype: multi  # or choice, text\n---`"
    />
    <SlideQuizError
      v-else-if="!isText && options.length === 0"
      title="Missing options for choice results"
      message="This results slide needs options to display bar charts."
      :fix="`---\nlayout: quiz-results\nquizId: q1\nquestion: Your question here?\noptions:\n  - { label: A, text: Option 1 }\n  - { label: B, text: Option 2 }\n---`"
    />
    <SlideQuizWordCloud v-else-if="isText" :quiz-id="props.quizId" :question="props.question" :animate="entered" />
    <SlideQuizResults v-else :quiz-id="props.quizId" :question="props.question" :type="type" :options="options" :animate="entered" />
    <SlideQuizSyncError />
  </div>
</template>
