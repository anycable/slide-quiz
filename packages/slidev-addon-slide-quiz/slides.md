---
addons:
  - ./
slideQuiz:
  wsUrl: wss://demo.anycable.io/cable
  quizGroupId: slidev-dev
  quizUrl: http://localhost:3030/quiz.html
---

# Live Quiz — Slidev Addon Dev Preview

Navigate through the slides to test quiz layouts.

---
layout: quiz-results
quizId: q1
question: Where will you deploy?
options:
  - { label: A, text: Netlify, correct: true }
  - { label: B, text: Vercel }
  - { label: C, text: Cloudflare }
---

---
layout: quiz-results
quizId: q2
question: What's your favorite framework?
type: text
---
