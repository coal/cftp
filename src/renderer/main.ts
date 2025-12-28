import './styles.css';

type RemoteEntry = { name: string; kind: 'file' | 'dir' | 'other' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function joinRemote(dir: string, child: string) {
  const d = (dir || '.').trim();
  if (d === '.' || d === '') return child;
  if (d === '/') return `/${child}`;
  return `${d.replace(/\/+$/, '')}/${child}`;
}

const app = document.querySelector<HTMLDivElement>('#app')!;

const container = el('div', 'container');
app.appendChild(container);

const top = el('div', 'row top');
const mid = el('div', 'row mid');
const bottom = el('div', 'panel');
container.appendChild(top);
container.appendChild(mid);
container.appendChild(bottom);

// --- Connect panel
const connectPanel = el('div', 'panel');
top.appendChild(connectPanel);
connectPanel.appendChild(Object.assign(el('h2'), { textContent: 'SSH Connection' }));

const hostInput = Object.assign(el('input'), { placeholder: 'Host (e.g. 10.0.0.5)' });
const portInput = Object.assign(el('input'), { placeholder: 'Port', value: '22' });
const userInput = Object.assign(el('input'), { placeholder: 'Username' });
const passInput = Object.assign(el('input'), { placeholder: 'Password (optional)', type: 'password' });
const keyPathInput = Object.assign(el('input'), { placeholder: 'Private key path (optional)' });
const keyPassInput = Object.assign(el('input'), { placeholder: 'Key passphrase (optional)', type: 'password' });
const useAgentInput = Object.assign(el('input'), { type: 'checkbox' }) as HTMLInputElement;
const agentSockInput = Object.assign(el('input'), {
  placeholder: 'Agent socket/pipe (optional; e.g. \\\\\\\\.\\\\pipe\\\\openssh-ssh-agent)'
});

const keyPickBtn = Object.assign(el('button'), { textContent: 'Choose key…' });
keyPickBtn.addEventListener('click', async () => {
  const picked = await window.cftp.choosePrivateKeyFile();
  if (picked) keyPathInput.value = picked;
});

const connectGrid = el('div', 'grid2');
connectPanel.appendChild(connectGrid);

function labeled(label: string, input: HTMLElement) {
  const wrap = el('div');
  const lab = el('label');
  lab.textContent = label;
  wrap.appendChild(lab);
  wrap.appendChild(input);
  return wrap;
}

connectGrid.appendChild(labeled('Host', hostInput));
connectGrid.appendChild(labeled('Port', portInput));
connectGrid.appendChild(labeled('Username', userInput));
connectGrid.appendChild(labeled('Password', passInput));

const agentRow = el('div', 'grid2');
connectPanel.appendChild(agentRow);
const agentToggleWrap = el('div');
agentToggleWrap.appendChild(Object.assign(el('label'), { textContent: 'Use SSH agent' }));
const agentToggleLine = el('div');
agentToggleLine.style.display = 'flex';
agentToggleLine.style.alignItems = 'center';
agentToggleLine.style.gap = '10px';
agentToggleLine.appendChild(useAgentInput);
agentToggleLine.appendChild(Object.assign(el('div', 'badge'), { textContent: 'Prefer agent keys (no password/key file)' }));
agentToggleWrap.appendChild(agentToggleLine);
agentRow.appendChild(agentToggleWrap);
agentRow.appendChild(labeled('Agent socket/pipe', agentSockInput));

const keyRow = el('div', 'grid2');
connectPanel.appendChild(keyRow);
keyRow.appendChild(labeled('Private key path', keyPathInput));
const keyPickWrap = el('div');
keyPickWrap.appendChild(el('label')).textContent = ' ';
keyPickWrap.appendChild(keyPickBtn);
keyRow.appendChild(keyPickWrap);

const keyPassRow = el('div');
connectPanel.appendChild(keyPassRow);
keyPassRow.appendChild(labeled('Key passphrase', keyPassInput));

const connectActions = el('div', 'actions');
connectPanel.appendChild(connectActions);
const connectBtn = Object.assign(el('button', 'primary'), { textContent: 'Connect' });
const disconnectBtn = Object.assign(el('button', 'danger'), { textContent: 'Disconnect', disabled: true });
const connStatus = Object.assign(el('div', 'status'), { textContent: 'Not connected' });
connectActions.appendChild(connectBtn);
connectActions.appendChild(disconnectBtn);
connectActions.appendChild(connStatus);

let connected = false;

function updateAuthInputs() {
  const agent = useAgentInput.checked;
  passInput.disabled = agent;
  keyPathInput.disabled = agent;
  keyPassInput.disabled = agent;
  keyPickBtn.disabled = agent;
  agentSockInput.disabled = !agent;
}

useAgentInput.addEventListener('change', updateAuthInputs);
updateAuthInputs();

async function setConnected(next: boolean) {
  connected = next;
  connectBtn.disabled = connected;
  disconnectBtn.disabled = !connected;
  connStatus.textContent = connected ? 'Connected' : 'Not connected';
}

connectBtn.addEventListener('click', async () => {
  const host = hostInput.value.trim();
  const port = Number(portInput.value || '22');
  const username = userInput.value.trim();
  const useAgent = useAgentInput.checked;
  const agentSockPath = agentSockInput.value.trim() ? agentSockInput.value.trim() : undefined;
  const password = !useAgent && passInput.value ? passInput.value : undefined;
  const privateKeyPath = !useAgent && keyPathInput.value.trim() ? keyPathInput.value.trim() : undefined;
  const privateKeyPassphrase = !useAgent && keyPassInput.value ? keyPassInput.value : undefined;

  const res = await window.cftp.connect({
    host,
    port,
    username,
    password,
    privateKeyPath,
    privateKeyPassphrase,
    useAgent,
    agentSockPath
  });
  if (!res.ok) return logLine(`CONNECT ERROR: ${res.error}`);
  await setConnected(true);
  await refreshRemote();
});

disconnectBtn.addEventListener('click', async () => {
  await window.cftp.disconnect();
  await setConnected(false);
  remoteList.innerHTML = '';
});

// --- Tunnel panel
const tunnelPanel = el('div', 'panel');
top.appendChild(tunnelPanel);
// Title
tunnelPanel.appendChild(Object.assign(el('h2'), { textContent: 'SSH Tunnel (Local Port Forward)' }));

const localPortInput = Object.assign(el('input'), { placeholder: 'Local port (e.g. 5432)' });
const remoteHostInput = Object.assign(el('input'), { placeholder: 'Remote host (e.g. 127.0.0.1)' });
const remotePortInput = Object.assign(el('input'), { placeholder: 'Remote port (e.g. 5432)' });

const tunnelGrid = el('div', 'grid3');
tunnelPanel.appendChild(tunnelGrid);
tunnelGrid.appendChild(labeled('Local port', localPortInput));
tunnelGrid.appendChild(labeled('Remote host', remoteHostInput));
tunnelGrid.appendChild(labeled('Remote port', remotePortInput));

const tunnelActions = el('div', 'actions');
tunnelPanel.appendChild(tunnelActions);
const startTunnelBtn = Object.assign(el('button', 'primary'), { textContent: 'Start tunnel' });
const stopTunnelBtn = Object.assign(el('button', 'danger'), { textContent: 'Stop tunnel' });
stopTunnelBtn.disabled = true;
const tunnelStatus = Object.assign(el('div', 'status'), { textContent: 'Stopped' });
tunnelActions.appendChild(startTunnelBtn);
tunnelActions.appendChild(stopTunnelBtn);
tunnelActions.appendChild(tunnelStatus);

startTunnelBtn.addEventListener('click', async () => {
  if (!connected) return logLine('TUNNEL: connect first');
  const localPort = Number(localPortInput.value);
  const remoteHost = remoteHostInput.value.trim();
  const remotePort = Number(remotePortInput.value);
  const res = await window.cftp.startTunnel({ localPort, remoteHost, remotePort });
  if (!res.ok) return logLine(`TUNNEL ERROR: ${res.error}`);
  startTunnelBtn.disabled = true;
  stopTunnelBtn.disabled = false;
  tunnelStatus.textContent = `Running on 127.0.0.1:${localPort} → ${remoteHost}:${remotePort}`;
});

stopTunnelBtn.addEventListener('click', async () => {
  await window.cftp.stopTunnel();
  startTunnelBtn.disabled = false;
  stopTunnelBtn.disabled = true;
  tunnelStatus.textContent = 'Stopped';
});

// --- Remote browser panel
const remotePanel = el('div', 'panel');
mid.appendChild(remotePanel);
remotePanel.appendChild(Object.assign(el('h2'), { textContent: 'Remote Files (drag out to download)' }));

const remoteListHeader = el('div', 'remoteListHeader');
remotePanel.appendChild(remoteListHeader);

const remoteDirInput = Object.assign(el('input'), { placeholder: '/path/on/remote', value: '.' });
const refreshBtn = Object.assign(el('button'), { textContent: 'Refresh' });
const upBtn = Object.assign(el('button'), { textContent: 'Up' });

remoteListHeader.appendChild(remoteDirInput);
remoteListHeader.appendChild(refreshBtn);
remoteListHeader.appendChild(upBtn);

const remoteList = el('ul', 'filelist');
remotePanel.appendChild(remoteList);

async function refreshRemote() {
  if (!connected) return;
  const dir = remoteDirInput.value.trim() || '.';
  const res = await window.cftp.listRemote(dir);
  if (!res.ok) return logLine(`LIST ERROR: ${res.error}`);
  renderRemote(res.entries, dir);
}

function renderRemote(entries: RemoteEntry[], dir: string) {
  remoteList.innerHTML = '';
  const staged = new Map<string, string>(); // remotePath -> localPath
  for (const entry of entries) {
    const li = document.createElement('li');
    const left = el('div');
    left.textContent = entry.name;

    const right = el('div');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '10px';

    const kindBadge = el('div', 'badge');
    kindBadge.textContent = entry.kind;
    right.appendChild(kindBadge);

    const remotePath = joinRemote(dir, entry.name);

    if (entry.kind === 'file') {
      li.draggable = true;
      li.title = 'Drag to Explorer to download (first drag will stage, second drag will drop)';
      li.addEventListener('dragstart', (e) => {
        const localPath = staged.get(remotePath);
        if (!localPath) {
          e.preventDefault();
          logLine('DRAG-OUT: staging file… drag again when ready');
          void (async () => {
            const res = await window.cftp.prepareDragOut(remotePath);
            if (!res.ok) return logLine(`DRAG-OUT ERROR: ${res.error}`);
            staged.set(remotePath, res.localPath);
            logLine('DRAG-OUT: staged. Drag again to drop onto Desktop/folder.');
          })();
          return;
        }

        // Start OS drag immediately (must be fast).
        window.cftp.startDragLocal(localPath);
      });

      const dlBtn = Object.assign(el('button'), { textContent: 'Download…' });
      dlBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const res = await window.cftp.downloadFile(remotePath);
        if (!res.ok) return logLine(`DOWNLOAD ERROR: ${res.error}`);
        logLine(`Saved to: ${res.savedTo}`);
      });
      right.appendChild(dlBtn);
    } else if (entry.kind === 'dir') {
      li.title = 'Double-click to open';
      li.addEventListener('dblclick', () => {
        remoteDirInput.value = remotePath;
        void refreshRemote();
      });
    }

    li.appendChild(left);
    li.appendChild(right);
    remoteList.appendChild(li);
  }
}

