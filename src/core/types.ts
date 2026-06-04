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

/** A plain SSH host you connect to (no tunnel). Backed by a Host block in
 *  ~/.ssh/config: the server's name IS its alias. */
export interface Server extends BaseEntity, ConnectionTarget {
  kind: 'server';
  /** false for multi-alias / Match / Include hosts: connectable but not editable */
  manageable: boolean;
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
  /** auto-restart a dropped tunnel (autossh-style) with backoff, until Ctrl+C */
  tunnelAutoReconnect: boolean;
  vault: VaultSettings;
}

/**
 * App-only metadata stored in a `#wssh {...}` JSON comment directly above a
 * Host block in ~/.ssh/config. Only fields that cannot be expressed as standard
 * ssh directives live here; everything else is real config. Fields are omitted
 * when empty/default to keep the config tidy.
 */
export interface WsshMeta {
  /** free-text description */
  desc?: string;
  tags?: string[];
  /** stored only when 'password' (agent/key are inferred from the config) */
  auth?: 'password';
  /** id of an encrypted password in the vault */
  secretId?: string | null;
  /** ISO creation timestamp (immutable once set) */
  createdAt?: string;
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
  /** parsed `#wssh {...}` annotation above the block, if any */
  wssh: WsshMeta | null;
  /** true when this is a single-alias block in the MAIN config (safe to edit) */
  manageable: boolean;
}
