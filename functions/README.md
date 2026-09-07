# Backend Functions

These serverless functions broadcast quiz events via AnyCable. Copy the folder for your platform into your project.

## Environment Variables

| Variable | Description |
|---|---|
| `ANYCABLE_BROADCAST_URL` | AnyCable HTTP broadcast endpoint (from AnyCable Plus dashboard) |

**Never put this in your code.** Set it in your platform's dashboard.

## Netlify

1. Copy `functions/netlify/*.mts` (not `package.json`) to `netlify/functions/` in your project
2. Add the runtime dependencies to your project: `npm install @anycable/serverless-js valibot`
3. Set env vars in **Netlify dashboard > Site settings > Environment variables**
4. Deploy — endpoints are `/.netlify/functions/quiz-answer` and `/.netlify/functions/quiz-sync` (the defaults)

## Vercel

1. Copy `functions/vercel/*.ts` (not `package.json`) to `api/` in your project
2. Add the runtime dependencies to your project: `npm install @anycable/serverless-js valibot`
3. Set env vars in **Vercel dashboard > Settings > Environment Variables**
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
