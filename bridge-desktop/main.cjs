const { app, BrowserWindow, Menu, Tray, nativeImage, safeStorage, ipcMain, dialog } = require("electron");
const { fork, execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let windowRef;
let tray;
let agent;
let agentLogPath = "";
let agentStartError = "";
let operatorConfig = {};
const bridgeUrl = "http://127.0.0.1:8787";
const defaultIngestUrl = "https://timbangqr-harapan-jaya.vercel.app/api/serial/ingest";
const defaultDeviceId = "TIMBANG-HJ-SERIAL-01";
const defaultSerialApiKey = "serial-local-key-ganti-sebelum-produksi";
const defaultBridgeAdminKey = "bridge-admin-key-ganti-sebelum-produksi";

function normalizeIngestUrl(raw) {
  let url = String(raw || "").trim();
  const mdMatch = url.match(/\[([^\]]+)\]\(([^)]+)\)/);
  if (mdMatch) {
    url = mdMatch[2].trim();
  } else {
    url = url.replace(/^[<[(]+|[>\])]+$/g, "").trim();
  }
  url = url.replace(/\/+$/, "");
  if (!url) return "";
  if (url.startsWith("http://") && url.includes(".vercel.app")) {
    url = "https://" + url.slice(7);
  }
  if (!url.endsWith("/api/serial/ingest")) {
    url += "/api/serial/ingest";
  }
  return url;
}

function configPath() { return path.join(app.getPath("userData"), "operator-settings.json"); }
function loadConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    const decrypt = (val) => {
      if (!val) return "";
      try {
        if (safeStorage && safeStorage.isEncryptionAvailable()) {
          return safeStorage.decryptString(Buffer.from(val, "base64"));
        }
      } catch {}
      return "";
    };
    return {
      ingestUrl: defaultIngestUrl,
      deviceId: defaultDeviceId,
      serialApiKey: defaultSerialApiKey,
      bridgeAdminKey: defaultBridgeAdminKey,
      ...saved,
      serialApiKey: decrypt(saved.serialApiKey) || defaultSerialApiKey,
      bridgeAdminKey: decrypt(saved.bridgeAdminKey) || defaultBridgeAdminKey,
    };
  } catch {
    return {
      ingestUrl: defaultIngestUrl,
      deviceId: defaultDeviceId,
      serialApiKey: defaultSerialApiKey,
      bridgeAdminKey: defaultBridgeAdminKey,
    };
  }
}
function saveConfig(next) {
  const definedValues = Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined));
  if (definedValues.ingestUrl) {
    definedValues.ingestUrl = normalizeIngestUrl(definedValues.ingestUrl);
  }
  operatorConfig = { ...operatorConfig, ...definedValues };
  const stored = { ...operatorConfig };
  for (const key of ["serialApiKey", "bridgeAdminKey"]) {
    if (stored[key]) {
      try {
        if (safeStorage && safeStorage.isEncryptionAvailable()) {
          stored[key] = safeStorage.encryptString(stored[key]).toString("base64");
        }
      } catch {}
    }
  }
  fs.writeFileSync(configPath(), JSON.stringify(stored, null, 2));
}
function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(bridgeUrl + pathname);
      const method = options.method || "GET";
      const bodyData = options.body ? (typeof options.body === "string" ? options.body : JSON.stringify(options.body)) : null;
      const headers = {
        "x-bridge-key": operatorConfig.bridgeAdminKey || defaultBridgeAdminKey,
        ...(options.headers || {}),
      };
      if (bodyData && !headers["content-length"] && !headers["Content-Length"]) {
        headers["content-length"] = Buffer.byteLength(bodyData);
      }

      const reqTimeout = Number(options.timeout || 10000);
      const req = http.request(url, {
        method,
        headers,
        timeout: reqTimeout,
      }, (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => {
          let body = {};
          try {
            body = raw ? JSON.parse(raw) : {};
          } catch {
            body = { raw };
          }
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body);
          } else {
            reject(new Error(body.error || `Bridge tidak merespons (HTTP ${res.statusCode}).`));
          }
        });
      });

      req.on("timeout", () => {
        req.destroy(new Error(`Timeout koneksi ke Bridge agent (${Math.round(reqTimeout / 1000)} detik).`));
      });

      req.on("error", (err) => {
        reject(err);
      });

      if (bodyData) {
        req.write(bodyData);
      }
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}
async function stopAgent() {
  const current = agent;
  agent = undefined;
  if (!current || current.exitCode !== null) return;
  await new Promise((resolve) => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      resolve();
    };
    current.once("exit", done);
    try { current.kill(); } catch { done(); }
    setTimeout(() => {
      if (!finished) {
        try { current.kill("SIGKILL"); } catch {}
        done();
      }
    }, 2000).unref();
  });
}
function killOrphanOnPort(port = 8787) {
  try {
    if (process.platform === "win32") {
      const output = execSync(`netstat -ano -p tcp | findstr :${port} | findstr LISTENING`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      for (const line of output.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== "0" && Number(pid) !== process.pid) {
          try {
            execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
          } catch {}
        }
      }
    }
  } catch {}
}

