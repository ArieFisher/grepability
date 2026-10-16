# Plan: agent results by line kind

Status: approved for execution. The executor deletes this file in the step 2 pull request.

## Goal

For each run, the summary script reports how many ground truth lines of each line kind the agent found (find tasks) or changed (edit tasks), next to how many lines of that line kind the task holds. `docs/vocabulary.md` defines the line kinds in its line kinds table: comment, string, property, parameter, variable, function, type, and other.

Example for the retry count concept today: 38 comment lines, 15 property lines, 2 parameter lines. With these counts, a reader can see which kinds of text each version helps or hurts an agent to find.

## Prerequisites

- The branch `fix/renamed-test-titles` is merged to `main`. Without it, the scoring script counts every renamed test as a regression during the step 2 rescore, and the rescore takes hours.
- The local files the scripts read are present: `truth/review-sheet.csv`, `truth/reviewer-*.csv`, `truth/adjudication.csv`, `work/published`, `work/proposed`, `work/runs/` with its run copies, `work/tests-published.json`, `work/tests-proposed.json`, and `results/blind-review.csv` with every `wrong_edits` answer filled.
- Read `AGENTS.md` and `docs/vocabulary.md` in full before the first change.

## Decisions

1. **One list of line kinds.** The line kinds table in `docs/vocabulary.md` is the only list. Its TypeScript kinds column holds the mapping from a declaration kind (`symbol.definition.kind` from the TypeScript language service, a `ts.ScriptElementKind` value) to a line kind. `ground-truth.mjs` parses that table and holds no copy. The parse fails closed: a missing table, a renamed heading, a missing column, or a table with no rows stops the build with an error, because "found nothing" and "nothing to map" look identical from outside.
2. **Text lines** take the `kind` column of the review sheet, which `extract-review-sheet.mjs` already writes: `comment` or `string`.
3. **The `other` line kind.** A declaration kind that the TypeScript kinds column lacks maps to `other`. The build keeps the line and never stops on it. The build prints each declaration kind it mapped to `other`, with its line count, so a reader can add the declaration kind to the table.
4. **A line with two line kinds** has both. The scoring script counts it once under each, so per-kind counts can sum to more than the line total; `summarize-agents.mjs` prints that note under its table. No line of the retry count concept holds two line kinds today.
5. **Scope.** The breakdown covers agent runs of every task: find runs (ground truth lines found) and edit runs (target lines or required lines changed). The search score and the results table stay as they are. The misses files of the search score keep their `name` and `text` values.

## Steps

### Step 1: `refactor/truth-accessors` (no behavior change)

Two scripts read the ground truth arrays directly: `score-agents.mjs` (reads `all` twice and `names` once) and `search-score.mjs` (reads `all` once and `names` once). The executor removes those arrays in step 2, so in step 1 both scripts move to accessors.

1. Add to `scripts/helpers.mjs`:
   - `truthLines(entry)`: the sorted line keys of one concept's ground truth.
   - `isNameLine(entry, lineKey)`: whether the line is a name line.
2. Write unit tests for both in `scripts/lib.test.mjs` first (RED), against today's shape `{names, text, all}`.
3. Replace each direct read in `score-agents.mjs` and `search-score.mjs` with the accessors.
4. Run `TMPDIR=work/tmp node --test scripts/`. Rerun `node scripts/search-score.mjs` and confirm `results/search-score.json` and both misses files are byte-identical to the files before the change.
5. Open the pull request. An independent code reviewer passes it before merge.

### Step 2: `feature/line-kinds`

1. **Tests first** in `scripts/lib.test.mjs`:
   - `readLineKinds(markdown)` returns the mapping from declaration kind to line kind and the list of line kinds in table order, and throws on a missing table, a missing column, or a table with no rows.
   - `lineKindOf(declarationKind, mapping)` returns the mapped line kind, and `other` for a declaration kind the mapping lacks.
   - `truthLines` and `isNameLine` against the new shape.
   - `kindTally(lines, doneLines, kindsByLine)` returns, per line kind, `{lines, done}`: the count of `lines` with that line kind, and how many of them are in `doneLines`. It counts a line with two line kinds under both. A line kind with no lines is absent.
