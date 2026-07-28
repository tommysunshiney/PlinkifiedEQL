"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  selectLogFile: () => electron.ipcRenderer.invoke("dialog:openLogFile"),
  readLogFile: (filePath) => electron.ipcRenderer.invoke("log:read", filePath)
});
