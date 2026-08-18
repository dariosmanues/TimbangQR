const { app, BrowserWindow, Menu, Tray, nativeImage, safeStorage, ipcMain, dialog } = require("electron");
const { fork } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

let windowRef;
let tray;
let agent;
let operatorConfig = {};
const bridgeUrl = "http://127.0.0.1:8787";

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
  operatorConfig = { ...operatorConfig, ...next };
  const stored = { ...operatorConfig };
  for (const key of ["serialApiKey", "bridgeAdminKey"]) {
    if (stored[key]) stored[key] = safeStorage.encryptString(stored[key]).toString("base64");
  }
  fs.writeFileSync(configPath(), JSON.stringify(stored, null, 2));
}
async function request(pathname, options = {}) {
  const response = await fetch(bridgeUrl + pathname, {
    ...options,
    headers: { "x-bridge-key": operatorConfig.bridgeAdminKey || "", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Bridge tidak merespons.");
  return body;
}
function startAgent() {
  if (agent) agent.kill();
  const dataDir = path.join(app.getPath("userData"), "agent-data");
  fs.mkdirSync(dataDir, { recursive: true });
  agent = fork(path.join(app.getAppPath(), "serial-agent", "server.mjs"), [], {
    env: {
      ...process.env,
      SERIAL_AGENT_DATA_DIR: dataDir,
      SERIAL_BRIDGE_HOST: "127.0.0.1",
      SERIAL_BRIDGE_PORT: "8787",
      SERIAL_INGEST_URL: operatorConfig.ingestUrl || "",
      SERIAL_API_KEY: operatorConfig.serialApiKey || "",
      SERIAL_DEVICE_ID: operatorConfig.deviceId || "TIMBANG-HJ-SERIAL-01",
      SERIAL_BRIDGE_ADMIN_KEY: operatorConfig.bridgeAdminKey || "",
      SERIAL_AUTO_CONNECT: "true",
    },
    stdio: "ignore",
  });
  agent.unref();
}
async function status() {
  try { return await request("/health"); } catch (error) { return { ok: false, error: error.message }; }
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
app.whenReady().then(() => {
  if (!safeStorage.isEncryptionAvailable()) dialog.showErrorBox("Keamanan Windows", "Windows encryption tidak tersedia. Bridge tidak dapat menyimpan credential operator.");
  operatorConfig = loadConfig();
  app.setLoginItemSettings({ openAtLogin: true });
  startAgent();
  setupTray();
  showWindow();
});
app.on("window-all-closed", (event) => event.preventDefault());
app.on("before-quit", () => { app.isQuiting = true; agent?.kill(); });

ipcMain.handle("bridge:get-config", () => ({
  ingestUrl: operatorConfig.ingestUrl || "",
  deviceId: operatorConfig.deviceId || "TIMBANG-HJ-SERIAL-01",
  hasSerialApiKey: Boolean(operatorConfig.serialApiKey),
  hasBridgeAdminKey: Boolean(operatorConfig.bridgeAdminKey),
}));
ipcMain.handle("bridge:save-config", async (_event, values) => {
  saveConfig(values);
  startAgent();
  return { ok: true };
});
ipcMain.handle("bridge:status", status);
ipcMain.handle("bridge:ports", async () => (await request("/ports")).ports || []);
ipcMain.handle("bridge:connect", async (_event, serial) => {
  await request("/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...serial, autoConnect: true }) });
  return request("/connect", { method: "POST" });
});
ipcMain.handle("bridge:disconnect", () => request("/disconnect", { method: "POST" }));
