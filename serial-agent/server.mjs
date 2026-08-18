import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SerialPort } from "serialport";

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const agentDirectory = fileURLToPath(new URL(".", import.meta.url));
loadDotEnv(path.join(agentDirectory, ".env"));
loadDotEnv(path.join(process.cwd(), ".env"));

const dataDirectory = process.env.SERIAL_AGENT_DATA_DIR || path.join(agentDirectory, "data");
const configPath = path.join(dataDirectory, "serial-bridge-config.json");
const queuePath = path.join(dataDirectory, "serial-bridge-queue.json");
fs.mkdirSync(dataDirectory, { recursive: true });

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

const decodeEscapes = (value) => String(value ?? "").replace(/\\r/g, "\r").replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\0/g, "\0");

const defaultConfig = {
  path: process.env.SERIAL_PORT || "",
  interfaceType: process.env.SERIAL_INTERFACE || "RS232",
  baudRate: toNumber(process.env.SERIAL_BAUD_RATE, 9600),
  dataBits: toNumber(process.env.SERIAL_DATA_BITS, 8),
  stopBits: toNumber(process.env.SERIAL_STOP_BITS, 1),
  parity: process.env.SERIAL_PARITY || "none",
  frameMode: process.env.SERIAL_FRAME_MODE || "line",
  delimiter: process.env.SERIAL_DELIMITER || "\\r\\n",
  idleTimeoutMs: toNumber(process.env.SERIAL_IDLE_TIMEOUT_MS, 120),
  weightRegex: process.env.SERIAL_WEIGHT_REGEX || "[-+]?\\d+(?:[.,]\\d+)?",
  weightMultiplier: toNumber(process.env.SERIAL_WEIGHT_MULTIPLIER, 1),
  stableRegex: process.env.SERIAL_STABLE_REGEX || "\\b(ST|STAB|STABLE)\\b",
  unstableRegex: process.env.SERIAL_UNSTABLE_REGEX || "\\b(US|UNST|UNSTABLE)\\b",
  stableSamples: toNumber(process.env.SERIAL_STABLE_SAMPLES, 3),
  stableToleranceKg: toNumber(process.env.SERIAL_STABLE_TOLERANCE_KG, 1),
  autoConnect: toBoolean(process.env.SERIAL_AUTO_CONNECT, false),
};

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

let config = { ...defaultConfig, ...readJson(configPath, {}) };
let queue = readJson(queuePath, []);
if (!Array.isArray(queue)) queue = [];

const bridgeHost = process.env.SERIAL_BRIDGE_HOST || "127.0.0.1";
const bridgePort = toNumber(process.env.SERIAL_BRIDGE_PORT, 8787);
const bridgeAdminKey = process.env.SERIAL_BRIDGE_ADMIN_KEY || "bridge-admin-key-ganti-sebelum-produksi";
const ingestUrl = process.env.SERIAL_INGEST_URL || "http://127.0.0.1:3000/api/serial/ingest";
const ingestKey = process.env.SERIAL_API_KEY || "serial-local-key-ganti-sebelum-produksi";
const deviceId = process.env.SERIAL_DEVICE_ID || "TIMBANG-HJ-SERIAL-01";

let serialPort = null;
let connected = false;
let connecting = false;
let shuttingDown = false;
let inputBuffer = "";
let idleTimer = null;
let reconnectTimer = null;
let latest = null;
let lastError = "";
let lastConnectedAt = null;
let lastDisconnectedAt = null;
let recentWeights = [];
let lastForwarded = null;
let lastForwardedAt = 0;
let flushing = false;
const startedAt = new Date().toISOString();

