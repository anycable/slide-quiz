<script setup lang="ts">
import { ref } from "vue";
import { onSlideEnter } from "@slidev/client";
import LiveQuizResults from "../components/LiveQuizResults.vue";
import LiveQuizWordCloud from "../components/LiveQuizWordCloud.vue";
import LiveQuizError from "../components/LiveQuizError.vue";
import { useQuizManager } from "../composables/useQuizManager";

const props = defineProps<{
  quizId?: string;
  question?: string;
  type?: string;
  options?: { label: string; text: string; correct?: boolean }[];
}>();

const type = props.type ?? "choice";
const options = props.options ?? [];
const { configured, setActive } = useQuizManager();

const isText = type === "text";
const entered = ref(false);

onSlideEnter(() => {
  if (configured && props.quizId) setActive(props.quizId);
  entered.value = true;
});
</script>

<template>
  <LiveQuizError
    v-if="!configured"
    title="live-quiz not configured"
    message="Add a liveQuiz block to your first slide's frontmatter:"
    :fix="`---\nliveQuiz:\n  wsUrl: wss://your-cable.anycable.io/cable\n  quizGroupId: my-talk\n  quizUrl: https://your-site.com/quiz.html\n---`"
  />
  <LiveQuizError
    v-else-if="!props.quizId"
    title="Missing quiz frontmatter"
    message="This results slide is missing the required quizId field."
    :fix="`---\nlayout: quiz-results\nquizId: q1\nquestion: Your question here?\n---`"
  />
  <LiveQuizWordCloud v-else-if="isText" :quiz-id="props.quizId" :question="props.question" :animate="entered" />
  <LiveQuizResults v-else :quiz-id="props.quizId" :question="props.question" :options="options" :animate="entered" />
</template>
