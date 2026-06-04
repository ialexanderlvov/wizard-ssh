import type { Dict } from './ru.js';

const en: Dict = {
  // tunnelUpFlow
  pickTunnelUp: '🚇 Which tunnel to raise in the background?',
  bgNoPassword:
    'Background mode does not support password authentication (interactive sshpass required). ' +
    'Use a key/agent or raise the tunnel in the foreground.',
  alreadyRunning: (name, pid) => `«${name}» is already running in the background (pid ${pid}).`,
  windowsUnstable: 'Background tunnels on Windows are unstable.',
  bgStartFailed: 'Failed to start the background process.',
  tunnelRaised: (name, pid) => `Tunnel «${name}» raised in the background (pid ${pid}).`,
  tunnelLog: (log, name) => `Log: ${log} · stop: wssh tunnel down ${name}`,

  // listSessions
  noBackground: 'No background tunnels. Raise one: wssh tunnel start <name>',
  backgroundSection: (count) => `Background tunnels (${count})`,

  // tunnelDownFlow
  noBackgroundDown: 'No background tunnels.',
  pickTunnelDown: '🛑 Which background tunnel to stop?',
  stopEnsure: 'Stop tunnel',
  bgNotFound: (name) => `Background tunnel «${name}» not found.`,
  confirmStopAll: (count) => `Stop all (${count})?`,
  stopped: (count) => `Stopped: ${count}.`,

  // connectTunnelFlow
  pickTunnelConnect: '🚇 Select a tunnel',

  // createAndRaiseTunnel
  quickTunnelEnsure: 'Quick tunnel',
  noSshConfigHosts: 'No hosts found in ~/.ssh/config.',
  pickSshConfigHost: 'Host from ~/.ssh/config for the tunnel',
  tunnelCreated: (name) => `Tunnel «${name}» created.`,

  // raiseTemporaryTunnel
  tempTunnelEnsure: 'Temporary tunnel',
  tempTunnelSection: 'Temporary tunnel (to any host)',
  tempTunnelSaved: (name) => `Temporary tunnel «${name}» saved (separate list).`,

  // addTunnel
  addTunnelEnsure: 'Add tunnel',
  addTunnelSection: 'New tunnel',
  tunnelSaved: (name) => `Tunnel «${name}» saved.`,

  // editTunnel
  editEnsure: 'Edit',
  pickTunnelEdit: '✏️ Select a tunnel',
  editSection: (name) => `Tunnel: ${name}`,
  editFieldName: (name) => `Name         ${name}`,
  editFieldDescription: (desc) => `Description  ${desc}`,
  editFieldTags: (tags) => `Tags         ${tags}`,
  editFieldConnection: 'Connection / authentication',
  editFieldForward: (fwd) => `Forward      ${fwd}`,
  editFieldBrowser: (on) => `Auto-browser ${on ? 'on' : 'off'}`,
  editSave: 'Save and exit',
  editCancel: 'Exit without saving',
  editDirty: 'What to change? • unsaved edits',
  editClean: 'What to change?',
  editSaved: 'Changes saved.',
  editNoChanges: 'No changes.',
  editCancelConfirm: 'Exit without saving?',
  editNewName: 'New name',
  editInvalidName: 'Invalid name',
  editNameTaken: 'Name taken',
  editDescription: 'Description',
  editTags: 'Tags separated by commas',

  // removeTunnelFlow
  removeEnsure: 'Delete',
  pickTunnelRemove: '🗑 Select a tunnel',
  confirmRemoveOne: (name) => `Delete «${name}»?`,
  removed: (name) => `«${name}» deleted.`,
  tunnelListEmpty: 'Tunnel list is empty.',
  pickTunnelsMulti: 'Mark tunnels for deletion (space — mark, Enter — confirm)',
  nothingSelected: 'Nothing selected.',
  confirmRemoveMulti: (count) => `Delete ${count}?`,
  removedMulti: (count) => `Deleted: ${count}.`,

  // listTunnels
  listEmpty: 'No tunnels yet. Add one: wssh tunnel add',
  listSection: (count, sort, dir) => `Tunnels (${count}) · sort: ${sort}${dir}`,

  // local port-conflict guard
  portBusy: (port) => `Local port ${port} is already in use. Free it or pick another (--local).`,
  portBusyPrompt: (port) => `Local port ${port} is busy. What now?`,
  portUseFree: (port) => `Use free port ${port}`,
  portOverride: 'Raise anyway (ssh may fail)',
  portCancel: 'Cancel',
  portSave: (port) => `Save port ${port} on the tunnel?`,

  // clone
  pickTunnelClone: '🧬 Which tunnel to clone',
  cloneNamePrompt: '🏷 Name for the copy',
  cloned: (src, dst) => `Tunnel “${src}” cloned as “${dst}”.`,
  clonePortBumped: (port) => `Local port changed to a free one: ${port}.`,

  // logs
  logsEnsure: 'Background session logs',
  pickTunnelLogs: '📜 Whose log to show',
  logsSection: (name, file) => `Tunnel log “${name}” · ${file}`,
  logMissing: (file) => `Log file not found: ${file}`,
  logFollowHint: 'Ctrl+C — exit follow mode.',
};

export default en;
