// @vitest-environment node
import { describe, it, expect } from "vitest";
import * as v from "valibot";
import { deliveryHealth, INITIAL_DELIVERY, DiagnosticEventSchema } from "../src/diagnostics";

describe("delivery health", () => {
  const accepted = { ...INITIAL_DELIVERY, startedAt: 0, lastAcceptedAt: 1000 };
  it("distinguishes socket connectivity from HTTP acceptance and phone receipt", () => {
    expect(deliveryHealth(INITIAL_DELIVERY, "connected", 2000).status).toBe("idle");
    expect(deliveryHealth(accepted, "disconnected", 2000).status).toBe("warning");
    expect(deliveryHealth(accepted, "connected", 2000).message).toContain("phone receipt unconfirmed");
    expect(deliveryHealth(accepted, "connected", 91_000).status).toBe("warning");
  });
  it("does not treat an old accepted state as delivery of a pending new question", () => {
    const pending = { ...accepted, pendingSince: 1500 };
    expect(deliveryHealth(pending, "connected", 2000).status).toBe("pending");
    expect(deliveryHealth(pending, "connected", 11_500).status).toBe("warning");
    expect(deliveryHealth({ ...pending, failures: 1 }, "connected", 2000).message).toContain("retrying");
  });
  it("does not flash an initial connection warning or report a clock rollback as fresh", () => {
    expect(deliveryHealth({ ...INITIAL_DELIVERY, startedAt: 0 }, "connecting", 500).status).toBe("pending");
    expect(deliveryHealth({ ...INITIAL_DELIVERY, startedAt: 0 }, "connecting", 10_000).status).toBe("warning");
    expect(deliveryHealth({ ...INITIAL_DELIVERY, startedAt: 0, lastAcceptedAt: 10_000 }, "connected", 1000).message).toContain("age unknown");
  });
  it("rejects vote contents and raw errors at the diagnostic boundary", () => {
    const event = { version: 1, timestamp: 1, event: "answer-sent", role: "participant", clientId: "anonymous", quizGroupId: "room", buildId: "build" };
    expect(v.safeParse(DiagnosticEventSchema, event).success).toBe(true);
    for (const field of ["answer", "results", "question", "cause", "url", "sessionId"])
      expect(v.safeParse(DiagnosticEventSchema, { ...event, [field]: "secret" }).success).toBe(false);
  });
});
