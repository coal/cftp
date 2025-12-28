import { app, BrowserWindow, dialog, ipcMain, nativeImage } from 'electron';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Client, type ConnectConfig, type ClientChannel, type SFTPWrapper } from 'ssh2';

type ConnectParams = {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
  useAgent?: boolean;
  agentSockPath?: string;
};

type TunnelParams = { localPort: number; remoteHost: string; remotePort: number };

let mainWindow: BrowserWindow | null = null;
let logFilePath: string | null = null;

function log(line: string) {
  try {
    if (!logFilePath && app.isReady()) {
      logFilePath = path.join(app.getPath('userData'), 'cftp.log');
    }
    if (logFilePath) fs.appendFileSync(logFilePath, line + os.EOL);
  } catch {
    // ignore logging failures
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('cftp:log', line);
}

function devServerUrl() {
  // Vite default; keep it simple and deterministic for this utility.
  return 'http://127.0.0.1:5173';
}

async function createMainWindow() {
  // NOTE: This file is compiled to `dist-electron/main/main.js`, while preload is `dist-electron/preload.js`.
  // So we must go up one directory from `__dirname`.
  const preloadPath = path.join(__dirname, '..', 'preload.js');

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    title: 'CFTP',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      // Keep this utility simple and compatible: sandboxed renderers sometimes break preload/IPC in certain environments.
      sandbox: false
    }
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log(`LOAD FAILED (${code}): ${desc} (${url})`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log(`RENDERER GONE: reason=${details.reason} exitCode=${details.exitCode}`);
  });
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    log(`RENDERER CONSOLE [${level}] ${message} (${sourceId}:${line})`);
  });

  if (app.isPackaged) {
    await mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  } else {
    await mainWindow.loadURL(devServerUrl());
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

class Tunnel {
  private server: net.Server | null = null;
  private readonly client: Client;
  private params: TunnelParams | null = null;

  constructor(client: Client) {
    this.client = client;
  }

  isRunning() {
    return !!this.server;
  }

  async start(params: TunnelParams) {
    if (this.server) throw new Error('Tunnel already running');
    this.params = params;

    const server = net.createServer((sock) => {
      const srcAddr = sock.remoteAddress ?? '127.0.0.1';
      const srcPort = sock.remotePort ?? 0;
      this.client.forwardOut(
        srcAddr,
        srcPort,
        params.remoteHost,
        params.remotePort,
        (err: Error | undefined, stream: ClientChannel) => {
        if (err) {
          log(`TUNNEL forwardOut error: ${String(err)}`);
          sock.destroy(err as any);
          return;
        }
        sock.pipe(stream).pipe(sock);
        stream.on('close', () => sock.end());
        stream.on('error', (e: Error) => {
          log(`TUNNEL stream error: ${String(e)}`);
          sock.destroy(e as any);
        });
        }
      );

      sock.on('error', (e) => log(`TUNNEL socket error: ${String(e)}`));
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(params.localPort, '127.0.0.1', () => resolve());
    });

    this.server = server;
    log(`TUNNEL running: 127.0.0.1:${params.localPort} -> ${params.remoteHost}:${params.remotePort}`);
  }

  async stop() {
    const s = this.server;
    this.server = null;
    this.params = null;
    if (!s) return;
    await new Promise<void>((resolve) => s.close(() => resolve()));
    log('TUNNEL stopped');
  }
}

class SshSession {
  private client: Client | null = null;
  private sftp: SFTPWrapper | null = null;
  private tunnel: Tunnel | null = null;

  isConnected() {
    return !!this.client;
  }

  async connect(params: ConnectParams) {
    await this.disconnect();

    const cfg: ConnectConfig = {
      host: params.host,
      port: params.port,
      username: params.username
    };

    if (params.useAgent) {
      const agentFromEnv = process.env.SSH_AUTH_SOCK;
      const defaultWinPipe = process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined;
      const agent = (params.agentSockPath?.trim() || agentFromEnv || defaultWinPipe)?.trim();
      if (!agent) throw new Error('SSH agent requested, but no agent socket/pipe found. Set SSH_AUTH_SOCK or provide an agent path.');
      cfg.agent = agent;
    } else if (params.privateKeyPath) {
      cfg.privateKey = fs.readFileSync(params.privateKeyPath);
      if (params.privateKeyPassphrase) cfg.passphrase = params.privateKeyPassphrase;
    } else if (params.password) {
      cfg.password = params.password;
    } else {
      throw new Error('Provide either password, private key, or enable SSH agent.');
    }

    const client = new Client();
    this.client = client;

    client.on('banner', (msg: string | Buffer) => log(`SSH banner: ${msg.toString().trim()}`));
    client.on('error', (e: Error) => log(`SSH error: ${String(e)}`));
    client.on('end', () => log('SSH end'));
    client.on('close', () => log('SSH close'));

    await new Promise<void>((resolve, reject) => {
      client.once('ready', () => resolve());
      client.once('error', reject);
      client.connect(cfg);
    });

    log('SSH connected');

    this.sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
      client.sftp((err: Error | undefined, sftp: SFTPWrapper) => {
        if (err || !sftp) return reject(err ?? new Error('No SFTP'));
        resolve(sftp);
      });
    });

    this.tunnel = new Tunnel(client);
    log('SFTP ready');
  }

  async disconnect() {
    if (this.tunnel) {
      try {
        await this.tunnel.stop();
      } catch {
        // ignore
      }
    }
    this.tunnel = null;

    if (this.sftp) {
      try {
        this.sftp.end();
      } catch {
        // ignore
      }
    }
    this.sftp = null;

    if (this.client) {
      try {
        this.client.end();
      } catch {
        // ignore
      }
    }
    this.client = null;
    log('SSH disconnected');
  }

  private requireSftp() {
    if (!this.client || !this.sftp) throw new Error('Not connected');
    return { client: this.client, sftp: this.sftp };
  }

  async listRemote(dir: string) {
    const { sftp } = this.requireSftp();
    const entries = await new Promise<Array<{ filename: string; longname: string; attrs: any }>>((resolve, reject) => {
      sftp.readdir(dir, (err: Error | undefined, list: any) => {
        if (err || !list) return reject(err ?? new Error('readdir failed'));
        resolve(list as any);
      });
    });

    return entries
      .filter((e) => e.filename !== '.' && e.filename !== '..')
      .map((e) => {
        const isDir = typeof e.attrs?.isDirectory === 'function' ? e.attrs.isDirectory() : false;
        const isFile = typeof e.attrs?.isFile === 'function' ? e.attrs.isFile() : false;
        return { name: e.filename, kind: (isDir ? 'dir' : isFile ? 'file' : 'other') as 'dir' | 'file' | 'other' };
      })
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
  }

  async uploadFiles(localPaths: string[], remoteDir: string) {
    const { sftp } = this.requireSftp();
    for (const localPath of localPaths) {
      const base = path.basename(localPath);
      const remotePath =
        remoteDir === '.' ? base : path.posix.join(remoteDir.replace(/\\/g, '/'), base);

      log(`UPLOAD ${localPath} -> ${remotePath}`);
      await new Promise<void>((resolve, reject) => {
        sftp.fastPut(localPath, remotePath, (err: Error | null | undefined) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }
  }

  async startTunnel(params: TunnelParams) {
    if (!this.client || !this.tunnel) throw new Error('Not connected');
    await this.tunnel.start(params);
  }

  async stopTunnel() {
    if (!this.tunnel) return;
    await this.tunnel.stop();
  }

  async downloadToTemp(remotePath: string) {
    const { sftp } = this.requireSftp();
    const base = path.posix.basename(remotePath);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cftp-'));
    const localPath = path.join(dir, base);
    log(`DOWNLOAD ${remotePath} -> ${localPath}`);
    await new Promise<void>((resolve, reject) => {
      sftp.fastGet(remotePath, localPath, (err: Error | null | undefined) => {
        if (err) return reject(err);
        resolve();
      });
    });
    return localPath;
  }
}

const session = new SshSession();

// IPC
ipcMain.handle('cftp:connect', async (_evt, params: ConnectParams) => {
  try {
    await session.connect(params);
    return { ok: true as const };
  } catch (e: any) {
    log(`CONNECT failed: ${String(e?.message ?? e)}`);
    return { ok: false as const, error: String(e?.message ?? e) };
  }
});

ipcMain.handle('cftp:disconnect', async () => {
  await session.disconnect();
});

ipcMain.handle('cftp:listRemote', async (_evt, dir: string) => {
  try {
    const entries = await session.listRemote(dir);
    return { ok: true as const, entries };
  } catch (e: any) {
    return { ok: false as const, error: String(e?.message ?? e) };
  }
});

ipcMain.handle('cftp:uploadFiles', async (_evt, params: { localPaths: string[]; remoteDir: string }) => {
  try {
    await session.uploadFiles(params.localPaths, params.remoteDir);
    return { ok: true as const };
  } catch (e: any) {
    return { ok: false as const, error: String(e?.message ?? e) };
  }
});

ipcMain.handle('cftp:startTunnel', async (_evt, params: TunnelParams) => {
  try {
    await session.startTunnel(params);
    return { ok: true as const };
  } catch (e: any) {
    return { ok: false as const, error: String(e?.message ?? e) };
  }
});

ipcMain.handle('cftp:stopTunnel', async () => {
  await session.stopTunnel();
});

ipcMain.handle('cftp:choosePrivateKeyFile', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Choose private key',
    properties: ['openFile'],
    filters: [{ name: 'SSH Key', extensions: ['pem', 'key', 'ppk', '*'] }]
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return res.filePaths[0];
});

ipcMain.handle('cftp:chooseLocalFiles', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Select file(s) to upload',
    properties: ['openFile', 'multiSelections']
  });
  if (res.canceled) return [];
  return res.filePaths ?? [];
});

ipcMain.handle('cftp:startDragOut', async (evt, remotePath: string) => {
  if (!mainWindow) return;
  try {
    const localPath = await session.downloadToTemp(remotePath);

    // 1x1 transparent PNG (small; avoids bundling assets).
    const icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+o2xkAAAAASUVORK5CYII='
    );

    // Start OS-level drag from the renderer’s webContents.
    evt.sender.startDrag({ file: localPath, icon });
    log(`DRAG-OUT ready: ${remotePath}`);
  } catch (e: any) {
    log(`DRAG-OUT failed: ${String(e?.message ?? e)}`);
  }
});

ipcMain.on('cftp:preload-ready', () => {
  log('Preload ready (IPC bridge available)');
});

// App lifecycle
app.whenReady().then(async () => {
  await createMainWindow();
});

app.on('window-all-closed', () => {
  // Typical Windows behavior is to quit.
  app.quit();
});


