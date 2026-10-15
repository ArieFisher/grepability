# Plan: leave locked lines out of the search score

Status: approved for execution after `fix/seed-renamed-names` merges. The executor deletes this file in the pull request that executes it.

## Goal

The search score divides only by lines the proposed codebase build can change. A rebuilt proposed codebase then scores 100% find rate and 100% term distinctiveness on every concept, and the published codebase is scored against the same lines.

## Prerequisites

- The local files the scripts read are present: `truth/truth.json`, `work/published`, `work/proposed`, `work/runs/` with its run copies, `work/tests-published.json`, `work/tests-proposed.json`, and `results/blind-review.csv`.
- Read `AGENTS.md` and `docs/vocabulary.md` in full before the first change.

## Decisions

1. **Locked line.** `docs/vocabulary.md` defines it. The rule has two sides:
   - A ground truth line the search misses is locked when no rename or wording edit can make the search term match it without changing behavior.
   - A hit outside the ground truth is locked when no rename or wording edit can stop the search term from matching it without changing behavior.

   Text that no edit can change:
   - a name the standard library declares (for example `AbortSignal`, `.abort()`, `throwIfAborted`);
   - a public Ky name that callers use (for example the `signal`, `backoffLimit`, `maxRetryAfter`, and `jitter` options);
   - a string the program outputs or compares at runtime (for example the `'abort'` event name or an error message);
   - a file path or a URL (for example the `../utils/delay.js` import, or a link to the `sindresorhus/delay` repository).

   A comment is locked when its only concept wording, or its only text the search term matches, names a name from the first two kinds: a name the experiment does not rename. Any other comment gets a wording edit. A code line that holds no wording of the concept at all (for example `normalizedRetry[key]` in the retry delay checks) is locked with the reason "no wording on the line".
2. **One list, in the concept configuration.** Each concept in `config/concepts.json` gains a required `lockedLines` array. Each entry holds `file`, `line`, `text` (the locked text, as it appears on the line), and `reason`. An empty array is allowed. A concept without the key stops the search-score script, so a misspelled key cannot read as "nothing locked".
3. **Both parts of the score.** The search-score script removes a concept's locked lines from its ground truth lines (the find rate denominator) and from its hits (the term distinctiveness denominator), in both versions. Line numbers match between the versions, so one list serves both.
4. **Fail closed.** Before it scores, the search-score script stops with an error naming the entry when the entry's `text` is not on its line in either version. A moved line fails this check, so a stale list never reaches the score.
5. **No count in the results.** The search score output keeps its current columns. The list and its reasons are the record.
6. **Renamed names join the ground truth.** A name that the proposed edits give the concept's term is a concept name, so it is a seed. The `fix/seed-renamed-names` pull request adds the names known today (the four retry timing variables and `#createManagedSignal`) ahead of this plan. A rename that step 5 adds gets its seed in the same step, and the executor reruns `node scripts/ground-truth.mjs`.
7. **Scope.** The search score, and the ground truth seeds that Decision 6 adds. The agent score and the rename task's target lines stay as they are; every agent task uses the retry count concept, so new seeds on other concepts change no agent score.

## Steps

### `feature/locked-lines`

1. **Tests first** (RED):
   - In `scripts/fail-closed.test.mjs`: `readLockedLines(concepts, readLine)` throws on a concept without `lockedLines`, on an entry missing `file`, `line`, `text`, or `reason`, and on an entry whose text is not on the line `readLine(file, line)` returns.
   - In `scripts/lib.test.mjs`: `readLockedLines` returns a map from concept id to its set of line keys; `searchRates(expected, hits, locked)` returns `found`, `truthLines`, `hits`, `findRate`, and `termDistinctiveness`, with locked lines removed from `expected` and `hits` before either ratio. The name `searchScore` already belongs to the harmonic mean in `scripts/results.mjs`.
