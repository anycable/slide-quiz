# Backend Functions

These serverless functions broadcast quiz events via AnyCable. Copy the folder for your platform into your project.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANYCABLE_BROADCAST_URL` | Yes | AnyCable HTTP broadcast endpoint (from AnyCable Plus dashboard) |
| `ANYCABLE_BROADCAST_KEY` | No | Broadcast key, if your AnyCable app uses one |

**Never put these in your code.** Set them in your platform's dashboard, then **redeploy**: functions read environment variables at deploy time. Without `ANYCABLE_BROADCAST_URL` both functions answer 502 with a message naming the variable, and the presenter's banner points at it.

Copy the functions again whenever you upgrade slide-quiz. Functions older than the deck reject new question types (such as multi-select) with a 400.

## Netlify

1. Copy `functions/netlify/*.mts` (not `package.json`) to `netlify/functions/` in your project: `mkdir -p netlify/functions && cp node_modules/slide-quiz/functions/netlify/*.mts netlify/functions/`
2. Add the runtime dependencies to your project: `npm install @anycable/serverless-js valibot`
3. Set env vars in **Netlify dashboard > Site settings > Environment variables**, then redeploy
4. Deploy — endpoints are `/.netlify/functions/quiz-answer` and `/.netlify/functions/quiz-sync` (the defaults)

## Vercel

1. Copy `functions/vercel/*.ts` (not `package.json`) to `api/` in your project: `mkdir -p api && cp node_modules/slide-quiz/functions/vercel/*.ts api/`
2. Add the runtime dependencies to your project: `npm install @anycable/serverless-js valibot`
3. Set env vars in **Vercel dashboard > Settings > Environment Variables**, then redeploy
4. For Slidev, add a `vercel.json` with `{"buildCommand": "npx slidev build", "outputDirectory": "dist"}`
5. Deploy — endpoints are `/api/quiz-answer` and `/api/quiz-sync`
6. Configure the plugin to use Vercel endpoints:

```js
slideQuiz: {
  endpoints: {
    answer: '/api/quiz-answer',
    sync: '/api/quiz-sync',
  }
}
```

## Verifying a deploy

`npx -p create-slide-quiz verify-slide-quiz --site https://your-site --platform vercel --ws-url wss://your-cable/cable` (from the `create-slide-quiz` package) checks the audience page, both functions, and a real broadcast round trip over the WebSocket. Run it after every deploy that touches the functions.
