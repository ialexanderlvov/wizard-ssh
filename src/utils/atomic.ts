/** Atomic, symlink-safe file writes shared by the JSON store and the ssh-config
 *  writer. */

import fs from 'node:fs';
import crypto from 'node:crypto';

// O_EXCL: fail if the tmp path already exists (never reuse/clobber). O_NOFOLLOW:
// never follow a symlink at the final component. Together with an unpredictable
// tmp name they stop a local attacker pre-planting a symlink at the tmp path to
// redirect or hijack the write. O_NOFOLLOW is POSIX-only — falls back to 0 on
// platforms (Windows) that don't define it.
const EXCL_NOFOLLOW =
  fs.constants.O_WRONLY |
  fs.constants.O_CREAT |
  fs.constants.O_EXCL |
  (fs.constants.O_NOFOLLOW ?? 0);

/** Write `data` to `target` atomically (tmp + fsync + rename) with `mode` perms.
 *  The tmp file is created next to the target with an unpredictable name and an
 *  exclusive, no-follow open, so a crash can't leave a half-written file and a
 *  pre-planted symlink can't redirect the write. */
export function atomicWrite(target: string, data: string | Buffer, mode = 0o600): void {
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, EXCL_NOFOLLOW, mode);
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
}
