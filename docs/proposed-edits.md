# Proposed edits

The proposed codebase build (`scripts/build-proposed.mjs`) applies the edit list to the published codebase and produces the proposed codebase. The list lives in `config/proposed-edits.json`. This document states what an edit may do and how to change the list. The list stays in the configuration only, so no second copy exists to drift.

## The two kinds of edit

| Kind | Where in the list | Fields | What the build does |
|---|---|---|---|
| rename | `renames` | `concept`, `file`, `line`, `name`, `nth` (optional), `newName` | Reads every location of the name from the type checker and replaces each one, so every reference changes and nothing else does. `nth` picks a later occurrence of the name on the line. |
| wording edit | `comments` | `concept`, `file`, `line`, `from`, `to` | Replaces the exact text `from` with `to` on one line of a comment or string. The text `from` must occur exactly once on that line. |

The `comments` array holds the wording edits. Its name predates the vocabulary term.

## Rules every edit follows

1. **Each edit belongs to one concept.** The edit records the concept in `concept`, and its new wording matches that concept's search term.
2. **Line numbers stay the same.** No edit adds or removes a line, so every ground truth line maps to the same line in the proposed codebase. The build stops when a file's line count changes.
3. **Behavior stays the same.** Public option names, platform names, and error message strings stay as they are. The build compiles the proposed codebase from its own source, then requires the same type check result and the same result for every test as the published codebase. A test that both passes and fails across reruns in both versions counts as flaky and is ignored.
4. **No edit applies to the control concept.** Its wording is already consistent, so its scores show the values that hold when nothing needs fixing.

## Where the edits come from

The search-score script writes the lines each search missed in the published codebase. Each miss is a name line or a text line.

- A name line miss is a candidate for a rename.
- A text line miss is a candidate for a wording edit.

An edit is worth adding when the new wording makes the concept's search term match the line, within the rules above.

## What the list leaves out

The list covers some misses and leaves others. After each build, the search-score script writes the lines that the proposed codebase still misses, so the residue is visible. Further rewording would move the proposed codebase further from the published one, which changes what the experiment measures. Revisit the list after the first agent runs, when the agent score shows whether the residue matters.

## Changing the list

1. Edit `config/proposed-edits.json`.
2. Run `node scripts/build-proposed.mjs`. It applies the edits, checks the line counts, compiles the proposed codebase, and compares type check and test results with the published codebase.
3. Run `node scripts/search-score.mjs`. It writes the find rate and term distinctiveness of both versions and the remaining misses.
4. Commit the list and any regenerated results together.
