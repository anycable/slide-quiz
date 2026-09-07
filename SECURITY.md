# Security

## Reporting a vulnerability

Email **anycable@evilmartians.com** or use [GitHub private vulnerability reporting](https://github.com/anycable/slide-quiz/security/advisories/new). Please do not open a public issue for security problems. You will hear back within a few business days.

## What is and is not in scope

slide-quiz is a client-side library plus two small serverless functions. Things worth reporting:

- A way for an audience member to alter the presenter's results beyond casting one vote per session (vote stuffing across sessions is expected with public streams, see below)
- A way to make the serverless functions broadcast to a stream outside the `quiz:{quizGroupId}:*` namespace
- Leakage of `ANYCABLE_BROADCAST_URL` or `ANYCABLE_BROADCAST_KEY` to the client
- XSS through question text, option text, or free-text answers rendered on the presenter's slides or the audience page

## Known properties of the default setup

- The serverless functions accept POSTs from anyone who knows the site URL. Payloads are schema-validated but not authenticated, so a third party can push a fake question to the audience or fake answers to the presenter. All such text is rendered as text, never as HTML.
- The audience page takes the cable URL and quiz group from the QR link's query string. A crafted link can point a phone at another cable. Votes still go only to same-origin function paths.

## Public streams by design

The default setup uses AnyCable **public streams**. Anyone who knows the `quizGroupId` can subscribe to results and submit votes. This is a deliberate trade-off for conference talks and meetups where votes are not sensitive. It is documented in the README under "A note on public streams". Reports that amount to "public streams are public" will be closed as expected behavior. If you need private quizzes, watch the README appendix on authorized streams.