2. **Ground truth shape.** In `ground-truth.mjs`, replace `names`, `text`, and `all` of each concept with one map, `lines`, from line key to its sorted list of line kinds, with keys sorted by file and line. Name lines take `lineKindOf(symbol.definition.kind)` for each reference. Text lines take the review sheet `kind` of the line (the reviewer files copy it from the review sheet). The console summary prints the count per line kind, then each declaration kind mapped to `other` with its line count. Update `truthLines` and `isNameLine` to read the new shape: a name line holds any line kind except `comment` and `string`.
3. **Rebuild** with `node scripts/ground-truth.mjs`. Confirm that the set of line keys per concept and the set of name lines per concept equal the old `all` and `names` (compare against a copy of `truth/truth.json` saved under `work/tmp/` before the rebuild).
4. **Scoring.** In `score-agents.mjs`, add `byKind` to each scored row: `kindTally` of the lines the task covers (find: the ground truth lines; edit: the target lines or required lines, as today) and the lines the agent covered (find: true positives; edit: lines changed).
5. **Outputs.** In `summarize-agents.mjs`:
   - `agent-runs.csv` gains three columns per line kind, in table order: `<kind>Lines`, `<kind>TruePositives`, and `<kind>Changed` (for example `propertyLines`, `propertyTruePositives`, `propertyChanged`). Each cell holds one number. A find run leaves `<kind>Changed` empty, an edit run leaves `<kind>TruePositives` empty, and a line kind the task lacks leaves all three empty.
   - Add `targetLines` to find-run rows, so every run row states its line total.
   - `agent-summary.md` gains a second table, "Lines by line kind": one row per task, version, and line kind, with the columns Lines, Mean true positives, and Mean changed. Each cell holds one number, never "true positives/lines".
6. **Vocabulary**, as its own `docs:` commit: in the line kinds section of `docs/vocabulary.md`, state that the ground truth script reads the TypeScript kinds column, and that it prints each declaration kind it mapped to `other`. Update the `name line` and `text line` rows if their wording no longer matches.
7. **Rescore** with `caffeinate -i env TMPDIR=work/tmp node scripts/score-agents.mjs` (about 40 minutes; the scoring script reruns every test suite, and `caffeinate` keeps the Mac awake, because sleep cuts a test file short). Then run `node scripts/summarize-agents.mjs` and `node scripts/results-table.mjs`. `score-agents.mjs` keeps every answer on the blind review sheet.
8. Delete this plan file. Open the pull request. An independent code reviewer passes it before merge.

## Simplicity

1. **Size.** The code grows. Step 1 additions: two accessors. Step 1 removals: five direct reads. Step 2 additions: `readLineKinds` (one list, in the vocabulary), `lineKindOf` (name line kinds, with `other`), `kindTally` (per-kind counts), the `byKind` field (per-run counts), three CSV columns per line kind and one summary table (the report the user asked for). Step 2 removals: the three arrays `names`, `text`, and `all`, replaced by the single `lines` map.
2. **Duplicates.** The ground truth holds the name and text split twice today: `all` is the union of `names` and `text`. Line kinds stored beside them would make a fourth copy. In step 2 the executor replaces all three with one map. Step 1 moves the readers behind accessors first, in its own pull request, so a passing run of the existing suite confirms the move changes no behavior. The mapping from declaration kind to line kind lives once, in the vocabulary table, and the code parses it.
3. **Removals.** `targetLines` for find rows could come out, but the user asked for every run row to state its line total. The `TruePositives` and `Changed` columns could merge into one, but a true positive and a changed line are different things in the vocabulary. No other step, field, setting, or branch can come out without losing a requirement.
4. **Orphans.** After step 2, nothing reads `names`, `text`, or `all`; the executor removes them in step 2, along with this plan file.
5. **Bounds.** New waits, retries, or queues: none. The seeds in `config/concepts.json` bound the walk over references. The scoring script keeps its existing bounds during the rescore: one test-suite run per edit run, three reruns per failing test, one rerun per lost title.
6. **Current behavior.** Checked against the code on `main`: the review sheet has a `kind` column with `comment` and `string`; `ground-truth.mjs` writes `names`, `text`, and `all`; `score-agents.mjs` picks rename task target lines from `names` or the concept's `forms`; `summarize-agents.mjs` writes `agent-runs.csv` with no per-kind columns and no `targetLines` for find runs; `search-score.mjs` labels each miss `name` or `text`. The language service reports `property` for the 15 property lines and `parameter` for the 2 parameter lines of the retry count concept.
