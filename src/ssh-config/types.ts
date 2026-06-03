import type { WsshMeta } from '../core/types.js';

export interface SshConfigParam {
  key: string;
  value: string;
}

/** Input for creating/updating a managed Host block. */
export interface SshConfigEntry {
  alias: string;
  params: SshConfigParam[];
  /** when set, a `#wssh {...}` comment is written directly above the Host */
  wssh?: WsshMeta | null;
}
