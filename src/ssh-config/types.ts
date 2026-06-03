export interface SshConfigParam {
  key: string;
  value: string;
}

/** Input for creating/updating a managed Host block. */
export interface SshConfigEntry {
  alias: string;
  params: SshConfigParam[];
}
