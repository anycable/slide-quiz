// @vitest-environment node
/**
 * Real AnyCable, real @anycable/web client, real sync broadcasts. The phone
 * reaches the cable through a TCP proxy that imitates conference wifi:
 *
 * - "stall": open sockets stop carrying data and new ones hang, the way an
 *   overloaded access point behaves (nothing is closed, nothing arrives).
 * - "refuse": every connection is reset at once (wifi off, cable down).
 *
 * Answers go through a stand-in answer function that can hold a request
 * without responding, the way a hung request on bad wifi behaves.
 *
 * Needs `anycable-go` on PATH (or ANYCABLE_GO=/path/to/anycable-go).
 * Run with `npm run test:integration`.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import net from "node:net";
import http from "node:http";
import { PresenterQuizManager, ParticipantQuizManager } from "../../src/quiz-manager";
import { syncStream, resultsStream } from "../../src/quiz-types";

const ANYCABLE_GO = process.env.ANYCABLE_GO || "anycable-go";
const available = (() => {
  try {
    execFileSync(ANYCABLE_GO, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const Q1 = { quizId: "q1", question: "Fav color?", type: "choice" as const, options: [{ label: "A", text: "Red" }, { label: "B", text: "Blue" }] };
const Q2 = { quizId: "q2", question: "Fav food?", type: "choice" as const, options: [{ label: "A", text: "Pizza" }] };

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

async function waitFor(what: string, check: () => boolean, timeoutMs: number): Promise<number> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  return Date.now() - start;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const origLog = console.log;

type Mode = "pass" | "stall" | "refuse";

/** TCP proxy between the phone and AnyCable that can imitate bad wifi. */
function wifiProxy(listenPort: number, targetPort: number) {
  let mode: Mode = "pass";
  const live = new Set<{ client: net.Socket; upstream?: net.Socket; dead: boolean }>();
  let attempts = 0;

  const server = net.createServer((client) => {
    attempts++;
    const pair: { client: net.Socket; upstream?: net.Socket; dead: boolean } = { client, dead: false };
    live.add(pair);
    client.on("error", () => {});
    client.on("close", () => { pair.upstream?.destroy(); live.delete(pair); });
    if (mode === "refuse") {
      client.resetAndDestroy();
      return;
    }
    if (mode === "stall") {
      // Accepted, never answered: a handshake that hangs
      pair.dead = true;
      return;
    }
    const upstream = net.connect(targetPort, "127.0.0.1");
    pair.upstream = upstream;
    upstream.on("error", () => client.destroy());
    upstream.on("close", () => client.destroy());
    client.on("data", (d) => { if (!pair.dead) upstream.write(d); });
    upstream.on("data", (d) => { if (!pair.dead) client.write(d); });
  });

  return {
    listen: () => new Promise<void>((r) => server.listen(listenPort, "127.0.0.1", () => r())),
    get attempts() { return attempts; },
    set(next: Mode) {
      mode = next;
      if (next === "stall") for (const p of live) p.dead = true; // existing sockets go silent
      if (next === "refuse") for (const p of live) p.client.resetAndDestroy();
      // "pass": sockets that died stay dead, as on real wifi; the client must notice and reconnect
    },
    close: () => new Promise<void>((r) => {
      for (const p of live) { p.client.destroy(); p.upstream?.destroy(); }
      server.close(() => r());
    }),
  };
}

