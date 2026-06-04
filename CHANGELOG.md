# Changelog

All notable changes to this project are documented in this file.

This file is maintained automatically by
[release-please](https://github.com/googleapis/release-please) from
[Conventional Commits](https://www.conventionalcommits.org/). Do not edit
released sections by hand.

## [1.3.0](https://github.com/ialexanderlvov/wizard-ssh/compare/wizard-ssh-v1.2.0...wizard-ssh-v1.3.0) (2026-06-04)


### Features

* **ui:** let Esc cancel a value edit and step back ([99a13f7](https://github.com/ialexanderlvov/wizard-ssh/commit/99a13f7251e1d84df93b558e9a018732da801fef))

## [1.2.0](https://github.com/ialexanderlvov/wizard-ssh/compare/wizard-ssh-v1.1.0...wizard-ssh-v1.2.0) (2026-06-04)


### Features

* SSH key audit, ProxyJump visualization and mosh connect ([dda4992](https://github.com/ialexanderlvov/wizard-ssh/commit/dda49920544f0f465b8934fd918b6d8e8f810f78))
* **tunnels:** port-conflict guard, clone/duplicate and tunnel logs ([0d8c5cf](https://github.com/ialexanderlvov/wizard-ssh/commit/0d8c5cfbf716dc5d75c06c6af1a284d731f50c92))


### Bug Fixes

* **config:** validate IdentityFile and ProxyJump in the host editor ([e507763](https://github.com/ialexanderlvov/wizard-ssh/commit/e50776359494832c0fec50f3fd9f6cff63ea9cec))
* harden password reveal, config writes, validation and error output ([575f93b](https://github.com/ialexanderlvov/wizard-ssh/commit/575f93bd08e928a52f45f4d0edd33822c1c45024))
* **hostkey:** forget the port-qualified known_hosts token for named hosts ([8ddd4db](https://github.com/ialexanderlvov/wizard-ssh/commit/8ddd4dbed6222a03531bc0255f2bc9a88d3e8727))
* **import:** tolerate a nameless aliased server record ([ced84fa](https://github.com/ialexanderlvov/wizard-ssh/commit/ced84fa15db25c78dae6942104a7a45941e136f1))
* **import:** validate proxyJump and neutralize untrusted metadata ([fc96158](https://github.com/ialexanderlvov/wizard-ssh/commit/fc96158faf18765d8dbddd88db0f1dfa936df09c))
* **menu:** return straight back when leaving a sub-list ([4170a3d](https://github.com/ialexanderlvov/wizard-ssh/commit/4170a3d7cf111e5d8d422c0d50e1407fe037cbe1))
* **security:** disable proxy/local-command for password-auth scp and ssh-copy-id ([944d144](https://github.com/ialexanderlvov/wizard-ssh/commit/944d144d2518109295fa221069b9acf361d069fa))
* **security:** shell-quote keyPath in rsync/mosh transport strings ([a58307b](https://github.com/ialexanderlvov/wizard-ssh/commit/a58307bf7a4914994582227c245a018df01f6147))
* **sessions:** keep a live tunnel when the ps liveness probe is inconclusive ([eaf491d](https://github.com/ialexanderlvov/wizard-ssh/commit/eaf491dbf38c34b94371ee926fcbe68546e9f1a8))
* **ssh-config:** never treat multi-pattern Host blocks as managed ([28a9485](https://github.com/ialexanderlvov/wizard-ssh/commit/28a948592e30e3a85a216288e03f2b567c6aef94))
* **ssh-config:** refuse to shadow an Include-only alias ([6c9ad7f](https://github.com/ialexanderlvov/wizard-ssh/commit/6c9ad7fec547a877334959745ae9b13a1da0d468))
* **ssh-config:** strip terminal-escape bytes from parsed host fields ([b5eadea](https://github.com/ialexanderlvov/wizard-ssh/commit/b5eadeae67e55cb272af279931ea1b2cde19293b))
* **ssh:** guard mosh destination and end ssh -G option parsing ([dd58f56](https://github.com/ialexanderlvov/wizard-ssh/commit/dd58f5647ee7a059b4926aeff1456c195be03599))
* **ssh:** keep detached tunnel logs inside the logs dir ([f8b6268](https://github.com/ialexanderlvov/wizard-ssh/commit/f8b62682e03b1698571e3a8325b07f1550e2257d))
* **store:** harden normalization of untrusted records ([64ed32b](https://github.com/ialexanderlvov/wizard-ssh/commit/64ed32bb478ced4a8c0311de8fb5505ad8c34a2d))
* **store:** write temp files with O_EXCL|O_NOFOLLOW and a random name ([4a75ce2](https://github.com/ialexanderlvov/wizard-ssh/commit/4a75ce2e7187aadd5f74954dd368a8111dd3e594))
* **validators:** tighten IP validation and empty-string port coercion ([8843105](https://github.com/ialexanderlvov/wizard-ssh/commit/88431059041fd3480582365f72e643a5829deada))
* **vault:** bound scrypt work by the parallelism factor p ([a9e8219](https://github.com/ialexanderlvov/wizard-ssh/commit/a9e821924184745df488fdd7e7105ee536b70a49))
* **vault:** integrity-check the Touch ID helper and harden key storage ([fa06083](https://github.com/ialexanderlvov/wizard-ssh/commit/fa06083ec2552959a76c19a1d8e20a2e04903a5a))

## [1.1.0](https://github.com/ialexanderlvov/wizard-ssh/compare/wizard-ssh-v1.0.0...wizard-ssh-v1.1.0) (2026-06-04)


### Features

* **cli:** add commander entry point exposing the wssh binary ([98eccf5](https://github.com/ialexanderlvov/wizard-ssh/commit/98eccf53f0fa8d0f593007ee7d9f19a2f34974f3))
* **cli:** add doctor and info diagnostics, search --json ([a96b99a](https://github.com/ialexanderlvov/wizard-ssh/commit/a96b99a25dbd263f535cd4c7c23615b4b81523b6))
* **cli:** add global --yes and --non-interactive flags ([a1e8d01](https://github.com/ialexanderlvov/wizard-ssh/commit/a1e8d01517b8a9b8fe4eaa35116a737831ce8138))
* **cli:** non-interactive server/tunnel creation by flags ([c7787ad](https://github.com/ialexanderlvov/wizard-ssh/commit/c7787ad0ceefa639b23ef3b31b50b73779cc300a))
* **cli:** register new commands, menus and ssh exports ([1a4b516](https://github.com/ialexanderlvov/wizard-ssh/commit/1a4b5169bf915d968d89f5bd769a7ca68b7078a0))
* **commands:** add server/tunnel/config CRUD, actions and interactive menu ([f55f2c1](https://github.com/ialexanderlvov/wizard-ssh/commit/f55f2c18b780dcd42aeef8b17193d6eacbe5980d))
* **config:** pick a ProxyJump bastion from existing hosts ([0627e08](https://github.com/ialexanderlvov/wizard-ssh/commit/0627e08610fa286d4e736d0e45b0528ea5a287de))
* **connect:** --tmux session attach ([4cdb554](https://github.com/ialexanderlvov/wizard-ssh/commit/4cdb554209cff333d8092f7c67c3e92ed65e6b24))
* **core:** add domain types, data paths and shared utilities ([82665e1](https://github.com/ialexanderlvov/wizard-ssh/commit/82665e15eb7b2db733e95faf3f848e36dae18ee6))
* **i18n:** add i18n-typed-store with ru/en locales and language setting ([5111060](https://github.com/ialexanderlvov/wizard-ssh/commit/5111060d2833ae6b914a2ac18147a10592d5691a))
* **keys:** add ed25519-sk and ecdsa-sk security-key types ([0b9849c](https://github.com/ialexanderlvov/wizard-ssh/commit/0b9849c79d11e49e391b717bb876db1414f46d85))
* **keys:** manage SSH keys with reference-aware deletion ([d2a2505](https://github.com/ialexanderlvov/wizard-ssh/commit/d2a2505f665f36f9f353a691270541c942b9d493))
* **menu:** move known_hosts to the main menu ([f2f91f5](https://github.com/ialexanderlvov/wizard-ssh/commit/f2f91f5fb6d10666c3e37dcae63fa5391da9c7d0))
* **ssh-config:** annotate Host blocks with #wssh metadata ([fded29e](https://github.com/ialexanderlvov/wizard-ssh/commit/fded29e34660f3bf9053f257739a23e50f8b0460))
* **ssh-config:** read and write ~/.ssh/config with safe CRUD ([a7f5083](https://github.com/ialexanderlvov/wizard-ssh/commit/a7f50836117c429210098a70c52e49aacb31bba7))
* **ssh:** add rsync file transfer alongside scp ([11a6112](https://github.com/ialexanderlvov/wizard-ssh/commit/11a6112e6c38302dcda418e32f36264be83ebae4))
* **ssh:** add ssh argument builder, runner and extra actions ([1cf98d9](https://github.com/ialexanderlvov/wizard-ssh/commit/1cf98d9649e41da8aa51b1887d7997da92483f17))
* **ssh:** list and remove known_hosts entries ([76d2133](https://github.com/ialexanderlvov/wizard-ssh/commit/76d21339916df33a5e1c13632c99eb05557115c9))
* **ssh:** list known_hosts newest first ([015cdf8](https://github.com/ialexanderlvov/wizard-ssh/commit/015cdf84b61c12b09435d9bec8632438bdc7fd68))
* **ssh:** offer to forget a changed host key and reconnect ([73c03a7](https://github.com/ialexanderlvov/wizard-ssh/commit/73c03a777987f1f2b2ca49ec1ea20c26be87f91b))
* **ssh:** parallel fleet status, tag groups and known_hosts ([31a83a3](https://github.com/ialexanderlvov/wizard-ssh/commit/31a83a35254d1f5766965f163b764b431500409e))
* **ssh:** tmux-aware connect arguments ([f38c905](https://github.com/ialexanderlvov/wizard-ssh/commit/f38c905100ed793d5ebfdc03763e61a53915206a))
* **store:** add atomic JSON stores, entity collections and legacy migration ([284035a](https://github.com/ialexanderlvov/wizard-ssh/commit/284035ab91df64eaa9b2a170842de3b2245145bc))
* **store:** back servers with ~/.ssh/config and migrate servers.json ([090e78f](https://github.com/ialexanderlvov/wizard-ssh/commit/090e78f8f1426330850c528f3487d8ffd740b52c))
* **tunnel:** auto-reconnect and background sessions ([e85d9cb](https://github.com/ialexanderlvov/wizard-ssh/commit/e85d9cbf74648c0ce10baa4416e2229dd0b994ac))
* **tunnel:** create and raise a tunnel from a ~/.ssh/config host ([12359a2](https://github.com/ialexanderlvov/wizard-ssh/commit/12359a28b5d24b00d353a309d8ce9ca24e452015))
* **tunnel:** persist temporary tunnels to a separate list ([9dc8c5a](https://github.com/ialexanderlvov/wizard-ssh/commit/9dc8c5a0eaf20618ec7a12445d869b3bf06d0650))
* **tunnel:** raise a temporary tunnel to any host without saving ([c9cdb88](https://github.com/ialexanderlvov/wizard-ssh/commit/c9cdb8859905f707dc7e9464e0c5836976b59966))
* **ui:** add reusable list prompt with filter, Tab-sort and Esc-back ([aeef65c](https://github.com/ialexanderlvov/wizard-ssh/commit/aeef65ccf11cae6a8759d7777d1c8d88772a8ba7))
* **ui:** add theme, banner, tables, prompts and unified fuzzy search ([8fc1908](https://github.com/ialexanderlvov/wizard-ssh/commit/8fc19084d5900e28288893382bce175b3fab0ee0))
* **ui:** single-screen menus with breadcrumb and depth indent ([0acdda0](https://github.com/ialexanderlvov/wizard-ssh/commit/0acdda01c7b319107a224ba0e244623fe431c536))
* **vault:** add encrypted password vault with optional Touch ID unlock ([be54bf8](https://github.com/ialexanderlvov/wizard-ssh/commit/be54bf89c92e53e6bda35eee7345d3d5c9b80a61))
* **vault:** delete a saved password and reset the vault ([0743870](https://github.com/ialexanderlvov/wizard-ssh/commit/07438707d0fccbc33cfdc00a3f12ed9626082cdb))
* **vault:** reveal a specific saved password ([0ada3ea](https://github.com/ialexanderlvov/wizard-ssh/commit/0ada3ea37520363a781eb87e9f318c9ff13208ab))
* **vault:** unlock passphrase from the environment ([2e3f2ea](https://github.com/ialexanderlvov/wizard-ssh/commit/2e3f2eac8c35bdf3d3f4057493732ed5467f2b6a))


### Bug Fixes

* **cli:** thread --tmux through fuzzy connect, confirm forget-host, surface corruption ([abb8f93](https://github.com/ialexanderlvov/wizard-ssh/commit/abb8f9308a3eae6f410d93049cbab3493652be40))
* **cli:** validate explicit tunnel --name in non-interactive add ([ecbc813](https://github.com/ialexanderlvov/wizard-ssh/commit/ecbc813f487607f439c7c1b73bff66f0e9731e76))
* **cli:** validate user/key/remote-host in non-interactive create ([6a45149](https://github.com/ialexanderlvov/wizard-ssh/commit/6a45149bbc23c12697ccde4840f56b1f11823626))
* **config:** clean up secrets on host removal and validate edited fields ([4184127](https://github.com/ialexanderlvov/wizard-ssh/commit/4184127641a129f252026319cd70eddd2e75f4ec))
* **import:** reject unsafe records and correct replace-mode wording ([2284a87](https://github.com/ialexanderlvov/wizard-ssh/commit/2284a87120980062ac87ee807ae974b2eca24810))
* **keys:** confine deleteKey to ~/.ssh ([de4cf95](https://github.com/ialexanderlvov/wizard-ssh/commit/de4cf95022365cef86d69d01d8c7affa0942fb01))
* **servers:** record a real updatedAt timestamp on edits ([df118e9](https://github.com/ialexanderlvov/wizard-ssh/commit/df118e952fae573c204db23e1d3da5afe0c8a7d0))
* **ssh-config:** block directive injection at the config writer ([25d0764](https://github.com/ialexanderlvov/wizard-ssh/commit/25d0764e0892af620d1c3c7e2e38136fdaa9dce0))
* **ssh:** harden ssh/scp invocation against option injection ([3659c9b](https://github.com/ialexanderlvov/wizard-ssh/commit/3659c9b6a56efbd484d6a91bf384dfe6ffc72bdc))
* **ssh:** keep the sshpass password from leaking into ssh helpers ([3a5d1f7](https://github.com/ialexanderlvov/wizard-ssh/commit/3a5d1f735eef6ed40a5ccf5c90645fb82a817b75))
* **ssh:** pass the SSH password via sshpass -e instead of a temp file ([bee7528](https://github.com/ialexanderlvov/wizard-ssh/commit/bee7528410e68350f8c4ab956bfd6e42843b0219))
* **ssh:** pin the chosen key with IdentitiesOnly=yes ([6e5ab8c](https://github.com/ialexanderlvov/wizard-ssh/commit/6e5ab8ce3e9948df12a12b0dbfcb63378d96edf2))
* **ssh:** re-arm host-key recovery after a healthy tunnel run ([7d84161](https://github.com/ialexanderlvov/wizard-ssh/commit/7d84161c24662b13e4165fb3567d4561d76074c7))
* **ssh:** validate tmux session name before it reaches the remote shell ([3ce947b](https://github.com/ialexanderlvov/wizard-ssh/commit/3ce947bf9ea3ca1d362de270545900ec43d8a42a))
* **store:** durable atomic writes and PID-reuse-safe sessions ([b9ca88f](https://github.com/ialexanderlvov/wizard-ssh/commit/b9ca88fcf671c22284ffd51afd8b976bd8274684))
* **store:** tighten data-dir and detached-tunnel-log permissions ([89f959e](https://github.com/ialexanderlvov/wizard-ssh/commit/89f959eeb401a786066c90bc720703ffcb140a6f))
* **tunnel:** validate remote host before it reaches the forward spec ([77b3c43](https://github.com/ialexanderlvov/wizard-ssh/commit/77b3c436a8d158feefb0b67d2c9b78eea29a6a29))
* **ui:** remove ~500ms Esc delay in the list prompt ([d0cfec9](https://github.com/ialexanderlvov/wizard-ssh/commit/d0cfec94d1e244fd5697e508f5391db9b2773f5b))
* **ui:** use a single space after every menu emoji ([3b68eb3](https://github.com/ialexanderlvov/wizard-ssh/commit/3b68eb3f5935883199da7d7b59d684ff97f6f7d2))
* **validators:** harden input validation against injection ([85c3712](https://github.com/ialexanderlvov/wizard-ssh/commit/85c3712e7cfb393f6c90632444588e486d5b6977))
* **vault:** always show reveal/delete password actions ([fbc7971](https://github.com/ialexanderlvov/wizard-ssh/commit/fbc79715339dac1de1bac962abd0557284f1e8ff))
* **vault:** bound KDF params to reject hostile or broken vaults ([9f97153](https://github.com/ialexanderlvov/wizard-ssh/commit/9f97153b7149bc88ae7e977ea59d8b26da9b8c11))
* **vault:** defer credential mutations until an edit commits ([2923050](https://github.com/ialexanderlvov/wizard-ssh/commit/2923050c56715005c14db7995bee13cca314537e))
* **vault:** store the master key in the Keychain via stdin, not argv ([fb560d7](https://github.com/ialexanderlvov/wizard-ssh/commit/fb560d78293e12a8387b7144702bace520b5a749))
* **vault:** stronger KDF, key zeroization and strict file shape ([389e5b5](https://github.com/ialexanderlvov/wizard-ssh/commit/389e5b554a16e11906586b11858a688f548172bd))


### Code Refactoring

* **commands:** treat servers as ~/.ssh/config hosts; merge the menus ([5021f92](https://github.com/ialexanderlvov/wizard-ssh/commit/5021f92f90d5262bb4f4132276d88c853e7662aa))
* **i18n:** route all CLI strings through the translation store ([fd2cf7d](https://github.com/ialexanderlvov/wizard-ssh/commit/fd2cf7db2517fdbe2d42a761aeee12865fbb9d86))
* **ssh:** extract a shared `ssh -G` output parser ([ec50aa4](https://github.com/ialexanderlvov/wizard-ssh/commit/ec50aa439203eb521da391c47224bfa4e82d8844))
* **ui:** rebuild menus and pickers on the list prompt ([64d27e6](https://github.com/ialexanderlvov/wizard-ssh/commit/64d27e61abb8e276bab46a8eace92338170c4911))


### Documentation

* add README and install/usage guides ([8d21ab4](https://github.com/ialexanderlvov/wizard-ssh/commit/8d21ab4e45d714d628a14257ab2a8e8b0ecf43b6))
* document list navigation, vault reset and quick tunnel ([c6c01a6](https://github.com/ialexanderlvov/wizard-ssh/commit/c6c01a6d9e248017d48cc38a7dfcc8ffa24a80b7))
* document new commands and scripting ([e22fb2a](https://github.com/ialexanderlvov/wizard-ssh/commit/e22fb2a6fa5d0f1ddcc5ef6ae38c53da0450613b))
* **i18n:** document UI language selection (WSSH_LANG) ([70b399e](https://github.com/ialexanderlvov/wizard-ssh/commit/70b399e300ab7abe95fc6d28f5b81f1f55d33fa7))
* note security-key types and known_hosts management ([3ddf3db](https://github.com/ialexanderlvov/wizard-ssh/commit/3ddf3dbea53cba8970b759e17725f85478c14de9))
* servers live in ~/.ssh/config (#wssh annotations, migration) ([3c3f6ea](https://github.com/ialexanderlvov/wizard-ssh/commit/3c3f6eaeaf765c6f579eac64bbe192332fadfbd9))
* use pnpm in install and usage guides ([4e09e8c](https://github.com/ialexanderlvov/wizard-ssh/commit/4e09e8cb549e54a386ecaba55616dd328ca96aa0))

## 1.0.0 (2026-06-04)

### Features

- Interactive CLI to manage SSH servers, tunnels and `~/.ssh/config` (CRUD,
  fuzzy search, instant connect).
- Forward (`-L`), reverse (`-R`) and dynamic (`-D`) tunnels with detached mode.
- Encrypted password vault (AES-256-GCM) with optional Touch ID unlock on macOS.
- Non-interactive / scriptable mode (`--yes`, `--non-interactive`).
- `~/.ssh/config` import/export and `doctor`/`check` diagnostics.
