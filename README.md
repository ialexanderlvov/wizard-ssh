# 🧙 Wizard SSH (`wssh`)

**English** · [Русский](./README.ru.md)

[![npm version](https://img.shields.io/npm/v/wizard-ssh.svg)](https://www.npmjs.com/package/wizard-ssh)
[![ci](https://github.com/ialexanderlvov/wizard-ssh/actions/workflows/ci.yml/badge.svg)](https://github.com/ialexanderlvov/wizard-ssh/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/npm/l/wizard-ssh.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/wizard-ssh.svg)](https://nodejs.org)

A beautiful interactive CLI for managing **SSH servers, tunnels, and `~/.ssh/config`**:
full CRUD, fuzzy search across everything at once, instant connect, forward and
reverse tunnels, and an **encrypted password vault** (master passphrase or Touch ID).

```
 ██╗    ██╗██╗███████╗ █████╗ ██████╗ ██████╗     ███████╗███████╗██╗  ██╗
 ██║    ██║██║╚══███╔╝██╔══██╗██╔══██╗██╔══██╗    ██╔════╝██╔════╝██║  ██║
 ██║ █╗ ██║██║  ███╔╝ ███████║██████╔╝██║  ██║    ███████╗███████╗███████║
 ██║███╗██║██║ ███╔╝  ██╔══██║██╔══██╗██║  ██║    ╚════██║╚════██║██╔══██║
 ╚███╔███╔╝██║███████╗██║  ██║██║  ██║██████╔╝    ███████║███████║██║  ██║
  ╚══╝╚══╝ ╚═╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝     ╚══════╝╚══════╝╚═╝  ╚═╝
```

> Successor to the former "SSH Tunnel Manager" — rewritten in TypeScript, with
> servers, `~/.ssh/config` management, reverse tunnels, and password encryption.
> Data from the previous version is imported automatically.

## ✨ Features

- 🖥 **Servers = `~/.ssh/config`** — servers live right inside `~/.ssh/config` (a single
  source of truth): each server is a `Host` block, while its description/tags/auth method
  and the reference to a saved password sit in a `#wssh {…}` comment above the block. Full
  CRUD with an automatic config backup before every write; multi-alias blocks and `Include`
  are connectable but not edited automatically. The "Servers" and "~/.ssh/config" menus are
  merged into one.
- 🚇 **Tunnels** — forward `-L`, **reverse `-R`**, and dynamic `-D` (SOCKS5). Full CRUD,
  **auto-reconnect** on drop (autossh-style, with backoff, until `Ctrl+C`), and a **background
  mode** — `wssh tunnel start` brings a tunnel up in the background, `tunnel sessions` lists
  the live ones, `tunnel down` stops them.
- 🔌 **Instant connect** — `wssh connect <name>` or fuzzy-pick from the combined list;
  `--tmux` attaches a persistent tmux session on the server.
- 🗝 **SSH key management** — a dedicated menu (`wssh keys`): list with fingerprints,
  generation (`ssh-keygen`: ed25519/rsa/ecdsa and hardware **ed25519-sk/ecdsa-sk** on FIDO2/U2F),
  show/copy the public key, install it on a server,
  **deletion with a warning about what still references the key**.
- 📡 **Status dashboard** — `wssh status` checks the reachability of all servers and tunnels
  in bulk and in parallel; `--servers/--tunnels/--tag` filters, `--json`, and a script-friendly exit code.
- 🔍 **Unified search** — fuzzy across servers, tunnels, and config hosts at once.
- 🕘 **History** — last-used timestamp and a use counter; sorts by `recent / name / uses / created / updated`.
- 🔐 **Encrypted passwords** — AES-256-GCM, key derived from a master passphrase (scrypt),
  entered once per session. On macOS — optional unlock via **Touch ID**. For scripts — the
  passphrase from the environment (`WSSH_VAULT_PASSPHRASE[_FILE|_CMD]`). You can delete a single
  saved password or **reset the vault** (forgot the passphrase) — servers and tunnels stay.
- 🛠 **SSH actions** — reachability check, `ssh-copy-id`, run a command, transfer files
  (`scp` or `rsync`), **tag groups**, **`known_hosts` management** — list entries and remove
  a selected one or by IP (`ssh-keygen -R`).
- 🤖 **Scriptable** — non-interactive server/tunnel creation via flags, end-to-end `--json`,
  global `--yes`/`--non-interactive`, `wssh doctor` (environment diagnostics), and
  `wssh info` (a summary of paths and inventory).
- 📦 **Export/import** — back up all lists (and the encrypted vault) into a single file.
- ⌨️ **Hotkey lists** — the same picker everywhere: start typing to filter live, `Tab` to cycle
  the sort, `↑/↓` to navigate, `Enter` to select, `Esc` or "← Back" to go back/exit (you can
  leave any menu without choosing anything).
- 🎨 A consistent look: a gradient banner, framed sections (with emoji), tidy rows with no
  icons inside the lists themselves, and clear errors. English and Russian UI.

## 🚀 Quick start

```bash
pnpm install
pnpm build
pnpm link --global   # makes the `wssh` and `wizard-ssh` commands available

wssh                 # interactive menu
```

More in [docs/INSTALL.md](docs/INSTALL.md) and [docs/USAGE.md](docs/USAGE.md).

## 🧭 Commands

| Command                                                  | Purpose                                           |
| -------------------------------------------------------- | ------------------------------------------------- |
| `wssh`                                                   | interactive menu                                  |
| `wssh connect [name]` (`up`, `go`) `[--tmux [session]]`  | connect to a server / tunnel / config alias       |
| `wssh server <add\|edit\|rm\|ls\|connect>` (`srv`, `s`)  | CRUD for servers = `~/.ssh/config` hosts          |
| `wssh tunnel <add\|edit\|rm\|ls\|connect>` (`tun`, `t`)  | CRUD + bringing tunnels up                        |
| `wssh tunnel <start\|sessions\|down>`                    | background tunnels: start / list / stop           |
| `wssh keys <ls\|gen\|rm>` (`key`)                        | SSH keys: list/fingerprints, generate, delete     |
| `wssh status` `[--servers\|--tunnels\|--tag\|--json]`    | bulk parallel reachability check                  |
| `wssh config <ls\|add\|edit\|rm\|connect>` (`cfg`)       | the same, "raw" access to `~/.ssh/config`         |
| `wssh search <query>` (`find`) `[--json]`                | unified fuzzy search                              |
| `wssh check [name]` `[--json]`                           | reachability check (port ping)                    |
| `wssh copy-id [name]`                                    | install a key on a server (`ssh-copy-id`)         |
| `wssh run <name> -- <cmd>`                               | run a command on a server                         |
| `wssh transfer [name]` (`scp`)                           | transfer files over scp or rsync                  |
| `wssh group <ls\|check <tag>>`                           | tag groups: sizes and bulk checks                 |
| `wssh forget-host [name\|ip]` (`known-hosts`) `[--list]` | known hosts: remove (`ssh-keygen -R`) / list      |
| `wssh doctor` · `wssh info` (`env`)                      | environment diagnostics · paths/inventory summary |
| `wssh vault`                                             | manage the password vault                         |
| `wssh settings`                                          | default values                                    |
| `wssh export [file]` · `wssh import <file> [--replace]`  | backup / restore                                  |
| `wssh path`                                              | path to the data directory                        |

Lists are sortable: `wssh server ls --sort recent|name|uses|created|updated [--reverse] [--json]`.

**UI language.** `ru` and `en` are supported (built on [`i18n-typed-store`](https://www.npmjs.com/package/i18n-typed-store)).
Resolution: the `WSSH_LANG` variable (highest priority) → the "UI language" setting in `wssh settings` → the system locale
(`LC_ALL`/`LANG`); detected automatically by default.

```bash
WSSH_LANG=en wssh           # run in English
WSSH_LANG=ru wssh doctor    # force Russian
```

**Scripting (no questions).** Servers and tunnels can be created with flags, and confirmations
can be automated:

```bash
wssh server add prod --host 10.0.0.5 --user deploy --auth key --key ~/.ssh/id_ed25519
wssh tunnel add --alias prod --type local --local 8080 --remote-port 80
wssh -y keys rm ~/.ssh/old_key          # -y / --yes — answer "yes" to everything
wssh --non-interactive status --json    # no prompts; machine-readable output
WSSH_VAULT_PASSPHRASE=… wssh run prod -- uptime   # vault passphrase from the env
```

## 🔐 Data & security

- All data lives in `~/.wizard-ssh/` (files with `0600` permissions). The directory can be
  overridden with the `WIZARD_SSH_HOME` variable.
- **Passwords are never stored in the clear.** They are encrypted with AES-256-GCM using a key
  derived from the master passphrase (scrypt). The passphrase is entered once per session and
  kept only in memory.
- On macOS you can enable **Touch ID** — biometrics unlock the key stored in the Keychain
  (requires macOS + Xcode Command Line Tools for `swiftc`). This is a convenience layer; the
  root of trust is the master passphrase. Details and the trade-off are in
  [docs/USAGE.md](docs/USAGE.md).
- A backup is created in `~/.wizard-ssh/backups/` before any write to `~/.ssh/config`.
- Corrupt JSON is never lost: a backup copy is made and the app starts from a clean slate.

## 🏗 Architecture

```
src/
  cli.ts              entry point (commander)
  core/               types, paths (~/.wizard-ssh), constants, errors
  utils/              validators, time, strings, exec, platform
  store/              servers over ~/.ssh/config + usage.json (stats), tunnels/settings (JSON), background sessions, migration
  vault/              crypto (AES-GCM/scrypt), Touch ID, vault
  ssh-config/         parser + writer (CRUD over ~/.ssh/config) with #wssh annotations
  ssh/                ssh-argument building, runner (+ auto-reconnect, background tunnels), features (check/status/copy-id/run/scp/rsync), keys, known_hosts
  ui/                 theme, banner, messages, tables, prompts, list-prompt (picker with filter/sort), rows (shared rows)
  search/             unified fuzzy search
  commands/           CRUD flows, actions, menu, commander wiring
```

## 🛠 Development

```bash
pnpm dev             # run via tsx without a build
pnpm typecheck       # tsc --noEmit
pnpm lint            # eslint
pnpm format          # prettier --write
pnpm test            # vitest
pnpm test:coverage   # vitest + coverage
pnpm build           # tsup → dist/
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (enforced by
commitlint via husky; before each commit — lint-staged: eslint --fix + prettier).

## License

MIT.
