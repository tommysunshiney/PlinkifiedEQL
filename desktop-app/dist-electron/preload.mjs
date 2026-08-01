"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
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
