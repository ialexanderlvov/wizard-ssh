/** Local TCP port probes — used to catch a tunnel's local bind conflict before
 *  ssh fails with "Address already in use", and to suggest a free alternative. */

import net from 'node:net';

/** True if `port` can be bound on `host` (default loopback). Probes by briefly
 *  listening, then closes — never holds the port. Resolves false on EADDRINUSE,
 *  EACCES (privileged port), or any bind error. */
export function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      resolve(false);
      return;
    }
    const srv = net.createServer();
    srv.unref();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    try {
      srv.listen(port, host);
    } catch {
      resolve(false);
    }
  });
}

/** First free port at or above `start`, scanning up to `tries` ports. Returns
 *  null if none is free in range (or the range runs past 65535). */
export async function findFreePort(start: number, tries = 50): Promise<number | null> {
  for (let p = start; p < start + tries && p <= 65535; p++) {
    if (await isPortFree(p)) return p;
  }
  return null;
}
