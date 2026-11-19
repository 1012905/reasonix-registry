---
name: release-notes
description: Draft release notes from the commits and merged pull requests since a tag.
triggers: release notes, changelog, 发布说明, 更新日志
argument-hint: "[from-tag]"
---

# Release Notes

Turn the history since a tag into notes a user can read.

1. Take the starting tag from the command argument when one is given; otherwise use the
   latest tag. If neither exists, ask for a tag instead of guessing.
2. Read the range: `git log <tag>..HEAD --pretty=format:'%h %s'`, and the merge subjects
   with `git log <tag>..HEAD --merges --pretty=format:'%s'`.
3. Group the user-visible effect into Added, Changed, Fixed and Removed. Drop commits that
   only touch tests, CI or formatting.
4. Lead each line with the effect rather than the file: "Skills load from `.agents/skills`",
   not "update skill loader". Link a pull request number when the subject carries one.
5. Keep the whole summary under 40 lines. When the range holds no user-visible change, say
   so instead of padding the list.

Do not invent entries, do not reorder by commit date, and do not add contributor handles
the commits do not already name.
