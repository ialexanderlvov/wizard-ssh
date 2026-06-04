/** POSIX shell-quoting for argv tokens that get embedded into a single command
 *  STRING which a downstream tool re-splits (rsync `-e`, mosh `--ssh`). Without
 *  quoting, a key path with a space is word-split (auth silently breaks) and one
 *  with ssh-option syntax (e.g. `/k -oProxyCommand=…`) injects ssh options →
 *  ProxyCommand RCE. Single-quoting makes each token survive as one literal. */

/** Wrap a token in single quotes, escaping embedded single quotes as '\''. */
export function shQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** Join argv into a shell-safe command string (each token individually quoted). */
export function shJoin(parts: readonly string[]): string {
  return parts.map(shQuote).join(' ');
}
