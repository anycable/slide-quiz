<script setup lang="ts">
import { inject, ref } from "vue";
import { onSlideEnter } from "@slidev/client";
import LiveQuizResults from "../components/LiveQuizResults.vue";
import LiveQuizWordCloud from "../components/LiveQuizWordCloud.vue";
import LiveQuizError from "../components/LiveQuizError.vue";
import { useQuizManager } from "../composables/useQuizManager";
import { QUIZ_CONFIG_ERROR_KEY } from "../injectionKeys";

const props = defineProps<{
  quizId?: string;
  question?: string;
  type?: string;
  options?: { label: string; text: string; correct?: boolean }[];
}>();

const type = props.type ?? "choice";
const options = props.options ?? [];
const { configured, setActive } = useQuizManager();
const configError = inject(QUIZ_CONFIG_ERROR_KEY, null);

const isText = type === "text";
const entered = ref(false);

onSlideEnter(() => {
  if (configured && props.quizId) setActive(props.quizId);
  entered.value = true;
});
</script>

<template>
  <div class="slidev-layout lq-layout">
    <LiveQuizError
      v-if="configError"
      title="live-quiz config error"
      :message="configError"
      :fix="`---\nliveQuiz:\n  wsUrl: wss://<YOUR-ANYCABLE-URL>/cable\n  quizGroupId: <YOUR-GROUP-ID>\n  quizUrl: https://<YOUR-SITE>/quiz.html\n---`"
    />
    <LiveQuizError
      v-else-if="!configured"
      title="live-quiz not configured"
      message="Add a liveQuiz block to your first slide's frontmatter:"
      :fix="`---\nliveQuiz:\n  wsUrl: wss://<YOUR-ANYCABLE-URL>/cable\n  quizGroupId: <YOUR-GROUP-ID>\n  quizUrl: https://<YOUR-SITE>/quiz.html\n---`"
    />
    <LiveQuizError
      v-else-if="!props.quizId"
      title="Missing quiz frontmatter"
      message="This results slide is missing the required quizId field."
      :fix="`---\nlayout: quiz-results\nquizId: q1\nquestion: Your question here?\n---`"
    />
    <LiveQuizError
      v-else-if="!isText && options.length === 0"
      title="Missing options for choice results"
      message="This results slide needs options to display bar charts."
      :fix="`---\nlayout: quiz-results\nquizId: q1\nquestion: Your question here?\noptions:\n  - { label: A, text: Option 1 }\n  - { label: B, text: Option 2 }\n---`"
    />
    <LiveQuizWordCloud v-else-if="isText" :quiz-id="props.quizId" :question="props.question" :animate="entered" />
    <LiveQuizResults v-else :quiz-id="props.quizId" :question="props.question" :options="options" :animate="entered" />
  </div>
</template>
