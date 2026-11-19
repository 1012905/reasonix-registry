---
name: audit
description: Report risky changes in the working tree before they are committed.
triggers: audit changes, risky diff, 审查改动
---

# Audit Changes

Read the diff first, then report.

1. Collect the change: `git status --short` and `git diff --stat HEAD`.
2. Flag, with the file and line, any change that: adds a dependency or bumps one across a
   major version, writes a credential into a tracked file, weakens an authorisation check,
   disables a test, or changes a release or CI workflow.
3. Rank findings by what they would break in production, not by diff size.
4. State what you did not inspect — generated files, vendored trees, binaries — instead of
   implying full coverage.

Report nothing you have not read. An empty report is a valid answer when the diff is clean.
