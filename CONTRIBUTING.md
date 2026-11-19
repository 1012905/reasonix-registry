# Contributing

One pull request adds or updates one entry. Everything here is public: manifests,
scripts and environment defaults are read by every user, and a reviewer reads them
as instructions that reach a machine.

## The four templates

### Skill — `skills/<id>/skill.json` + `skills/<id>/SKILL.md`

```json
{
  "id": "my-skill",
  "name": "My Skill",
  "description": "What the skill does, in one sentence.",
  "version": "1.0.0",
  "license": "MIT",
  "author": "Your Name",
  "homepage": "https://example.com",
  "minVersion": "0.1.0",
  "compat": { "platforms": ["any"], "frontends": ["studio", "cli"] }
}
```

`SKILL.md` carries the body; its frontmatter needs `name` (equal to the id) and
`description`. Other files beside it are resources the skill may read.

### Theme — `themes/<id>/theme.json` + `themes/<id>/assets/`

```json
{
  "schemaVersion": 1,
  "id": "my-theme",
  "name": "My Theme",
  "author": "Your Name",
  "description": "One sentence a picker can show.",
  "license": "MIT",
  "version": "1.0.0",
  "minVersion": "0.1.0",
  "compat": { "platforms": ["any"], "frontends": ["studio"] },
  "tokens": {
    "light": { "bg": "#F5F8F7", "fg": "#14231F", "accent": "#17635B" },
    "dark": { "bg": "#0C1518", "fg": "#EAF4F2", "accent": "#63C7B8" }
  },
  "recipes": { "density": "comfortable", "corners": "round" },
  "background": {
    "image": "background.webp",
    "focusX": 0.68,
    "focusY": 0.45,
    "safeArea": "left",
    "homeOpacity": 1.0,
    "taskOpacity": 0.18,
    "overlayStrength": 0.7
  }
}
```

Assets are `assets/background.<webp|png|jpg|jpeg>` and
`assets/preview.<webp|png|jpg|jpeg>`, at most 8 MiB each. A pack is data only —
no stylesheet, script or code.

### MCP — `mcp/<id>.json`

```json
{
  "id": "example",
  "name": "Example",
  "description": "What the server provides, in one sentence.",
  "version": "1.0.0",
  "license": "MIT",
  "minVersion": "0.1.0",
  "compat": { "platforms": ["any"], "frontends": ["studio"] },
  "transport": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@example/mcp-server"],
    "env": { "EXAMPLE_MODE": "read-only" }
  }
}
```

HTTP servers use `"type": "http"` and an `https` `url` instead of a command.
Environment values are defaults visible to everyone; never put a credential there.

### Plugin — `plugins/<id>/plugin.json` + `plugins/<id>/package/`

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "What the plugin adds, in one sentence.",
  "version": "1.0.0",
  "license": "MIT",
  "minVersion": "0.1.0",
  "compat": { "platforms": ["any"], "frontends": ["studio"] },
  "binaries": [
    {
      "platform": "windows-amd64",
      "url": "https://github.com/you/my-plugin/releases/download/v1.0.0/my-plugin-windows-amd64.zip",
      "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "size": 4812345
    }
  ]
}
```

`package/` is the kernel package: `package/reasonix-plugin.json` with
`"apiVersion": "reasonix.io/plugin/v2"`, its `name` equal to the id and its
`version` equal to `plugin.json`'s, plus the files it contributes (`skills/`,
`agents/`, hooks, MCP servers). The kernel parses that manifest strictly, so it
carries kernel fields only; registry metadata stays in `plugin.json`.

## Rules

**Naming.** Ids match `^[a-z0-9][a-z0-9._-]{1,63}$` and equal the directory or
file name. An id is never reused for different content, and never renamed: that
is a new entry, and the old one is revoked.

**Semver.** Every content change bumps `version`. MAJOR: the entry stops doing
what its name says, or existing settings/arguments stop working. MINOR: new
behaviour. PATCH: wording, colours, fixes. A published version is never edited in
place — `main` holds one version per id, and the release tags hold what shipped.

**Compat.** `minVersion` is the oldest app version that understands the entry —
one floor, not a range. `compat.platforms` is a subset of
`windows|macos|linux|any`; `compat.frontends` a subset of `studio|cli`. An app
whose version, platform or frontend is missing the entry's lists does not offer it.

**License.** `license` is an SPDX identifier and the content must be
redistributable under it; include the license text in the entry when the license
requires it. A missing or invented identifier fails CI.

**No secrets.** No token, key, password, cookie, private URL or personal path in
any file. gitleaks runs on the pull request and is not silenced. If a server needs
a credential, name it in the app's settings; the manifest carries no value.

**Plugin binaries.** Binaries live in GitHub Releases and only there: `url` must
be a `https://github.com/<owner>/<repo>/releases/download/...` URL, with the
lowercase `sha256` and the byte `size` of the asset. Committed files must be text;
the size caps and the binary sniff in `build-index.mjs` reject an uploaded
executable.

**MCP manifests are reviewed manually.** A reviewer reads the command, arguments,
environment and URL in full: no shell interpreter as the command, no piping a
remote script into an interpreter, no `http` URL, no flag that widens what the
server can reach beyond what the description claims.

## Review ladder

| Kind | After CI passes | Second approval |
| --- | --- | --- |
| themes, skills | one maintainer | not required, unless the diff also touches `revoked.json` |
| plugins, MCP | one maintainer | security review by a second maintainer |
| `revoked.json`, `.github/`, `scripts/`, `schemas/` | — | security review, always |

CODEOWNERS names both owners; GitHub requests both reviews. Merge only when the
required lane is satisfied — a security-reviewed entry is not expedited by asking
in the PR.

## Revocation

Revocation is the only way to withdraw content and it never rewrites history:

```json
{
  "revocations": [
    {
      "kind": "plugins",
      "id": "audit-kit",
      "versions": ["1.0.0"],
      "reason": "Uploads workspace files to an undeclared endpoint.",
      "date": "2026-11-19"
    }
  ]
}
```

- Append a record; never edit or delete an existing one without security review.
- `versions` names exact affected versions. `"*"` covers every version and is the
  full-takedown form.
- Publish a fixed version and the entry's `revoked` returns to `false` by itself,
  because the check compares versions rather than remembering a flag.
- Do not delete an entry to withdraw it: the row would silently disappear from
  `index.json`. Revoke first, and remove the content in a later release if it must
  go; the old release still carries the record.

## Before you open the pull request

```bash
node scripts/build-index.mjs          # commit the regenerated index.json
node scripts/build-index.mjs --check
node scripts/build-index.mjs --caps
node scripts/validate-schemas.mjs
```

The pull request must touch one entry (plus `index.json`). CI fails a stale index,
an unknown field, a missing license, a bad digest, an oversized entry, a committed
binary, and a secret.
