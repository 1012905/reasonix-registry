# Reasonix Registry

Curated skills, themes, MCP server manifests and plugins for Reasonix Studio.
Content enters by pull request, CI validates it, and every merge to `main`
publishes a minisign-signed `index.json`. This repository replaces the retired
account-gated market: there is no account, no upload endpoint, and no server to
run.

```
skills/<id>/SKILL.md          skill body with YAML frontmatter
skills/<id>/skill.json        registry metadata
themes/<id>/theme.json        theme pack, read by the kernel as-is
themes/<id>/assets/           background.<ext> / preview.<ext>
mcp/<id>.json                 one MCP server manifest
plugins/<id>/plugin.json      registry descriptor
plugins/<id>/package/         the kernel package (reasonix-plugin.json + files)
index.json                    generated catalogue, committed for review
revoked.json                  append-only revocation records
schemas/                      JSON Schema for every manifest and the index
scripts/build-index.mjs       builds and checks index.json
scripts/validate-schemas.mjs  dependency-free schema gate
registry.pub                  minisign public key, same key as app updates
```

## What the app reads

The distributed artefacts are the assets of the newest release:

```
https://github.com/<owner>/reasonix-registry/releases/latest/download/index.json
https://github.com/<owner>/reasonix-registry/releases/latest/download/index.json.minisig
```

The client, in order:

1. Fetch both files and keep the index bytes exactly as received.
2. Verify `index.json.minisig` over those bytes with the embedded minisign key
   (`internal/platform/update.Verify` in the kernel). A failure means discard the
   index and keep the last good one.
3. Resolve every path against
   `https://raw.githubusercontent.com/<owner>/reasonix-registry/main/`. Paths are
   repository-relative on purpose, so a fork's index stays valid; `url` locates
   the entry, `files` lists what it contains.
4. Fetch each file, hash it, and require its digest and size to match the entry's
   `files` row before writing anything. Then rebuild the listing described below
   and compare it with the entry's `sha256`. A mismatch means the index on `main`
   moved after the release, or the content was tampered with. Refetching the
   index resolves the first case.
5. Offer an entry only when the running app version is at least `minVersion` and
   its platform and frontend appear in `compat`, and only when `revoked` is
   `false`.

`index.json` in `main` is the review artefact and the input to signing; the
release asset is the distribution channel. Publish verifies the committed index
is current before signing it, so the bytes a reviewer approved are the bytes the
key covers.

## Entry digest

`sha256` in the index covers the whole entry directory:

1. Take every committed file below the entry path. Skip `.gitkeep`, `.DS_Store`
   and `Thumbs.db`.
2. Sort the files by repository-relative path, forward slashes, byte order.
3. For each file, hash its bytes with SHA-256 and render one line:
   `<sha256 of the file><TAB><path><LF>`.
4. Hash that listing as UTF-8 with SHA-256. That hex string is the entry's
   `sha256`.

The listing is the contract, so the index carries it as `files` (path, SHA-256 and
size per file) — a static host cannot list a directory, and without the list a
client could not verify what it downloaded. The aggregate digest binds the list to
the entry; both are checked.

## Signing key

The registry is signed with the same minisign key as Reasonix app updates, ID
`AF12CA46F4A9EBB0`; the public half is committed as `registry.pub` and embedded
in the kernel. The private half exists only as the `MINISIGN_PRIVATE_KEY` and
`MINISIGN_PASSWORD` secrets of this repository. Rotating the key means changing
the kernel constant, `registry.pub`, and both secrets in one release.

## Publishing

On every push to `main` that touches content, `publish.yml` re-checks the committed
index, signs it, and creates a release tagged `registry-<timestamp>` with
`index.json` and `index.json.minisig` attached. Release assets rather than a bot
commit, because:

- the signed snapshot is immutable and addressable by tag, while a second commit
  on `main` would need a branch-protection exception for a machine account;
- `releases/latest/download/...` is one stable URL for the client;
- a revocation or a new version is a new release, never a rewrite of the old one.

The cost is one duplicated `index.json` (git and release). The git copy is the
review input; only the release copy is signed and served.

## Adding content

See [CONTRIBUTING.md](CONTRIBUTING.md). The short loop:

```bash
node scripts/build-index.mjs          # rewrite index.json
node scripts/build-index.mjs --check  # what CI fails on
node scripts/build-index.mjs --caps   # per-entry byte and file counts
node scripts/validate-schemas.mjs     # schemas/ against every manifest
```

Node 24, no dependencies, no install step.

`scripts/validate-schemas.mjs` implements the JSON Schema subset these schemas
use: `type`, `required`, `properties`, `additionalProperties`, `items`, `enum`,
`const`, `pattern`, string length, numeric bounds and array bounds. A schema that
needs another keyword extends the validator in the same pull request; there is no
npm install and no lockfile to trust.
