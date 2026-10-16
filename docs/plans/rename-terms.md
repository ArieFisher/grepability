# Plan: one name per concept on every surface

Status: approved for execution, refreshed on 2026-10-16. The executor deletes this file in the pull request that ships the rename.

## Goal

Each concept below gets one name, and that name appears on every surface: the vocabulary, the README, `AGENTS.md`, the other docs, code comments, identifiers, file and folder names, configuration keys, result-file columns, and self-test names. The old names move to the Retired column of `docs/vocabulary.md`. This repository measures how scattered names make a concept hard to find; its own code follows the same rule.

A vocabulary definition states what a concept is. It holds no mechanism: no script that runs a step, no diff, no check. Code comments hold the mechanisms. The README links to `docs/vocabulary.md` for definitions and holds no glossary of its own.

## Prerequisites

- The branch builds on the line-kinds branch, because the rename covers the terms and columns that branch adds. Pull requests #15, #16, #17, #18, and the line-kinds pull request merge first; until they do, the rename branch stacks on the line-kinds branch and retargets to `main` after them.
- Read `AGENTS.md` and `docs/vocabulary.md` in full before the first change.

## Term map

| Concept | Old names | New name (prose) | Identifier form |
|---|---|---|---|
| One of the codebase's own checks | test, codebase test, Ky test | individual codebase verification | `verification` |
| All of them together | test suite, tests | codebase verification suite | `verificationSuite` |
| Executing all of them once | test run, suite run | codebase verification suite execution | `suiteExecution` |
| Executing one again | rerun, test rerun | individual codebase verification re-execution | `reexecution` |
| The results of the suite on a codebase version before any agent edit | baseline | pre-edit codebase verification suite results | `preEditResults` |
| An individual codebase verification that passed before the agent's edit and fails after it | regression, test regression | edit regression | `editRegression` |
| The name the suite prints for one individual codebase verification | test title | verification title | `verificationTitle` |
| A verification title the pre-edit results hold and an agent task run's results lack | lost title | lost verification title | `lostVerificationTitle` |
| A verification title an agent task run's results hold and the pre-edit results lack | new title | new verification title | `newVerificationTitle` |
| An individual codebase verification whose title an agent task run changed | renamed test | renamed verification | `renamedVerification` |
| A lost verification title with no pair, that fails its re-execution | removed test | removed verification | `removedVerification` |
| An individual codebase verification that both passes and fails across re-executions | flaky, flaky test | flaky verification | `flakyVerification` |
| Our check, copied in after the agent finishes, that the edit task's goal was met | hidden test | withheld acceptance test | `withheldAcceptanceTest` |
| This project's own tests of its scripts | unit tests, harness tests | self-test | `selfTest` |
| Published codebase or proposed codebase | version | codebase version | `codebaseVersion` |
| One agent attempt at one task | run, agent run | agent task run | `agentTaskRun` |
| An agent task run on this machine | local run | local agent task run | `localAgentTaskRun` |
| An agent task run in a Claude cloud environment | cloud run | cloud agent task run | `cloudAgentTaskRun` |
| A search command the agent used | search call | agent search tool call | `agentSearchToolCall` |
| The one regular expression that stands for a concept in a search | search term | proposed search pattern | `proposedSearchPattern` |
| The patterns that match every wording of a concept in the published codebase | forms | published search pattern | `publishedSearchPattern` |
| One scripted ripgrep execution with a concept's proposed search pattern | search | pattern search | `patternSearch` |
| The statistical comparison of success counts | Fisher exact test, p | Fisher comparison (p) | `fisherComparison` |
| A name change in the proposed codebase build | rename | name edit | `nameEdit` |
| The list of comment and string lines that taggers tag | review sheet | tagging sheet | `taggingSheet` |
| A person or AI stand-in who tags the tagging sheet | reviewer | tagger | `tagger` |
| Marking wrong edits with no codebase version shown | blind review | blind edits-review | `blindEditsReview` |
| The sheet for it | blind review sheet | blind edits-review sheet | `blindEditsReviewSheet` |

