import { contextBridge, ipcRenderer } from 'electron';

ipcRenderer.send('cftp:preload-ready');

contextBridge.exposeInMainWorld('cftp', {
  connect: (params: {
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKeyPath?: string;
    privateKeyPassphrase?: string;
    useAgent?: boolean;
    agentSockPath?: string;
  }) => ipcRenderer.invoke('cftp:connect', params),

  disconnect: () => ipcRenderer.invoke('cftp:disconnect'),

  startTunnel: (params: { localPort: number; remoteHost: string; remotePort: number }) =>
    ipcRenderer.invoke('cftp:startTunnel', params),

  stopTunnel: () => ipcRenderer.invoke('cftp:stopTunnel'),

  listRemote: (dir: string) => ipcRenderer.invoke('cftp:listRemote', dir),

  uploadFiles: (params: { localPaths: string[]; remoteDir: string }) => ipcRenderer.invoke('cftp:uploadFiles', params),

  prepareDragOut: (remotePath: string) => ipcRenderer.invoke('cftp:prepareDragOut', remotePath),
  startDragLocal: (localPath: string) => ipcRenderer.send('cftp:startDragLocal', localPath),

  downloadFile: (remotePath: string) => ipcRenderer.invoke('cftp:downloadFile', remotePath),

  choosePrivateKeyFile: () => ipcRenderer.invoke('cftp:choosePrivateKeyFile'),

  chooseLocalFiles: () => ipcRenderer.invoke('cftp:chooseLocalFiles'),

  onLog: (cb: (line: string) => void) => {
    const listener = (_: unknown, line: string) => cb(line);
    ipcRenderer.on('cftp:log', listener);
    return () => ipcRenderer.removeListener('cftp:log', listener);
  }
});