describe.skipIf(!available)("phone connection recovery against a real AnyCable", () => {
  let cable: ChildProcess;
  let syncServer: http.Server;
  let proxy: ReturnType<typeof wifiProxy>;
  let cablePort: number;
  let proxyPort: number;
  let syncUrl: string;
  let answerUrl: string;
  // The answer function's requests; a held one gets no response until released
  const answers: { body: Record<string, unknown>; release: () => Promise<void> }[] = [];
  let holdAnswers = 0;
  const managers: { disconnect(): void }[] = [];
  let logs: string[] = [];
  const origInfo = console.info, origWarn = console.warn;

  beforeAll(async () => {
    cablePort = await freePort();
    const broadcastPort = await freePort();
    proxyPort = await freePort();
    const syncPort = await freePort();

    cable = spawn(ANYCABLE_GO, [
      "--public", "--host", "127.0.0.1", "--port", String(cablePort),
      "--broadcast_adapter", "http", "--http_broadcast_port", String(broadcastPort),
      "--broker", "memory", "--log_level", "warn",
    ], { stdio: "ignore" });
    const healthy = async () => {
      try { return (await fetch(`http://127.0.0.1:${cablePort}/health`)).ok; } catch { return false; }
    };
    const start = Date.now();
    while (!(await healthy())) {
      if (Date.now() - start > 10_000) throw new Error("anycable-go did not start");
      await sleep(100);
    }

    // Stands in for the quiz-sync and quiz-answer functions: forwards the payload to AnyCable
    const forward = (stream: string, data: unknown) => fetch(`http://127.0.0.1:${broadcastPort}/_broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stream, data: JSON.stringify(data) }),
    });
    syncServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        const { quizGroupId, ...broadcast } = JSON.parse(body);
        if (req.url === "/answer") {
          const release = async () => {
            const r = await forward(resultsStream(quizGroupId), broadcast);
            if (!res.writableEnded) res.writeHead(r.ok ? 200 : 502).end();
          };
          answers.push({ body: broadcast, release });
          if (holdAnswers > 0) holdAnswers--;
          else await release();
          return;
        }
        const r = await forward(syncStream(quizGroupId), broadcast);
        res.writeHead(r.ok ? 200 : 502).end();
      });
    });
    await new Promise<void>((r) => syncServer.listen(syncPort, "127.0.0.1", () => r()));
    syncUrl = `http://127.0.0.1:${syncPort}/sync`;
    answerUrl = `http://127.0.0.1:${syncPort}/answer`;

    proxy = wifiProxy(proxyPort, cablePort);
    await proxy.listen();

    const capture = (orig: (...a: unknown[]) => void) => (...args: unknown[]) => {
      const line = String(args[0]);
      if (line.includes("[slide-quiz:connection]") || line.includes("[AnyCable")) logs.push(`${new Date().toISOString().slice(14, 23)} ${line}`);
      if (process.env.VERBOSE) orig(...args);
    };
    console.info = capture(origInfo);
    console.warn = capture(origWarn);
    console.log = capture(origLog);
  }, 20_000);

  afterEach(() => {
    for (const m of managers.splice(0)) m.disconnect();
    answers.length = 0;
    holdAnswers = 0;
    if (process.env.VERBOSE) origLog(logs.join("\n"));
    logs = [];
  });

  afterAll(async () => {
    console.info = origInfo; console.warn = origWarn; console.log = origLog;
    await proxy?.close();
    syncServer?.close();
    cable?.kill();
  });

  function setup() {
    const group = `it-${crypto.randomUUID()}`;
    const presenter = new PresenterQuizManager({
      wsUrl: `ws://127.0.0.1:${cablePort}/cable`,
      quizGroupId: group,
      sessionId: "presenter",
      endpoints: { sync: syncUrl, answer: answerUrl },
    });
    managers.push(presenter);
    const openPhone = (name = "phone") => {
      const phone = new ParticipantQuizManager({
        wsUrl: `ws://127.0.0.1:${proxyPort}/cable`,
        quizGroupId: group,
        sessionId: name,
        endpoints: { sync: syncUrl, answer: answerUrl },
      });
      managers.push(phone);
      return phone;
    };
    return { presenter, openPhone };
  }

  const phoneLog = () => logs.filter((l) => l.includes("[slide-quiz:connection]")).join("\n");

  it("a phone joining a quiet results slide gets the question from stream history at once", async () => {
    proxy.set("pass");
    const { presenter, openPhone } = setup();
    presenter.setQuestions([Q1, Q2]);
    presenter.setActiveQuestion("q1");
    await sleep(3_000); // nothing changes; the only copy is in history

    const phone = openPhone();
    const took = await waitFor("phone shows q1", () => phone.store.activeQuestionId.get() === "q1", 5_000);
    origLog(`late joiner: question shown ${took}ms after opening`);
    expect(took, phoneLog()).toBeLessThan(2_000);
    expect(phoneLog()).toContain("current state received: question q1");
  }, 20_000);

  it("a phone that opens on stalled wifi shows the question within a few seconds of the wifi recovering", async () => {
    const { presenter, openPhone } = setup();
    presenter.setQuestions([Q1, Q2]);
    presenter.setActiveQuestion("q1");
    await sleep(1_000);

    // The QR scan happens while the access point drops everything
    proxy.set("stall");
    const phone = openPhone();
    await sleep(20_000);
    expect(phone.store.activeQuestionId.get()).toBeNull();

    proxy.set("pass");
    const took = await waitFor("phone shows q1 after wifi recovers", () => phone.store.activeQuestionId.get() === "q1", 20_000)
      .catch((e) => { throw new Error(`${e.message}\n${phoneLog()}`); });
    origLog(`first connect on stalled wifi: phone showed the question ${took}ms after the wifi came back`);
    expect(took, phoneLog()).toBeLessThan(12_000);
    expect(phoneLog()).toMatch(/abandoning this attempt/);
  }, 60_000);

  it("after 30s of stalled wifi, the phone reconnects and shows the question opened meanwhile within a few seconds", async () => {
    proxy.set("pass");
    const { presenter, openPhone } = setup();
    presenter.setQuestions([Q1, Q2]);
    presenter.setActiveQuestion("q1");
    const phone = openPhone();
    await waitFor("phone shows q1", () => phone.store.activeQuestionId.get() === "q1", 5_000);

    proxy.set("stall");
    await sleep(5_000);
    presenter.setActiveQuestion("q2"); // broadcast while the phone hears nothing
    await sleep(25_000);
    expect(phone.store.activeQuestionId.get()).toBe("q1");
    const attemptsBefore = proxy.attempts;

    proxy.set("pass");
    const took = await waitFor("phone shows q2 after wifi recovers", () => phone.store.activeQuestionId.get() === "q2", 20_000)
      .catch((e) => { throw new Error(`${e.message}\n${phoneLog()}`); });
    // Worst case: an attempt that started into the stall is abandoned after
    // its timeout (6s, then 8s), then the next one
    // waits up to 3s. On real wifi the hanging attempt usually completes on
    // its own once packets flow again; this proxy never lets it.
    origLog(`stalled wifi: phone recovered ${took}ms after the wifi came back`);
    expect(took, phoneLog()).toBeLessThan(12_000);
    expect(phoneLog()).toMatch(/lost \(/);
    expect(phoneLog()).toMatch(/reconnected after/);
    expect(phoneLog()).toContain("current state received: question q2");
    expect(attemptsBefore, "the phone kept trying during the outage").toBeGreaterThan(3);
  }, 60_000);

  it("after connections were refused for 20s, the phone returns to Waiting within a few seconds", async () => {
    proxy.set("pass");
    const { presenter, openPhone } = setup();
    presenter.setQuestions([Q1, Q2]);
    presenter.setActiveQuestion("q1");
    const phone = openPhone();
    await waitFor("phone shows q1", () => phone.store.activeQuestionId.get() === "q1", 5_000);

    proxy.set("refuse");
    await sleep(2_000);
    presenter.clearActiveQuestion();
    await sleep(18_000);
    expect(phone.store.activeQuestionId.get()).toBe("q1");

    proxy.set("pass");
    const took = await waitFor("phone back on Waiting", () => phone.store.activeQuestionId.get() === null, 20_000)
      .catch((e) => { throw new Error(`${e.message}\n${phoneLog()}`); });
    // Browsers fail a refused handshake at once (Chromium recovers in under a
    // second here); Node's WebSocket only errors, so the handshake timeout
    // (6s, then 8s) ends those attempts, plus up to 3s before the next one
    origLog(`refused connections: phone recovered ${took}ms after the network came back`);
    expect(took, phoneLog()).toBeLessThan(12_000);
  }, 60_000);

  it("an answer whose request hangs is retried and counted once, and phones see the total", async () => {
    proxy.set("pass");
    const { presenter, openPhone } = setup();
    presenter.setQuestions([Q1, Q2]);
    presenter.setActiveQuestion("q1");
    const phone = openPhone();
    await waitFor("phone shows q1", () => phone.store.activeQuestionId.get() === "q1", 5_000);

    holdAnswers = 1; // the first request never gets a response
    const started = Date.now();
    expect(await phone.submitAnswer("q1", "B")).toBe(true);
    origLog(`hung answer request: delivered by a retry ${Date.now() - started}ms after the tap`);
    expect(answers).toHaveLength(2);
    expect(answers[1].body.seq).toBe(answers[0].body.seq);

    await waitFor("presenter counts the answer", () => presenter.getQuizState("q1").total === 1, 5_000);
    // The held request goes through after all: the same answer, counted once
    await answers[0].release();
    await waitFor("phone shows the total", () => phone.getQuizState("q1").total === 1, 5_000);
    await sleep(500);
    expect(presenter.getQuizState("q1")).toEqual({ votes: { B: 1 }, total: 1 });
    expect(phone.getQuizState("q1")).toEqual({ votes: {}, total: 1 });
  }, 30_000);

  it("an older answer that reaches the presenter after a newer one is ignored", async () => {
    proxy.set("pass");
    const { presenter, openPhone } = setup();
    presenter.setQuestions([Q1, Q2]);
    presenter.setActiveQuestion("q1");
    const phone = openPhone();
    await waitFor("phone shows q1", () => phone.store.activeQuestionId.get() === "q1", 5_000);

    holdAnswers = 1;
    const first = phone.submitAnswer("q1", "A");
    await waitFor("first request arrives", () => answers.length === 1, 5_000);
    expect(await phone.submitAnswer("q1", "B")).toBe(true);
    await waitFor("presenter counts B", () => presenter.getQuizState("q1").votes.B === 1, 5_000);

    await answers[0].release(); // A reaches AnyCable last
    expect(await first).toBe(true);
    await sleep(1_000);
    expect(presenter.getQuizState("q1")).toEqual({ votes: { B: 1 }, total: 1 });
    expect(phone.getVotedAnswer("q1")).toBe("B");
  }, 30_000);
});