async function startAgent() {
  await stopAgent();
  killOrphanOnPort(8787);
  agentStartError = "";
  const dataDir = path.join(app.getPath("userData"), "agent-data");
  fs.mkdirSync(dataDir, { recursive: true });
  agentLogPath = path.join(dataDir, "bridge-agent.log");
  const agentScript = path.join(app.getAppPath(), "serial-agent", "server.mjs");
  const logFile = fs.openSync(agentLogPath, "a");
  try {
    agent = fork(agentScript, [], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        SERIAL_AGENT_DATA_DIR: dataDir,
        SERIAL_BRIDGE_HOST: "127.0.0.1",
        SERIAL_BRIDGE_PORT: "8787",
        SERIAL_INGEST_URL: normalizeIngestUrl(operatorConfig.ingestUrl || defaultIngestUrl),
        SERIAL_API_KEY: operatorConfig.serialApiKey || defaultSerialApiKey,
        SERIAL_DEVICE_ID: operatorConfig.deviceId || defaultDeviceId,
        SERIAL_BRIDGE_ADMIN_KEY: operatorConfig.bridgeAdminKey || defaultBridgeAdminKey,
        SERIAL_AUTO_CONNECT: "true",
      },
      stdio: ["ignore", logFile, logFile, "ipc"],
    });
    const child = agent;
    child.on("error", (error) => { agentStartError = error.message; });
    child.on("exit", (code, signal) => {
      if (agent === child) {
        agentStartError = `Serial Agent berhenti (code=${code}, signal=${signal}).`;
        agent = undefined;
      }
    });
    child.unref();
  } catch (error) {
    agentStartError = error instanceof Error ? error.message : "Serial Agent gagal dimulai.";
    agent = undefined;
  } finally {
    fs.closeSync(logFile);
  }
}
async function waitForAgentReady(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await request("/health");
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return false;
}
async function status() {
  try {
    return await request("/health");
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      agent: {
        pid: agent?.pid || null,
        exitCode: agent?.exitCode ?? null,
        startError: agentStartError || null,
        logPath: agentLogPath || null,
      },
    };
  }
}
function showWindow() {
  if (!windowRef) {
    windowRef = new BrowserWindow({
      width: 760, height: 650, show: false,
      webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
    });
    windowRef.loadFile(path.join(__dirname, "index.html"));
    windowRef.on("close", (event) => { if (!app.isQuiting) { event.preventDefault(); windowRef.hide(); } });
  }
  windowRef.show(); windowRef.focus();
}
function setupTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("TimbangQR Bridge");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Buka TimbangQR Bridge", click: showWindow },
    { label: "Status", click: async () => dialog.showMessageBox({ message: JSON.stringify(await status(), null, 2) }) },
    { type: "separator" },
    { label: "Keluar", click: () => { app.isQuiting = true; app.quit(); } },
  ]));
}
app.whenReady().then(async () => {
  if (!safeStorage.isEncryptionAvailable()) dialog.showErrorBox("Keamanan Windows", "Windows encryption tidak tersedia. Bridge tidak dapat menyimpan credential operator.");
  operatorConfig = loadConfig();
  app.setLoginItemSettings({ openAtLogin: true });
  await startAgent();
  await waitForAgentReady();
  setupTray();
  showWindow();
});
app.on("second-instance", () => {
  if (windowRef) {
    if (windowRef.isMinimized()) windowRef.restore();
    windowRef.show();
    windowRef.focus();
  }
});
app.on("window-all-closed", (event) => event.preventDefault());
app.on("before-quit", () => { app.isQuiting = true; agent?.kill(); });

ipcMain.handle("bridge:get-config", () => ({
  ingestUrl: operatorConfig.ingestUrl || defaultIngestUrl,
  deviceId: operatorConfig.deviceId || defaultDeviceId,
  serialApiKey: operatorConfig.serialApiKey || defaultSerialApiKey,
  hasSerialApiKey: Boolean(operatorConfig.serialApiKey || defaultSerialApiKey),
  hasBridgeAdminKey: Boolean(operatorConfig.bridgeAdminKey || defaultBridgeAdminKey),
}));
ipcMain.handle("bridge:save-config", async (_event, values) => {
  saveConfig(values);
  await startAgent();
  await waitForAgentReady();
  return status();
});
ipcMain.handle("bridge:status", status);
ipcMain.handle("bridge:ports", async () => (await request("/ports")).ports || []);
ipcMain.handle("bridge:connect", async (_event, serial) => {
  await request("/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...serial, autoConnect: true }) });
  return request("/connect", { method: "POST" });
});
ipcMain.handle("bridge:disconnect", () => request("/disconnect", { method: "POST" }));
ipcMain.handle("bridge:clear-queue", async () => {
  return request("/queue/clear", { method: "POST" });
});
ipcMain.handle("bridge:test-ingest", async () => {
  return request("/test-ingest", { method: "POST", timeout: 12000 });
});
