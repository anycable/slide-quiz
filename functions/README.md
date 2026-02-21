# Backend Functions

These serverless functions broadcast quiz events via AnyCable. Copy the folder for your platform into your project.

## Environment Variables

| Variable | Description |
|---|---|
| `ANYCABLE_BROADCAST_URL` | AnyCable HTTP broadcast endpoint (from AnyCable Plus dashboard) |

**Never put this in your code.** Set it in your platform's dashboard.

## Netlify

1. Copy `functions/netlify/` contents to `netlify/functions/` in your project
2. Set env vars in **Netlify dashboard > Site settings > Environment variables**
3. Deploy — endpoints are `/.netlify/functions/quiz-answer` and `/.netlify/functions/quiz-sync` (the defaults)

## Vercel

1. Copy `functions/vercel/` contents to `api/` in your project
2. Set env vars in **Vercel dashboard > Settings > Environment Variables**
3. Deploy — endpoints are `/api/quiz-answer` and `/api/quiz-sync`
4. Configure the plugin to use Vercel endpoints:

```js
liveQuiz: {
  endpoints: {
    answer: '/api/quiz-answer',
    sync: '/api/quiz-sync',
  }
}
```
