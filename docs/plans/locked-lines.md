# Plan: leave locked lines out of the search score

Status: approved for execution. The executor deletes this file in the pull request that executes it.

## Goal

The search score divides only by lines the proposed codebase build can change. A rebuilt proposed codebase then scores 100% find rate and 100% term distinctiveness on every concept, and the published codebase is scored against the same lines.

## Prerequisites

- The local files the scripts read are present: `truth/truth.json`, `work/published`, `work/proposed`, `work/runs/` with its run copies, `work/tests-published.json`, `work/tests-proposed.json`, and `results/blind-review.csv`.
- Read `AGENTS.md` and `docs/vocabulary.md` in full before the first change.

## Decisions

1. **Locked line.** `docs/vocabulary.md` defines it: a line where every wording of the concept or of its search term is text the codebase cannot change without changing behavior:
   - a name the standard library declares (for example `AbortSignal`, `.abort()`, `throwIfAborted`);
   - a public Ky name that callers use (for example the `signal`, `backoffLimit`, `maxRetryAfter`, and `jitter` options);
   - a string the program outputs or compares at runtime (for example the `'abort'` event name or an error message).

   A comment is never locked. A line that holds a changeable wording next to a locked one is not locked.
2. **One list, in the concept configuration.** Each concept in `config/concepts.json` gains a required `lockedLines` array. Each entry holds `file`, `line`, `text` (the locked text, as it appears on the line), and `reason`. An empty array is allowed. A concept without the key stops the search-score script, so a misspelled key cannot read as "nothing locked".
3. **Both parts of the score.** The search-score script removes a concept's locked lines from its ground truth lines (the find rate denominator) and from its hits (the term distinctiveness denominator), in both versions. Line numbers match between the versions, so one list serves both.
4. **Fail closed.** Before it scores, the search-score script stops with an error naming the entry when the entry's `text` is not on its line in either version. A moved line fails this check, so a stale list never reaches the score.
5. **No count in the results.** The search score output keeps its current columns. The list and its reasons are the record.
6. **Scope.** The search score only. The agent score, the ground truth, and the rename task's target lines stay as they are.

## Steps

### `feature/locked-lines`

1. **Tests first** in `scripts/lib.test.mjs` (RED):
   - `readLockedLines(concepts, readLine)` returns a map from concept id to its set of line keys. It throws on a concept without `lockedLines`, on an entry missing `file`, `line`, `text`, or `reason`, and on an entry whose text `readLine` does not return on its line. `readLine(file, line)` reads the line from one version.
   - `searchScore(expected, hits, locked)` returns `found`, `truthLines`, `hits`, `findRate`, and `termDistinctiveness`, with locked lines removed from `expected` and `hits` before either ratio.
2. **Scoring.** In `scripts/search-score.mjs`, read the lists once per version, so every entry is checked in both, and score through `searchScore`. A locked line is no miss, so `misses-<version>.csv` leaves it out.
3. **The lists.** Fill `lockedLines` for each concept from `results/misses-proposed.csv` and from the proposed codebase hits outside the ground truth, applying Decision 1 line by line. Each entry states its reason.
4. **The edits.** Add renames and wording edits to `config/proposed-edits.json` for every miss and every hit outside the ground truth that the lists leave. For example, Ky's own timeout abort names (`#abortController`, `supportsAbortController`) get renamed so the `abort` search stops matching them. Rebuild with `node scripts/build-proposed.mjs`; it must report matching type checks and test results.
5. **Confirm 100%.** Run `node scripts/search-score.mjs`. Every concept in the proposed codebase reports 100% find rate and 100% term distinctiveness. A concept below 100% sends the executor back to step 3 or step 4; a line goes on a list only when it meets Decision 1.
6. **Vocabulary**, as its own `docs:` commit: update the `find rate`, `term distinctiveness`, and `miss` rows of `docs/vocabulary.md` to say that the search score leaves locked lines out, and the `locked line` row to say that the search-score script reads the lists.
7. **Proposed codebase runs.** The rebuilt proposed codebase no longer matches the 30 proposed runs. Move those runs and their key entries to `work/runs-archive/`, then run `node scripts/run-agents.mjs --versions proposed` (30 runs; the last 60 cost $7.60). Rescore with `caffeinate -i env TMPDIR=work/tmp node scripts/score-agents.mjs` (about 40 minutes), then `node scripts/summarize-agents.mjs` and `node scripts/results-table.mjs`. A person answers `wrong_edits` on the blind review sheet for the 20 new edit runs before the summary.
8. Delete this plan file. Open the pull request. An independent code reviewer passes it before merge.

## Simplicity

1. **Size.** The code grows. Additions: `readLockedLines` (one list per concept, failing closed on a stale entry), `searchScore` (the score with locked lines removed), the `lockedLines` arrays, and new proposed edits (the 100% requirement). Removals: the inline ratio arithmetic in `search-score.mjs`, which moves into `searchScore`.
2. **Duplicates.** The list lives once, in the concept configuration, and the search-score script is its only reader. The build reads no copy of it: it changes what it can, and its type check and test comparison catch an edit that changed behavior.
3. **Removals.** A separate list file could merge into the concept configuration, so it does. A count of locked lines in the output is left out, at the user's request. A check for an entry that removes nothing is left out: the text check already catches a moved line, and such an entry changes no score. Reading and checking the lists are one function, because the search-score script always does both together. No other step, field, or branch can come out without losing a requirement.
4. **Orphans.** None. The inline ratio arithmetic leaves with step 2, and this plan file leaves with step 8.
5. **Bounds.** No new walk, wait, retry, or queue. The check reads each list entry once per version; the configuration bounds the lists. The step 7 runs keep their existing caps: $5 and 30 minutes per run.
6. **Current behavior.** Checked against `main`: the search-score script divides by every ground truth line and every hit; the proposed codebase scores 87–100% find rate and 71–100% term distinctiveness, with 23 misses. The build's type checker project leaves out Ky's tests, so its rule against renames that reach outside the corpus accepts public names such as `signal`; only its test comparison catches a rename of one. Decision 1 lists public Ky names for that reason.
