/** Parse `ssh -G <alias>` output into the effective host:port. A leaf module
 *  (no ssh/* back-deps) so the endpoint resolver (features) and the known_hosts
 *  token resolver (runner) share ONE parser and can never drift apart. */

export interface ResolvedEndpoint {
  host: string;
  port: number;
}

/** Read the effective `hostname` / `port` from `ssh -G` output, falling back to
 *  the given host/port when a field is absent or unparsable. */
export function parseSshGOutput(
  stdout: string,
  fallbackHost: string,
  fallbackPort = 22,
): ResolvedEndpoint {
  let host = fallbackHost;
  let port = fallbackPort;
  for (const line of stdout.split('\n')) {
    const [key, ...rest] = line.trim().split(/\s+/);
    const value = rest.join(' ');
    if (key === 'hostname' && value) host = value;
    else if (key === 'port' && value) port = Number(value) || fallbackPort;
  }
  return { host, port };
}
