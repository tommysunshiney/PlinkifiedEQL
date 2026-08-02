"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  getDatabaseStatus: () => electron.ipcRenderer.invoke("database:status"),
  searchBosses: (query, zone) => electron.ipcRenderer.invoke("bosses:search", query, zone),
  openExternal: (url) => electron.ipcRenderer.invoke("external:open", url),
  selectLogFile: () => electron.ipcRenderer.invoke("dialog:openLogFile"),
  readLogFile: (filePath) => electron.ipcRenderer.invoke("log:read", filePath),
  startLogWatch: (filePath) => electron.ipcRenderer.invoke("log:startWatch", filePath),
  stopLogWatch: () => electron.ipcRenderer.invoke("log:stopWatch"),
  onLogLines: (callback) => {
    electron.ipcRenderer.removeAllListeners("log:newLines");
    electron.ipcRenderer.on("log:newLines", (_event, lines) => {
      callback(lines);
    });
  },
  startNewSession: (filePath) => electron.ipcRenderer.invoke("log:newSession", filePath),
  markOhShit: (filePath) => electron.ipcRenderer.invoke("log:ohShit", filePath)
});
