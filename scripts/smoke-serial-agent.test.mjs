import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const agentScript = fileURLToPath(new URL("../serial-agent/server.mjs", import.meta.url));
const bridgeKey = "smoke-bridge-key";
const serialKey = "smoke-serial-key";
const readings = [1250, 1500].map((weight, index) => ({
  device_id: "SMOKE-DEVICE",
  weight_kg: weight,
  stable: true,
  indicator_raw: `ST ${weight} kg`,
  timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
  serial_port: "SMOKE-NO-HARDWARE",
  interface_type: "RS232",
}));

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function eventually(check, description) {
  const deadline = Date.now() + 12_000;
  let lastError;
  while (Date.now() < deadline) {
    try { return await check(); } catch (error) { lastError = error; }
    await delay(50);
  }
  throw new Error(`Timed out: ${description}`, { cause: lastError });
}

async function fixture(t, { queue = [], status = 200 } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "timbangqr-smoke-"));
  const queuePath = path.join(directory, "serial-bridge-queue.json");
  await fs.writeFile(queuePath, JSON.stringify(queue));
  const calls = [];
  let responseStatus = status;
  const ingest = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    calls.push({ url: req.url, key: req.headers["x-serial-key"], body: JSON.parse(raw), status: responseStatus });
    res.writeHead(responseStatus, { "content-type": "application/json" });
    res.end(JSON.stringify(responseStatus === 200 ? { ok: true } : { error: "Simulated ingest failure" }));
  });
  const ingestPort = await listen(ingest);
  let child;
  let logs = "";
  let base;
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, "exit");
    child.kill();
    const force = setTimeout(() => child.kill("SIGKILL"), 3000);
    try { await exited; } finally { clearTimeout(force); }
  }
  t.after(async () => {
    await stop();
    await new Promise((resolve) => ingest.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  async function request(endpoint, { body, key = bridgeKey } = {}) {
    const response = await fetch(base + endpoint, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", "x-bridge-key": key },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    return { status: response.status, body: await response.json() };
  }
  async function start() {
    const reservation = http.createServer();
    const port = await listen(reservation);
    await new Promise((resolve) => reservation.close(resolve));
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [agentScript], {
      cwd: directory,
      env: {
        ...process.env,
        SERIAL_AGENT_DATA_DIR: directory,
        SERIAL_BRIDGE_HOST: "127.0.0.1",
        SERIAL_BRIDGE_PORT: String(port),
        SERIAL_BRIDGE_ADMIN_KEY: bridgeKey,
        SERIAL_INGEST_URL: `http://127.0.0.1:${ingestPort}/api/serial/ingest`,
        SERIAL_API_KEY: serialKey,
        SERIAL_DEVICE_ID: "SMOKE-DEVICE",
        SERIAL_AUTO_CONNECT: "false",
        SERIAL_PORT: "SMOKE-NO-HARDWARE",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (data) => { logs += data; });
    child.stderr.on("data", (data) => { logs += data; });
    child.on("error", (error) => { logs += error.message; });
    try {
      await eventually(async () => {
        assert.equal(child.exitCode, null, logs);
        const health = await request("/health");
        assert.equal(health.status, 200);
        assert.equal(health.body.ok, true);
      }, "Serial Agent startup");
    } catch (error) { throw new Error(`${error.message}\n${logs}`, { cause: error }); }
  }
  await start();
  return {
    request, calls, stop, start,
    setStatus(value) { responseStatus = value; },
    async queue() { return JSON.parse(await fs.readFile(queuePath, "utf8")); },
  };
}

test("bridge authenticates requests and parses stable, unstable and invalid frames", async (t) => {
  const agent = await fixture(t);
  assert.equal((await agent.request("/health", { key: "wrong-key" })).status, 401);
  const health = (await agent.request("/health")).body;
  assert.equal(health.bridge.connected, false);
  assert.equal(health.bridge.deviceId, "SMOKE-DEVICE");
  const ports = await agent.request("/ports");
  assert.equal(ports.status, 200);
  assert.ok(Array.isArray(ports.body.ports), "Native serial binding must enumerate ports without hardware");
  for (const [raw, weight, stable] of [["ST 1250 kg", 1250, true], ["US 1251 kg", 1251, false], ["ST 12,5 kg", 13, true]]) {
    const parsed = await agent.request("/test-input", { body: { raw } });
    assert.equal(parsed.status, 200);
    assert.equal(parsed.body.result.weightKg, weight);
    assert.equal(parsed.body.result.stable, stable);
  }
  assert.equal((await agent.request("/test-input", { body: { raw: "no weight" } })).status, 422);
  const config = await agent.request("/config", { body: { autoConnect: false, weightMultiplier: 10 } });
  assert.equal(config.status, 200);
  assert.equal(config.body.config.weightMultiplier, 10);
  assert.equal(agent.calls.length, 0, "Parser diagnostics must not send physical readings");
});

test("test-ingest sends authenticated dry_run without changing latest readings or queue", async (t) => {
  const agent = await fixture(t);
  const result = await agent.request("/test-ingest", { body: {} });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(agent.calls.length, 1);
  assert.equal(agent.calls[0].url, "/api/serial/ingest");
  assert.equal(agent.calls[0].key, serialKey);
  assert.equal(agent.calls[0].body.dry_run, true);
  assert.equal(agent.calls[0].body.indicator_raw, "PING_TEST");
  assert.equal((await agent.request("/health")).body.latest, null);
  assert.deepEqual(await agent.queue(), []);
});

test("failed test-ingest reports HTTP 401 without queuing a synthetic reading", async (t) => {
  const agent = await fixture(t, { status: 401 });
  const result = await agent.request("/test-ingest", { body: {} });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.status, 401);
  assert.match(result.body.error, /401/);
  assert.deepEqual(await agent.queue(), []);
  assert.equal((await agent.request("/health")).body.latest, null);
});

test("offline queue survives HTTP 401 and agent restart, then drains in order after recovery", async (t) => {
  const agent = await fixture(t, { queue: readings, status: 401 });
  await eventually(async () => assert.ok(agent.calls.length >= 1), "first queued delivery");
  assert.deepEqual(await agent.queue(), readings);
  assert.equal((await agent.request("/health")).body.bridge.queueLength, 2);
  await agent.stop();
  await agent.start();
  assert.deepEqual(await agent.queue(), readings);
  agent.setStatus(200);
  await eventually(async () => assert.deepEqual(await agent.queue(), []), "queue recovery");
  assert.deepEqual(agent.calls.filter((call) => call.status === 200).map((call) => call.body), readings);
  assert.equal((await agent.request("/health")).body.bridge.queueLength, 0);
});

test("offline queue retries HTTP 503 without losing readings", async (t) => {
  const agent = await fixture(t, { queue: readings, status: 503 });
  await eventually(async () => assert.ok(agent.calls.length >= 1), "server failure");
  assert.deepEqual(await agent.queue(), readings);
  agent.setStatus(200);
  await eventually(async () => assert.deepEqual(await agent.queue(), []), "retry after HTTP 503");
  assert.deepEqual(agent.calls.filter((call) => call.status === 200).map((call) => call.body), readings);
});

test("explicit queue clear removes retained readings across agent restart", async (t) => {
  const agent = await fixture(t, { queue: readings, status: 401 });
  assert.equal((await agent.request("/health")).body.bridge.queueLength, 2);
  const cleared = await agent.request("/queue/clear", { body: {} });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.queueLength, 0);
  assert.deepEqual(await agent.queue(), []);
  await agent.stop();
  await agent.start();
  assert.equal((await agent.request("/health")).body.bridge.queueLength, 0);
});
