# Plan: agent results by line kind

Status: approved for execution. The pull request that ships step 2 deletes this file.

## Goal

The agent summary and the per-run results report, for each run, how many ground truth lines of each kind the agent found (find tasks) or changed (edit tasks), next to how many lines of that kind the task holds. A kind is one of: comment, string, or the kind of declaration a name refers to (property, parameter, variable, function, type).

Example for the retry count concept today: 38 comment lines, 15 property lines, 2 parameter lines. With these counts, a reader can see which kinds of text each version helps or hurts an agent to find.

## Prerequisites

- The branch `fix/renamed-test-titles` is merged to `main`. Without it, the scorer counts every renamed test title as a regression during the step 2 rescore, and the rescore takes hours.
- The local files the scripts read are present: `truth/review-sheet.csv`, `truth/reviewer-*.csv`, `truth/adjudication.csv`, `work/published`, `work/proposed`, `work/runs/` with its run copies, `work/tests-published.json`, `work/tests-proposed.json`, and `results/blind-review.csv` with every `wrong_edits` answer filled.
- Read `AGENTS.md` and `docs/vocabulary.md` in full before the first change.

## Decisions

1. **Kinds and labels.** Text lines take the `kind` column of the review sheet, which `extract-review-sheet.mjs` already writes: `comment` or `string`. Name lines take the declaration kind that the TypeScript language service reports for each reference (`symbol.definition.kind`, a `ts.ScriptElementKind` value), mapped to one report label:

   | Label | TypeScript kinds |
   |---|---|
   | property | `property`, `getter`, `setter`, `enum member` |
   | parameter | `parameter` |
   | variable | `var`, `let`, `const`, `local var`, `using`, `await using` |
   | function | `function`, `local function`, `method`, `constructor` |
   | type | `type`, `interface`, `class`, `local class`, `enum`, `type parameter` |

   The map lives once, as a constant in `scripts/helpers.mjs`. A TypeScript kind the map lacks stops the ground truth build with an error that names the kind and the line, so the build never drops a line silently. Whoever hits the error adds the kind to the map with its label.

2. **A line with more than one kind**: the scorer counts it once under each kind it holds. Per-kind counts can then sum to more than the line total; `summarize-agents.mjs` prints that note under its table. No line of the retry count concept holds two kinds today.

3. **Scope.** The breakdown covers agent runs of every task: find runs (lines listed), and edit runs (target lines changed, for both the rename task and the required lines of the retry count start task). The search score and the results table stay as they are. The misses files of the search score keep their `name` and `text` values.

## Steps

### Step 1: `refactor/truth-accessors` (no behavior change)

Two scripts read the ground truth arrays directly: `score-agents.mjs` (reads `all` twice and `names` once) and `search-score.mjs` (reads `all` once and `names` once). The executor removes those arrays in step 2, so in step 1 both scripts move to accessors.

1. Add to `scripts/helpers.mjs`:
   - `truthLines(entry)`: the sorted line keys of one concept's ground truth.
   - `isNameLine(entry, lineKey)`: whether the line holds a name.
2. Write unit tests for both in `scripts/lib.test.mjs` first (RED), against today's shape `{names, text, all}`.
3. Replace each direct read in `score-agents.mjs` and `search-score.mjs` with the accessors.
4. Run `TMPDIR=work/tmp node --test scripts/`. Rerun `node scripts/search-score.mjs` and confirm `results/search-score.json` and both misses files are byte-identical to the files before the change.
5. Open the pull request. An independent code reviewer passes it before merge.

### Step 2: `feature/line-kinds`

1. **Tests first** in `scripts/lib.test.mjs`:
   - `lineKindLabel(scriptElementKind)` returns the label from the map and throws on an unmapped kind.
   - `truthLines` and `isNameLine` against the new shape.
   - `kindTally(targetLines, hitLines, kindsByLine)` returns, per label, `{lines, hit}`; it counts a line with two kinds under both; a label with no target lines is absent.
