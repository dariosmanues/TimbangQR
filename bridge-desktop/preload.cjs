const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("bridge", {
  getConfig: () => ipcRenderer.invoke("bridge:get-config"),
  saveConfig: (value) => ipcRenderer.invoke("bridge:save-config", value),
  status: () => ipcRenderer.invoke("bridge:status"),
  ports: () => ipcRenderer.invoke("bridge:ports"),
  connect: (serial) => ipcRenderer.invoke("bridge:connect", serial),
  disconnect: () => ipcRenderer.invoke("bridge:disconnect"),
  clearQueue: () => ipcRenderer.invoke("bridge:clear-queue"),
  testIngest: () => ipcRenderer.invoke("bridge:test-ingest"),
});