function persistConfig() {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function persistQueue() {
  const temporaryPath = `${queuePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(queue, null, 2));
  fs.renameSync(temporaryPath, queuePath);
}

function safeRegex(pattern) {
  if (!pattern) return null;
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

function parseWeight(raw) {
  const regex = safeRegex(config.weightRegex);
  if (!regex) throw new Error("Weight regex tidak valid.");
  const match = raw.match(regex);
  if (!match) return null;
  const candidate = match[1] ?? match[0];
  const normalized = String(candidate).replace(",", ".").replace(/[^0-9+\-.]/g, "");
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) return null;
  const weightKg = Math.round(numeric * Number(config.weightMultiplier || 1));
  return weightKg >= 0 ? weightKg : null;
}

function calculateStability(raw, weightKg) {
  const stableRegex = safeRegex(config.stableRegex);
  const unstableRegex = safeRegex(config.unstableRegex);
  if (unstableRegex?.test(raw)) {
    recentWeights = [];
    return false;
  }
  if (stableRegex?.test(raw)) {
    recentWeights = [weightKg];
    return true;
  }

  const maxSamples = Math.max(2, Math.min(20, Number(config.stableSamples || 3)));
  recentWeights.push(weightKg);
  if (recentWeights.length > maxSamples) recentWeights.shift();
  if (recentWeights.length < maxSamples) return false;
  const tolerance = Math.max(0, Number(config.stableToleranceKg || 0));
  return Math.max(...recentWeights) - Math.min(...recentWeights) <= tolerance;
}

function parseFrame(rawInput) {
  const raw = String(rawInput || "").replace(/\0/g, "").trim();
  if (!raw) return { ok: false, error: "Frame kosong." };
  try {
    const weightKg = parseWeight(raw);
    if (weightKg == null) return { ok: false, error: "Nilai berat tidak ditemukan oleh regex.", raw };
    const stable = calculateStability(raw, weightKg);
    return { ok: true, weightKg, stable, raw };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Parser gagal.", raw };
  }
}

class DeliveryError extends Error {
  constructor(message, retryable) {
    super(message);
    this.name = "DeliveryError";
    this.retryable = retryable;
  }
}

async function sendReading(payload) {
  const response = await fetch(ingestUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-serial-key": ingestKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    const text = await response.text();
    const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
    throw new DeliveryError(`Server aplikasi ${response.status}: ${text.slice(0, 180)}`, retryable);
  }
  console.log(`[Serial Bridge] Ingest berhasil: ${payload.weight_kg} kg | ${payload.stable ? "STABIL" : "TIDAK STABIL"}.`);
}

function enqueue(payload) {
  queue.push(payload);
  if (queue.length > 5000) queue = queue.slice(queue.length - 5000);
  persistQueue();
}

async function flushQueue() {
  if (flushing || queue.length === 0) return;
  flushing = true;
  try {
    while (queue.length > 0) {
      await sendReading(queue[0]);
      queue.shift();
      persistQueue();
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : "Gagal mengirim buffer.";
    if (error instanceof DeliveryError && !error.retryable && queue.length > 0) {
      queue.shift();
      persistQueue();
    }
  } finally {
    flushing = false;
  }
}

async function handleFrame(frame) {
  const parsed = parseFrame(frame);
  if (!parsed.ok) {
    latest = {
      raw: parsed.raw || String(frame),
      parseError: parsed.error,
      receivedAt: new Date().toISOString(),
    };
    return parsed;
  }

  const payload = {
    device_id: deviceId,
    weight_kg: parsed.weightKg,
    stable: parsed.stable,
    indicator_raw: parsed.raw,
    timestamp: new Date().toISOString(),
    serial_port: config.path,
    interface_type: config.interfaceType,
  };

  latest = {
    ...payload,
    receivedAt: payload.timestamp,
    parseError: null,
  };

  const nowMs = Date.now();
  const unchanged = lastForwarded
    && lastForwarded.weight_kg === payload.weight_kg
    && lastForwarded.stable === payload.stable
    && lastForwarded.indicator_raw === payload.indicator_raw;
  const minimumInterval = unchanged ? 30_000 : 250;
  if (nowMs - lastForwardedAt < minimumInterval) {
    return { ok: true, skippedDuplicate: true, ...payload };
  }
  lastForwarded = payload;
  lastForwardedAt = nowMs;

  try {
    await sendReading(payload);
    await flushQueue();
  } catch (error) {
    lastError = error instanceof Error ? error.message : "Gagal mengirim pembacaan.";
    if (!(error instanceof DeliveryError) || error.retryable) enqueue(payload);
  }
  return { ok: true, ...payload };
}

function consumeChunk(chunk) {
  const received = chunk.toString("utf8");
  console.log(`[Serial Bridge] RX: ${JSON.stringify(received)}`);

  // Be tolerant during integration testing: a real indicator sends CR/LF bytes,
  // while some simulators may send the visible characters "\\r\\n" instead.
  inputBuffer += decodeEscapes(received);
  if (inputBuffer.length > 64_000) inputBuffer = inputBuffer.slice(-16_000);

  if (config.frameMode === "idle") {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      const frame = inputBuffer;
      inputBuffer = "";
      void processFrame(frame);
    }, Math.max(30, Number(config.idleTimeoutMs || 120)));
    return;
  }

  const delimiter = decodeEscapes(config.delimiter || "\\r\\n");
  if (!delimiter) return;
  let position;
  while ((position = inputBuffer.indexOf(delimiter)) >= 0) {
    const frame = inputBuffer.slice(0, position);
    inputBuffer = inputBuffer.slice(position + delimiter.length);
    if (frame.trim()) void processFrame(frame);
  }
}

async function processFrame(frame) {
  console.log(`[Serial Bridge] Frame: ${JSON.stringify(frame)}`);
  try {
    const result = await handleFrame(frame);
    if (!result.ok) {
      console.warn(`[Serial Bridge] Frame ditolak: ${result.error}`);
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : "Gagal memproses frame.";
    console.error(`[Serial Bridge] ${lastError}`);
  }
}

function scheduleReconnect() {
  if (shuttingDown || !config.autoConnect || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (config.autoConnect) void connectSerial();
  }, 3000);
}

async function disconnectSerial({ keepAutoConnect = false } = {}) {
  if (!keepAutoConnect) {
    config.autoConnect = false;
    persistConfig();
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  inputBuffer = "";
  const current = serialPort;
  serialPort = null;
  connected = false;
  connecting = false;
  lastDisconnectedAt = new Date().toISOString();
  if (current?.isOpen) {
    await new Promise((resolve) => current.close(() => resolve()));
  }
}

async function connectSerial() {
  if (connected || connecting || shuttingDown) return;
  if (!config.path) {
    lastError = "Port serial belum dipilih.";
    return;
  }

  connecting = true;
  lastError = "";
  const candidate = new SerialPort({
    path: config.path,
    baudRate: Number(config.baudRate),
    dataBits: Number(config.dataBits),
    stopBits: Number(config.stopBits),
    parity: config.parity,
    autoOpen: false,
  });
  serialPort = candidate;

  candidate.on("data", consumeChunk);
  candidate.on("error", (error) => {
    lastError = error.message;
  });
  candidate.on("close", () => {
    if (serialPort === candidate) serialPort = null;
    connected = false;
    connecting = false;
    lastDisconnectedAt = new Date().toISOString();
    scheduleReconnect();
  });

  await new Promise((resolve) => {
    candidate.open((error) => {
      connecting = false;
      if (error) {
        lastError = error.message;
        if (serialPort === candidate) serialPort = null;
        scheduleReconnect();
        resolve();
        return;
      }
      connected = true;
      lastConnectedAt = new Date().toISOString();
      console.log(`[Serial Bridge] Terhubung ke ${config.path} @ ${config.baudRate} baud.`);
      resolve();
    });
  });
}

function publicConfig() {
  return { ...config };
}

function statusPayload() {
  return {
    ok: true,
    bridge: {
      host: bridgeHost,
      port: bridgePort,
      startedAt,
      connected,
      connecting,
      lastConnectedAt,
      lastDisconnectedAt,
      lastError,
      queueLength: queue.length,
    },
    config: publicConfig(),
    latest,
  };
}

function authorized(request) {
  return request.headers["x-bridge-key"] === bridgeAdminKey;
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("Payload terlalu besar.");
  }
  return body ? JSON.parse(body) : {};
}

const server = http.createServer(async (request, response) => {
  try {
    if (!authorized(request)) return sendJson(response, 401, { error: "Bridge key tidak valid." });
    const url = new URL(request.url || "/", `http://${bridgeHost}:${bridgePort}`);

    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, statusPayload());
    }
    if (request.method === "GET" && url.pathname === "/ports") {
      const ports = await SerialPort.list();
      return sendJson(response, 200, { ports });
    }
    if (request.method === "GET" && url.pathname === "/config") {
      return sendJson(response, 200, { config: publicConfig() });
    }
    if (request.method === "POST" && url.pathname === "/config") {
      const body = await readBody(request);
      const allowed = [
        "path", "interfaceType", "baudRate", "dataBits", "stopBits", "parity", "frameMode",
        "delimiter", "idleTimeoutMs", "weightRegex", "weightMultiplier", "stableRegex",
        "unstableRegex", "stableSamples", "stableToleranceKg", "autoConnect",
      ];
      const next = { ...config };
      for (const key of allowed) {
        if (body[key] !== undefined) next[key] = body[key];
      }
      next.baudRate = Math.max(50, Number(next.baudRate || 9600));
      next.dataBits = [5, 6, 7, 8].includes(Number(next.dataBits)) ? Number(next.dataBits) : 8;
      next.stopBits = [1, 1.5, 2].includes(Number(next.stopBits)) ? Number(next.stopBits) : 1;
      next.parity = ["none", "even", "odd", "mark", "space"].includes(next.parity) ? next.parity : "none";
      next.frameMode = ["line", "idle"].includes(next.frameMode) ? next.frameMode : "line";
      next.interfaceType = ["RS232", "RS485"].includes(next.interfaceType) ? next.interfaceType : "RS232";
      next.stableSamples = Math.max(2, Math.min(20, Number(next.stableSamples || 3)));
      next.stableToleranceKg = Math.max(0, Number(next.stableToleranceKg || 0));
      next.idleTimeoutMs = Math.max(30, Number(next.idleTimeoutMs || 120));
      next.weightMultiplier = Number(next.weightMultiplier || 1);
      if (!safeRegex(next.weightRegex)) throw new Error("Weight regex tidak valid.");
      if (next.stableRegex && !safeRegex(next.stableRegex)) throw new Error("Stable regex tidak valid.");
      if (next.unstableRegex && !safeRegex(next.unstableRegex)) throw new Error("Unstable regex tidak valid.");

      await disconnectSerial({ keepAutoConnect: true });
      config = next;
      persistConfig();
      if (config.autoConnect) await connectSerial();
      return sendJson(response, 200, statusPayload());
    }
    if (request.method === "POST" && url.pathname === "/connect") {
      config.autoConnect = true;
      persistConfig();
      await connectSerial();
      return sendJson(response, connected ? 200 : 409, statusPayload());
    }
    if (request.method === "POST" && url.pathname === "/disconnect") {
      await disconnectSerial({ keepAutoConnect: false });
      return sendJson(response, 200, statusPayload());
    }
    if (request.method === "POST" && url.pathname === "/test-input") {
      const body = await readBody(request);
      const parsed = parseFrame(String(body.raw || ""));
      return sendJson(response, parsed.ok ? 200 : 422, { result: parsed, status: statusPayload() });
    }

    return sendJson(response, 404, { error: "Endpoint bridge tidak ditemukan." });
  } catch (error) {
    lastError = error instanceof Error ? error.message : "Bridge error.";
    return sendJson(response, 500, { error: lastError });
  }
});

server.listen(bridgePort, bridgeHost, () => {
  console.log(`[Serial Bridge] API lokal aktif di http://${bridgeHost}:${bridgePort}`);
  console.log(`[Serial Bridge] Tujuan pembacaan: ${ingestUrl}`);
  if (config.autoConnect) void connectSerial();
});

setInterval(() => void flushQueue(), 2000).unref();

async function shutdown() {
  shuttingDown = true;
  await disconnectSerial({ keepAutoConnect: true });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
