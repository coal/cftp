# CFTP (Windows SSH Tunnel + Drag/Drop SFTP)

This is a minimal Electron utility that:

- Opens an SSH connection (password or private key)
- Optionally authenticates via **SSH agent** (OpenSSH agent via `SSH_AUTH_SOCK` or Windows pipe `\\\\.\\pipe\\openssh-ssh-agent`)
- Can start a **local port-forward tunnel** (e.g. `127.0.0.1:5432 -> remote:5432`)
- Lets you **upload** by dragging files into the app
- Lets you **download** by dragging a remote file out of the app into Explorer

## Dev

```bash
npm install
npm run dev
```

## Windows packaging

```bash
npm run dist:win
```

Output will be in `release/`.

### Note about WSL/Linux

Building a Windows `.exe` from WSL/Linux is not supported in this project because Electron native modules can’t be cross-compiled with `node-gyp`.

Use one of these:

- **Build on Windows**: run `npm run dist:win` in PowerShell/CMD
- **GitHub Actions**: run the workflow **Build Windows EXE** and download the `cftp-windows-installer` artifact