2. **Scoring.** In `scripts/search-score.mjs`, call `readLockedLines` once per version, with the existing `lineText` as `readLine`, so every entry is checked in both, and score through `searchRates`. A locked line is no miss, so `misses-<version>.csv` leaves it out.
3. **Prerequisite check.** Confirm `fix/seed-renamed-names` is merged and `truth/truth.json` was rebuilt from it.
4. **The lists.** Fill `lockedLines` for each concept from the proposed codebase misses and from its hits outside the ground truth, applying Decision 1 line by line. Each entry states its reason.
5. **The edits.** Add renames and wording edits to `config/proposed-edits.json` for every miss and every hit outside the ground truth that the lists leave. For example, the five comments whose concept wording is a changeable name get reworded. Rebuild with `node scripts/build-proposed.mjs`; it must report matching type checks and test results.
6. **Confirm 100%.** Run `node scripts/search-score.mjs`. Every concept in the proposed codebase reports 100% find rate and 100% term distinctiveness. A concept below 100% sends the executor back to step 4 or step 5; a line goes on a list only when it meets Decision 1.
7. **Documents**, as its own `docs:` commit:
   - `docs/vocabulary.md`: the `find rate`, `term distinctiveness`, and `miss` rows say that the search score leaves locked lines out; the `locked line` row takes the two-sided rule and the four kinds of text from Decision 1, and says that the search-score script reads the lists.
   - `docs/proposed-edits.md`: the worklist is the misses minus the locked lines, and the proposed codebase scores 100% on both parts. Remove the statement that misses stay as a visible residue.
8. **Proposed codebase runs.** The rebuilt proposed codebase no longer matches the 30 proposed runs. Move those run folders to `work/runs-archive/`, and move their entries from `work/runs/key.json` to `work/runs-archive/key.json` by hand; no script edits the key. Then run `node scripts/run-agents.mjs --versions proposed` (30 runs; the last 30 proposed runs cost $3.70). Rescore with `caffeinate -i env TMPDIR=work/tmp node scripts/score-agents.mjs` (about 40 minutes). A person answers `wrong_edits` on the blind review sheet for all 30 new runs, then the executor runs `node scripts/summarize-agents.mjs` and `node scripts/results-table.mjs`. The archived runs' rows stay on the sheet; the summary script reads only rows in the key.
9. Delete this plan file. Open the pull request. An independent code reviewer passes it before merge.

## Simplicity

1. **Size.** The code grows. Additions: `readLockedLines` (one list per concept, failing closed on a stale entry), `searchRates` (the ratios with locked lines removed), the `lockedLines` arrays, new seeds (Decision 6), and new proposed edits (the 100% requirement). Removals: the inline ratio arithmetic in `search-score.mjs`, which moves into `searchRates`.
2. **Duplicates.** The list lives once, in the concept configuration, and the search-score script is its only reader. The build reads no copy of it: it changes what it can, and its type checks and test comparison catch an edit that changed behavior. `readLockedLines` takes the existing `lineText` as its line reader, so the change adds no second one.
3. **Removals.** A separate list file could merge into the concept configuration, so it does. A count of locked lines in the output is left out, at the user's request. A check for an entry that removes nothing is left out: the text check already catches a moved line, and such an entry changes no score. Reading and checking the lists are one function, because the search-score script always does both together. No other step, field, or branch can come out without losing a requirement.
4. **Orphans.** None. The inline ratio arithmetic leaves with step 2, and this plan file leaves with step 9.
5. **Bounds.** No new walk, wait, retry, or queue. The check reads each list entry once per version; the configuration bounds the lists. The step 8 runs keep their existing caps: $5 and 30 minutes per run.
6. **Current behavior.** Checked against `main`: the search-score script divides by every ground truth line and every hit; the proposed codebase scores 87–100% find rate and 71–100% term distinctiveness, with 23 misses. Existing renames put the search term on lines outside the ground truth, because no seed covered the renamed names (Decision 6). The build's type checker project leaves out Ky's tests, so its rule against renames that reach outside the corpus accepts public names such as `signal`; the test type check catches a rename of one. Decision 1 lists public Ky names for that reason. `scripts/results.mjs` and `scripts/results-table.mjs` read only the find rate and term distinctiveness, so they need no change.
