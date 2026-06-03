/**
 * Domain types shared across the whole CLI. Kept dependency-free so every
 * layer (store, ssh, ui, commands) can import from one source of truth.
 */

export type HostMode = 'manual' | 'sshconfig';
export type AuthMethod = 'agent' | 'key' | 'password';
export type ForwardType = 'local' | 'remote' | 'dynamic';
export type SortKey = 'recent' | 'name' | 'uses' | 'created' | 'updated';
export type EntityKind = 'server' | 'tunnel';

/** How to reach a host + how to authenticate. Shared by servers and tunnels. */
export interface ConnectionTarget {
  hostMode: HostMode;
  /** alias from ~/.ssh/config (hostMode === 'sshconfig') */
  sshHost: string;
  /** ip or domain (hostMode === 'manual') */
  host: string;
  /** ssh user (manual mode; sshconfig derives it from the config) */
  user: string;
  /** ssh port (manual mode) */
  sshPort: number;
  auth: AuthMethod;
  /** private key path (auth === 'key') */
  keyPath: string | null;
  /** id of an encrypted password in the vault (auth === 'password', saved) */
  secretId: string | null;
}

export interface BaseEntity {
  id: string;
  name: string;
  description: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  useCount: number;
}

/** A plain SSH host you connect to (no tunnel). */
export interface Server extends BaseEntity, ConnectionTarget {
  kind: 'server';
  /** alias under which this server is mirrored into ~/.ssh/config, if any */
  linkedSshHost: string | null;
}

/** A saved port-forward. */
export interface Tunnel extends BaseEntity, ConnectionTarget {
  kind: 'tunnel';
  type: ForwardType;
  localPort: number;
  /** target host on the far side of the forward (local/remote) */
  remoteHost: string;
  /** target port on the far side of the forward (local/remote) */
  remotePort: number | null;
  openBrowser: boolean;
}

export type Entity = Server | Tunnel;

export interface VaultSettings {
  enabled: boolean;
  /** macOS Touch ID unlock enabled */
  touchId: boolean;
}

export interface Settings {
  defaultUser: string;
  defaultSshPort: number;
  defaultAuth: AuthMethod;
  defaultRemoteHost: string;
  openBrowser: boolean;
  defaultSort: SortKey;
  vault: VaultSettings;
}

/** A host parsed from ~/.ssh/config (for listing / picking / importing). */
export interface SshConfigHost {
  alias: string;
  hostName: string;
  user: string;
  port: string;
  identityFile: string;
  proxyJump: string;
  /** every option of the block, preserved for round-trip display */
  params: Array<{ key: string; value: string }>;
  /** source file the block came from */
  source: string;
}