Compound terms take the full new name: "agent task run copy", "agent task run id", "agent task run slot", "cloud agent task run repository", "cloud agent task run branch". No short form of "agent task run" appears anywhere. "Rename task" keeps its name: it names the task, and "name edit" names the build's edit.

The search score searches both codebase versions with the proposed search pattern, and the scoring script picks a rename task's target lines with the published search pattern in both. The names state which codebase each pattern describes, not which codebase a script searches.

These terms keep their names, and their definitions take the new names above: recall, precision, true positive, false positive, locked line, line kind, declaration kind, sandbox, fence check, file tool limit, temporary folder.

## Definition edits

Each row below gets this meaning, with no mechanism:

| Term | Meaning |
|---|---|
| published codebase | The codebase as it currently exists in its published state. |
| proposed codebase | The published codebase with each concept reworded to its proposed search pattern. |
| snapshot commit | The one codebase commit that each agent task run copy starts from. |
| corpus | The specific files in the codebase that the experiment covers. |
| compile | The codebase's own step that turns its source into the compiled code and declarations. It partly verifies that changes to the codebase have not changed the ability to compile it. |
| proposed search pattern | The one regular expression that stands for a concept in a search. The proposed codebase rewords the concept so that a plain grep with this pattern finds every line where the concept appears. |
| published search pattern | In the published codebase, the set of patterns that match every wording used for the concept (e.g. `retry count`, `attempt count`, and "number of retries attempted"). |
| name | The name of something in the code: a variable, a function, a parameter, a property, or a type. A comment or a string is text, not a name. |
| seed | A known starting point for a concept: one place in the published codebase where a name of the concept appears. From each seed, the type checker finds every other place the same name is used. |
| control concept | A concept whose wording is already consistent and remains unchanged in both codebases. It serves as a control, showing what scores look like when there is nothing to fix. |

The executor applies the same rule to every other row: a sentence that names a script, a file, or a step moves to the code comment of the script that performs it, or leaves when a comment already says it.

## Exclusions

These keep their names, because a rename would change the experiment or break a tool:

1. **Task prompts** in `config/tasks.json` and the contents of each withheld acceptance test. The 60 recorded agent task runs used them verbatim; a changed prompt breaks the comparison with every recorded agent task run.
2. **The codebase itself**: Ky's code, its test files, and its test command output (TAP lines, `ava` flags).
3. **Third-party names**: `npm test` and the `test` script in `package.json` (an npm convention), the `node:test` module and its `test()` function, git and GitHub terms, `tsc` flags, Claude Code's settings keys and tool names, and the license text in `THIRD_PARTY_NOTICES.md`.
4. **The verb "run" for starting a command** ("run `node scripts/x.mjs`"). The noun "run" for an agent attempt always becomes "agent task run".

## Steps

Branch: `refactor/rename-terms`. One pull request, with one commit per surface, so the reviewer reads each surface on its own. A rename spread over several pull requests leaves surfaces with different names in between, which is the drift this plan removes.

1. **Vocabulary** (`docs:` commit). Rename each row of `docs/vocabulary.md` to its new name, move every old name into the row's Retired column, apply the definition edits, and add rows for terms new to the table. Add one rule under "Words kept literal": the noun "run" never appears alone.
2. **Prose** (`docs:` commit). `README.md` (plus one line that links to `docs/vocabulary.md` for definitions), `AGENTS.md`, `docs/proposed-edits.md`, and `docs/cloud-runs.md` (renamed `docs/cloud-agent-task-runs.md`).
3. **Configuration** (`refactor:` commit). `config/codebase.json`: the `tests` object becomes `verificationSuite`, with `directory`, `extension`, `skip`, `command`, `rerun` (becomes `reexecution`), and `titleSeparator` (becomes `verificationTitleSeparator`). `config/concepts.json`: `search` becomes `proposedSearchPattern` and `forms` becomes `publishedSearchPattern`. `config/tasks.json`: `hiddenTest` becomes `withheldAcceptanceTest`. Prompts stay as they are.
4. **Code** (`refactor:` commit). Identifiers, comments, error messages, and console output in every file under `scripts/`. File renames, each with `git mv`:
   - `run-tests.mjs` → `execute-verification-suite.mjs`
   - `run-agents.mjs` → `start-agent-task-runs.mjs`
   - `collect-runs.mjs` → `collect-cloud-agent-task-runs.mjs`
   - `publish-run-repositories.mjs` → `publish-cloud-agent-task-run-repositories.mjs`
   - `extract-review-sheet.mjs` → `extract-tagging-sheet.mjs`
   - `ai-review.mjs` → `ai-tagger.mjs`
   - `hidden-tests/` (local folder) → `withheld-acceptance-tests/`
   - `work/run-slots/` (local folder) → `work/agent-task-run-slots/`
