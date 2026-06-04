# Changelog

All notable changes to this project are documented in this file.

This file is maintained automatically by
[release-please](https://github.com/googleapis/release-please) from
[Conventional Commits](https://www.conventionalcommits.org/). Do not edit
released sections by hand.

## 1.0.0 (2026-06-04)

### Features

- Interactive CLI to manage SSH servers, tunnels and `~/.ssh/config` (CRUD,
  fuzzy search, instant connect).
- Forward (`-L`), reverse (`-R`) and dynamic (`-D`) tunnels with detached mode.
- Encrypted password vault (AES-256-GCM) with optional Touch ID unlock on macOS.
- Non-interactive / scriptable mode (`--yes`, `--non-interactive`).
- `~/.ssh/config` import/export and `doctor`/`check` diagnostics.
