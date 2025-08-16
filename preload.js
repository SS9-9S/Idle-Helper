const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (obj) => ipcRenderer.invoke('settings:set', obj),
  start: () => ipcRenderer.invoke('control:start'),
  stop: () => ipcRenderer.invoke('control:stop'),
  getStatus: () => ipcRenderer.invoke('status:get'),
  onStatus: (cb) => ipcRenderer.on('status', (_e, data) => cb(data))
});
