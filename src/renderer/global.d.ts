export {};

declare global {
  interface Window {
    cftp: {
      connect(params: {
        host: string;
        port: number;
        username: string;
        password?: string;
        privateKeyPath?: string;
        privateKeyPassphrase?: string;
        useAgent?: boolean;
        agentSockPath?: string;
      }): Promise<{ ok: true } | { ok: false; error: string }>;

      disconnect(): Promise<void>;

      startTunnel(params: {
        localPort: number;
        remoteHost: string;
        remotePort: number;
      }): Promise<{ ok: true } | { ok: false; error: string }>;

      stopTunnel(): Promise<void>;

      listRemote(dir: string): Promise<
        { ok: true; entries: Array<{ name: string; kind: 'file' | 'dir' | 'other' }> } | { ok: false; error: string }
      >;

      uploadFiles(params: { localPaths: string[]; remoteDir: string }): Promise<{ ok: true } | { ok: false; error: string }>;

      startDragOut(remotePath: string): Promise<void>;

      choosePrivateKeyFile(): Promise<string | null>;

      chooseLocalFiles(): Promise<string[]>;

      onLog(cb: (line: string) => void): () => void;
    };
  }
}