2. **Ground truth shape.** In `ground-truth.mjs`, replace `names`, `text`, and `all` of each concept with one map, `lines`, from line key to its sorted list of labels, with keys sorted by file and line. Name labels come from `lineKindLabel(symbol.definition.kind)` for each reference; text labels come from the review sheet row of each tagged line (the `kind` column; the reviewer files copy it from the sheet). The console summary prints the count per label. Update `truthLines` and `isNameLine` to read the new shape. A name label is any label except `comment` and `string`.
3. **Rebuild** with `node scripts/ground-truth.mjs`. Confirm that the set of line keys per concept and the set of name lines per concept equal the old `all` and `names` (compare against a copy of `truth/truth.json` saved under `work/tmp/` before the rebuild).
4. **Scoring.** In `score-agents.mjs`, add `byKind` to each scored row: `kindTally` of the target lines (find: the ground truth lines; edit: the task's target lines, as today) and the hit lines (find: lines listed; edit: target lines changed).
5. **Outputs.** In `summarize-agents.mjs`:
   - `agent-runs.csv` gains two columns per label, in the label order of the map: `<label>Lines` and `<label>Hit` (for example `propertyLines`, `propertyHit`). Each cell holds one number. For a label the task lacks, the script leaves both cells empty.
   - Add `targetLines` to find-run rows, so every run row states its line total.
   - `agent-summary.md` gains a second table, "Lines by kind": one row per task, version, and label, with the columns Lines (in the task) and Mean hit. Each cell holds one count, never "hit/lines".
6. **Vocabulary.** Define `line kind` in `docs/vocabulary.md` as its own `docs:` commit: "The kind of text a ground truth line holds: a comment, a string, or the kind of declaration a name refers to." Do not list the labels there; the map in the code is the only list. Update the `name line` and `text line` rows if their wording no longer matches.
7. **Rescore** with `caffeinate -i env TMPDIR=work/tmp node scripts/score-agents.mjs` (about 40 minutes; the scorer reruns every test suite, and `caffeinate` stops the Mac from sleeping, which otherwise cuts a test file short). Then run `node scripts/summarize-agents.mjs` and `node scripts/results-table.mjs`. `score-agents.mjs` keeps every answer on the blind review sheet.
8. Delete this plan file. Open the pull request. An independent code reviewer passes it before merge.

## Simplicity

1. **Size.** The code grows. Step 1 additions: two accessors. Step 1 removals: five direct reads. Step 2 additions: the label map (requirement: name kinds), `lineKindLabel` (fail closed on an unknown kind), `kindTally` (per-kind counts), the `byKind` field (per-run counts), two CSV columns per label and one summary table (the report the user asked for). Step 2 removals: the three arrays `names`, `text`, and `all`, replaced by the single `lines` map.
2. **Duplicates.** The ground truth holds the name and text split twice today: `all` is the union of `names` and `text`. Kinds stored beside them would make a fourth copy. In step 2 the executor replaces all three with one map. Step 1 moves the readers behind accessors first, in its own pull request, so a passing run of the existing suite confirms the move changes no behavior.
3. **Removals.** `targetLines` for find rows could come out, but the user asked for every run row to state its line total. No step, field, setting, or branch the plan adds can come out without losing a requirement.
4. **Orphans.** After step 2, nothing reads `names`, `text`, or `all`; the plan removes them. The plan file is removed in step 2.
5. **Bounds.** New waits, retries, or queues: none. The seeds in `config/concepts.json` bound the walk over references. The scorer keeps its existing bounds during the rescore: one test-suite run per edit run, three reruns per failed test, one rerun per lost test title.
6. **Current behavior.** Checked against the code on `main`: the review sheet has a `kind` column with `comment` and `string`; `ground-truth.mjs` writes `names`, `text`, and `all`; `score-agents.mjs` picks rename targets from `names` or the concept's `forms`; `summarize-agents.mjs` writes `agent-runs.csv` with no per-kind columns and no `targetLines` for find runs; `search-score.mjs` labels each miss `name` or `text`. The language service reports `property` for the 15 property lines and `parameter` for the 2 parameter lines of the retry count concept.
