## What this changes

<!-- One entry per pull request: the path, and the version you bump. -->

- Entry:
- Kind:
- Version:

## Checklist

- [ ] The entry lives in its own directory (or `mcp/<id>.json`) and the id equals the directory or file name.
- [ ] `version` is bumped; a published version is never edited in place.
- [ ] `license` names an SPDX identifier and the content may be redistributed.
- [ ] `minVersion` and `compat` say what actually runs this entry.
- [ ] No secrets, tokens or credentials anywhere in the diff; the gitleaks job is not silenced.
- [ ] `index.json` was regenerated with `node scripts/build-index.mjs` and is part of this diff.
- [ ] `node scripts/build-index.mjs --check` and `node scripts/validate-schemas.mjs` pass locally.
- [ ] Plugins: binaries are GitHub Release URLs with `sha256` and `size`; no binary file is committed.
- [ ] MCP: I read the transport, command, arguments and environment values, and none of them is a placeholder that hides a credential.

## Review lane

<!-- themes and skills: one maintainer after CI. plugins and MCP: a second maintainer for security review. -->

- [ ] Fast lane (themes / skills) — one maintainer approval
- [ ] Security review (plugins / MCP) — second maintainer approval
- [ ] Revocation — security review even for themes / skills
