/**
 * Shared utilities for quiz serverless functions.
 * Copy these files to your project's functions directory.
 */
import { broadcaster } from "@anycable/serverless-js";

const broadcastURL =
  process.env.ANYCABLE_BROADCAST_URL || "http://127.0.0.1:8090/_broadcast";
const broadcastKey = process.env.ANYCABLE_BROADCAST_KEY || "";

export const broadcastTo = broadcaster(broadcastURL, broadcastKey);

export function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function requirePost(req: Request): Response | null {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  return null;
}

export function requireString(
  value: unknown,
  name: string,
): Response | null {
  if (typeof value !== "string" || value.length === 0) {
    return jsonResponse({ error: `Missing field: ${name}` }, 400);
  }
  return null;
}
