const { app, BrowserWindow, Menu, Tray, nativeImage, safeStorage, ipcMain, dialog } = require("electron");
const { fork } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

let windowRef;
let tray;
let agent;
let agentLogPath = "";
let agentStartError = "";
let operatorConfig = {};
const bridgeUrl = "http://127.0.0.1:8787";
const defaultIngestUrl = "http://127.0.0.1:3000/api/serial/ingest";
const defaultBridgeAdminKey = "bridge-admin-key-ganti-sebelum-produksi";

function configPath() { return path.join(app.getPath("userData"), "operator-settings.json"); }
function loadConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    return {
      ...saved,
      serialApiKey: saved.serialApiKey ? safeStorage.decryptString(Buffer.from(saved.serialApiKey, "base64")) : "",
      bridgeAdminKey: saved.bridgeAdminKey ? safeStorage.decryptString(Buffer.from(saved.bridgeAdminKey, "base64")) : "",
    };
  } catch { return {}; }
}
function saveConfig(next) {
  const definedValues = Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined));
  operatorConfig = { ...operatorConfig, ...definedValues };
  const stored = { ...operatorConfig };
  for (const key of ["serialApiKey", "bridgeAdminKey"]) {
    if (stored[key]) stored[key] = safeStorage.encryptString(stored[key]).toString("base64");
  }
  fs.writeFileSync(configPath(), JSON.stringify(stored, null, 2));
}
async function request(pathname, options = {}) {
  const response = await fetch(bridgeUrl + pathname, {
    ...options,
    headers: {
      "x-bridge-key": operatorConfig.bridgeAdminKey || defaultBridgeAdminKey,
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Bridge tidak merespons.");
  return body;
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
async function startAgent() {
  await stopAgent();
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
        SERIAL_INGEST_URL: operatorConfig.ingestUrl || defaultIngestUrl,
        SERIAL_API_KEY: operatorConfig.serialApiKey || "",
        SERIAL_DEVICE_ID: operatorConfig.deviceId || "TIMBANG-HJ-SERIAL-01",
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
app.on("window-all-closed", (event) => event.preventDefault());
app.on("before-quit", () => { app.isQuiting = true; agent?.kill(); });

ipcMain.handle("bridge:get-config", () => ({
  ingestUrl: operatorConfig.ingestUrl || defaultIngestUrl,
  deviceId: operatorConfig.deviceId || "TIMBANG-HJ-SERIAL-01",
  hasSerialApiKey: Boolean(operatorConfig.serialApiKey),
  hasBridgeAdminKey: Boolean(operatorConfig.bridgeAdminKey),
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