refreshBtn.addEventListener('click', () => void refreshRemote());
upBtn.addEventListener('click', () => {
  const v = remoteDirInput.value.trim() || '.';
  if (v === '.' || v === '/') return;
  const cleaned = v.endsWith('/') ? v.slice(0, -1) : v;
  const idx = cleaned.lastIndexOf('/');
  remoteDirInput.value = idx <= 0 ? '/' : cleaned.slice(0, idx);
  void refreshRemote();
});

// --- Upload dropzone panel
const uploadPanel = el('div', 'panel');
mid.appendChild(uploadPanel);
uploadPanel.appendChild(Object.assign(el('h2'), { textContent: 'Upload (drag files here)' }));

const uploadActions = el('div', 'actions');
uploadPanel.appendChild(uploadActions);
const pickUploadBtn = Object.assign(el('button'), { textContent: 'Select files…' });
uploadActions.appendChild(pickUploadBtn);

const dz = el('div', 'dropzone');
dz.innerHTML = `<div>
  <div style="font-weight:650; margin-bottom:6px;">Drop files from Explorer to upload</div>
  <div class="badge">Uploads to the current remote directory</div>
</div>`;
uploadPanel.appendChild(dz);

pickUploadBtn.addEventListener('click', async () => {
  if (!connected) return logLine('UPLOAD: connect first');
  const remoteDir = remoteDirInput.value.trim() || '.';
  const localPaths = await window.cftp.chooseLocalFiles();
  if (!localPaths?.length) return;
  const res = await window.cftp.uploadFiles({ localPaths, remoteDir });
  if (!res.ok) return logLine(`UPLOAD ERROR: ${res.error}`);
  logLine(`Uploaded ${localPaths.length} file(s) → ${remoteDir}`);
  await refreshRemote();
});

