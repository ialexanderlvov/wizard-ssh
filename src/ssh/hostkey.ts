/** known_hosts helpers — forget a host's saved key after a legitimate rebuild /
 *  "REMOTE HOST IDENTIFICATION HAS CHANGED" warning, and show its fingerprint. */

import { capture, commandExists } from '../utils/exec.js';

/** Remove every key for `host` from ~/.ssh/known_hosts (`ssh-keygen -R`). */
export function forgetHostKey(host: string): { ok: boolean; message: string } {
  if (!commandExists('ssh-keygen')) return { ok: false, message: 'ssh-keygen не найден в PATH.' };
  if (!host.trim()) return { ok: false, message: 'Пустой хост.' };
  const res = capture('ssh-keygen', ['-R', host.trim()]);
  if (res.status === 0) return { ok: true, message: `Ключи для ${host} удалены из known_hosts.` };
  return {
    ok: false,
    message: (res.stderr || res.stdout || 'ssh-keygen завершился с ошибкой.').trim(),
  };
}