5. **Result files and local data** (`refactor:` commit). Result columns and JSON fields take the identifier form (for example `testRegressions` → `editRegressions`, `searchCalls` → `agentSearchToolCalls`, `hiddenTestPassed` → `withheldAcceptanceTestPassed`, `runId` → `agentTaskRunId`). Write `scripts/migrate-local-data.mjs`, a one-off script that renames the local, untracked files the scripts read: `truth/review-sheet.csv` → `truth/tagging-sheet.csv`, `truth/reviewer-*.csv` → `truth/tagger-*.csv`, `work/tests-<codebase version>.json` → `work/pre-edit-results-<codebase version>.json`, each agent task run's `tests.json` → `verification-suite.json`, `work/runs/` → `work/agent-task-runs/`, `hidden-tests/` → `withheld-acceptance-tests/`, and the `runId` column of `results/blind-review.csv` → `agentTaskRunId` in the renamed `results/blind-edits-review.csv`. It also renames the fields of `work/agent-task-runs/scores.json` and each `run.json` that step 5 renames in the code. The script exits with an error when a source file is missing or a destination file exists. Delete it in the same pull request after it has run, and say in the pull request body that each clone runs it once from the commit before the deletion.
6. **Self-tests** (`test:` commit). Rename self-test names and fixture strings to the new terms. Rename `lib.test.mjs` and the other `*.test.mjs` files only if a name holds an old term.
7. **Sweep.** Search the tracked files for every old name in the term map, case-insensitive, whole word. Each remaining hit is either an exclusion above or a Retired cell in the vocabulary. List the remaining hits by exclusion in the pull request body.
8. **Checks.** Run `TMPDIR=work/tmp npm test`; every self-test passes. Run `node scripts/search-score.mjs` and confirm `results/search-score.json` matches the file before the change in every value, with only renamed keys. Run `node scripts/summarize-agents.mjs` and `node scripts/results-table.mjs` on the migrated local data, and confirm every number matches the results before the change. Run `node scripts/check-fence.mjs`; every check passes.
9. Delete this plan file. Open the pull request. An independent code reviewer passes it before merge.

## Simplicity

1. **Size.** The code stays the same size. Additions: rows and Retired cells in the vocabulary, one README line, and the one-off migration script, which the executor deletes in the same pull request. Removals: mechanism sentences in vocabulary rows that a code comment already states. Every other change replaces a name with a name.
2. **Duplicates.** Today several surfaces hold different names for one concept: "hidden test" in prose and `hiddenTest` in configuration, "regression" in the vocabulary and `testRegressions` in results, "search term" in prose and `search` in configuration. The rename leaves one name per concept. No code path is duplicated by the change.
3. **Removals.** The migration script could come out if every clone rebuilt its local data from scratch, which costs a full rescore (about 50 minutes) and new agent task runs for anyone without the recorded ones. The script stays, for one commit.
4. **Orphans.** Old file names, old keys, and old columns leave no reader: the sweep in step 7 confirms each old name is gone from the code. The migration script and this plan file leave in the same pull request.
5. **Bounds.** The migration script walks the agent task run folders once, bounded by the count in the key. It holds no wait, retry, or queue.
6. **Current behavior.** Checked on 2026-10-16 against the line-kinds branch: `config/codebase.json` holds a `tests` object with a `rerun` command and a `titleSeparator`; `config/concepts.json` holds `search` and `forms`; `config/tasks.json` holds `hiddenTest`; `summarize-agents.mjs` writes the columns `testRegressions`, `hiddenTestPassed`, and `searchCalls`; local agent task runs execute in `work/run-slots/`.

## Decided

The cloud agent task run scripts stay, and the rename covers them.