dz.addEventListener('dragover', (e) => {
  e.preventDefault();
  dz.classList.add('drag');
});
dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
dz.addEventListener('drop', async (e) => {
  e.preventDefault();
  dz.classList.remove('drag');
  if (!connected) return logLine('UPLOAD: connect first');

  const dt = e.dataTransfer;
  const files = Array.from(dt?.files ?? []);
  let localPaths = files
    .map((f: any) => (typeof f?.path === 'string' ? (f.path as string) : ''))
    .filter(Boolean);

  // Some environments don't expose File.path; try DataTransferItem -> File as well.
  if (!localPaths.length && dt?.items?.length) {
    for (const item of Array.from(dt.items)) {
      if (item.kind !== 'file') continue;
      const f: any = item.getAsFile?.();
      if (f && typeof f.path === 'string' && f.path) localPaths.push(f.path);
    }
  }

  if (!localPaths.length) {
    const names = files.map((f) => f.name).filter(Boolean);
    logLine(`UPLOAD: no file paths found. Dropped files: ${names.join(', ') || '(none)'}`);
    logLine('Tip: if dragging doesn’t work, use “Select files…”');
    return;
  }

  const remoteDir = remoteDirInput.value.trim() || '.';
  const res = await window.cftp.uploadFiles({ localPaths, remoteDir });
  if (!res.ok) return logLine(`UPLOAD ERROR: ${res.error}`);
  logLine(`Uploaded ${localPaths.length} file(s) → ${remoteDir}`);
  await refreshRemote();
});

// --- Log panel
bottom.appendChild(Object.assign(el('h2'), { textContent: 'Log' }));
const logBox = el('div', 'log');
bottom.appendChild(logBox);

function logLine(line: string) {
  const ts = new Date().toISOString().slice(11, 19);
  logBox.textContent += `[${ts}] ${line}\n`;
  logBox.scrollTop = logBox.scrollHeight;
}

// If preload/IPC isn't wired, nothing will work—make that obvious.
if (!('cftp' in window) || !window.cftp) {
  logLine('ERROR: IPC bridge not available (preload did not load).');
  logLine('If you are developing, rebuild Electron and restart `npm run dev`.');
  connectBtn.disabled = true;
} else {
  window.cftp.onLog((line) => logLine(line));
}


