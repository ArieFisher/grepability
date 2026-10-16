# Vocabulary

One term per concept, used in every document, comment, self-test name, commit message, and result file in this repository. The **Retired** column lists the words that the term replaces; a line added to a markdown file never contains one of them. The table is the machine form: a check reads the Retired column from this file and holds no copy of its own.

## The experiment

| Term                   | Meaning                                                                                                                                                                                                                                                                                                                        | Retired                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| grepability            | A code metric of how easily one can use text-search tools like `grep`, `ripgrep`, or search bars to find every line of a concept.                                                                                                                                                                                              | grep-ability, greppability, searchability, findability |
| conceptual grepability | A metric of how well a code base is organized so that text-search tools (like grep, ripgrep, etc.) can find **all relevant code and comments** for **core concepts** of a codebase.                                                                                                                                            |                                                        |
| concept                | One idea in the codebase that the experiment tracks. Each concept has an id, a definition, a proposed search pattern, and seeds.                                                                                                                                                                                              | topic, notion, theme                                   |
| search score           | The measurement of grepability: one pattern search per concept, scored against the ground truth. For one concept in one codebase version it is the harmonic mean of recall and precision (the F1-score).                                                                                                                       | measure 1, experiment 1, test 1, the search measure    |
| agent score            | The measurement of the *effect* of grepability: the success rate of an agent that does each task in each codebase version. For one concept in one codebase version it is the success rate over the agent task runs of every task on the concept.                                                                              | measure 2, experiment 2, test 2, the agent measure     |
| codebase               | The code the experiment studies: one repository pinned to one commit.                                                                                                                                                                                                                                                         | target, library, project under test, subject           |
| published codebase     | The codebase as it currently exists in its published state.                                                                                                                                                                                                                                                                    | arm A, baseline codebase, original codebase            |
| proposed codebase      | The published codebase with each concept reworded to its proposed search pattern.                                                                                                                                                                                                                                              | arm B, candidate codebase, treated codebase            |
| codebase version       | One of the two codebases the experiment compares: the published codebase or the proposed codebase.                                                                                                                                                                                                                             | version, arm, variant, condition, treatment, branch    |
| snapshot commit        | The one codebase commit that each agent task run copy starts from.                                                                                                                                                                                                                                                             | base commit, initial commit, starting commit           |
| codebase configuration | The file that states which code the experiment studies and how to verify it: the repository, the commit, the corpus, the compile command, the type check commands, and the codebase verification suite settings (verification folder, files to skip, suite command, re-execution command, verification title separator, and verification declaration pattern). | test run configuration, codebase file, codebase config |
| corpus                 | The specific files in the codebase that the experiment covers.                                                                                                                                                                                                                                                                 | source tree, source files                              |
| compile | The codebase's own step that turns its source into the compiled code and declarations. It partly verifies that changes to the codebase have not changed the ability to compile it. | build step, distribution build, dist |
| proposed search pattern | The one regular expression that stands for a concept in a pattern search. The proposed codebase rewords the concept so that a plain grep with this pattern finds every line where the concept appears. | search term, grep pattern, query, keyword |
| published search pattern | In the published codebase, the set of patterns that match every wording used for the concept (e.g. `retry count`, `attempt count`, and "number of retries attempted"). | forms, variants, aliases, spellings |
| pattern search         | One scripted ripgrep execution with a concept's proposed search pattern.                                                                                                                                                                                                                                                       | search                                                 |
| name | The name of something in the code: a variable, a function, a parameter, a property, or a type. A comment or a string is text, not a name. | identifier, symbol name, variable name |
| seed                   | One known place in the published codebase where a name of the concept appears. From each seed, the type checker finds every other place the same name is used.                                                                                                                                                                | anchor, root symbol, starting point                    |
| control concept        | A concept whose wording is already consistent and remains unchanged in both codebases. Its scores are the control: the values the scores take when there is nothing to fix.                                                                                                                                                   | baseline concept, placebo                              |
| name edit              | A proposed codebase edit to a name, which changes every reference to the name and nothing else.                                                                                                                                                                                                                               | rename, symbol rename, refactor                        |
| wording edit           | A proposed codebase edit that replaces exact text on one line of a comment or string.                                                                                                                                                                                                                                          | comment edit, text edit, rewording                     |

## Ground truth

| Term | Meaning | Retired |
|---|---|---|
| ground truth | The set of lines in the published codebase where each concept appears. | truth set, gold standard, answer key, expected lines |
| name line | A ground truth line that holds a reference the type checker found from a seed. | identifier line, symbol line, code line |
| text line | A ground truth line that holds a comment or string the taggers tagged. | comment line, string line, prose line |
| tagging sheet | The list of every comment line and string line in the corpus, one row each, with an empty column for concept ids. | review sheet, candidate list, line list, worksheet |
| tagger | A person or an AI stand-in that tags the tagging sheet. | reviewer, annotator, rater, labeler, judge |
| tag | A concept id a tagger writes on a row of the tagging sheet. | label, annotation, vote, mark |
| agreement | Rows where every tagger gave the same tag for a concept. | consensus, inter-rater reliability, overlap |
| disagreement | A row and concept that some taggers tagged and others did not. | conflict, split, mismatch |
| adjudication | A yes or no on each disagreement, from a person or an AI stand-in. Until every disagreement has one, the ground truth is provisional. | resolution, arbitration, tie-break |
| adjudicator | The person or AI stand-in who gave an adjudication. | arbiter, tie-breaker, decider |
| provisional | The state of a ground truth with at least one disagreement that has no adjudication. | draft, preliminary, incomplete, tentative |
| line kind | The kind of text a ground truth line holds: one of the kinds in the line kinds table. A text line takes the kind the tagging sheet records for it. A name line takes the kind of the declaration its name refers to, as the type checker reports it. A line that holds two kinds has both. | line type, line category, token kind |
| declaration kind | The kind the type checker reports for the declaration a name refers to, such as property, parameter, or method. The line kinds table maps each declaration kind to a line kind. | symbol kind, element kind |

### Line kinds

The TypeScript kinds column is the machine form of the mapping from a declaration kind to a line kind. A declaration kind the column lacks maps to `other`. The ground truth script and the summary script read this table, and stop when the heading, the Kind or TypeScript kinds column, or the rows are missing. The ground truth script prints each declaration kind it mapped to `other`, with its line count.

| Kind | Meaning | TypeScript kinds | Retired |
|---|---|---|---|
| comment | A line that holds a comment. | | remark |
| string | A line that holds a string and no comment. | | text literal |
| property | A name of a property of an object, a class, or a type, including a class field and an accessor. | property, getter, setter, enum member | attribute |
| parameter | A name of a function or method parameter. | parameter | |
| variable | A name of a variable. | var, let, const, local var, using, await using | |
| function | A name of a function, a method, or a constructor. | function, local function, method, constructor | procedure |
| type | A name of a type, an interface, a class, an enum, or a type parameter. | type, interface, class, local class, enum, type parameter | type name, class name |
| other | A name whose declaration kind the TypeScript kinds column lacks. | | misc |

## Agent task runs

| Term | Meaning | Retired |
|---|---|---|
| agent | The command line coding program that does each task. | AI, assistant, model, bot, coding agent |
| task | One prompt the agent gets, tied to one concept. A find task requires a list of lines in the reply. An edit task requires a change to the code. | job, prompt, exercise, problem |
| find task | A task scored on the lines the agent lists in its reply. | search task, list task, locate task |
| edit task | A task scored on the lines the agent changed, plus the type check, the codebase verification suite, and the withheld acceptance test when the task has one. | change task, modify task, refactor task |
| rename task | The edit task that has the agent rename a concept everywhere: every name in code and every comment. It is scored on the target lines. The proposed codebase build's edit to a name is a name edit. | rename job, renaming exercise |
| required lines | For an edit task, the lines the agent had to change, fixed in the task configuration. | must-change lines, expected edits |
| target lines | For a rename task, the lines the agent had to change: the concept's name lines plus text lines whose wording matches the published search pattern in that codebase version. | expected lines, rename lines |
| cell | One task in one codebase version. | condition, group, bucket, task-version pair |
| agent task run | One time the agent works on one task in one codebase version, with a random id. | run, agent run, trial, attempt, session, sample |
| local agent task run | An agent task run that executes on this machine, in its own agent task run copy. | local run |
| cloud agent task run | An agent task run that executes in a routine on a cloud agent task run repository, in place of this machine. | cloud run, remote run, web run, hosted run |
| agent task run copy | The fresh copy of a codebase version made for one agent task run. | run copy, workspace, checkout, working copy |
| agent task run slot | One of the fixed folders that local agent task runs execute in, one per parallel worker. | run slot, lane, worker folder |
| agent search tool call | A search command the agent used in an agent task run. | search call |
| sandbox | The operating system boundary that Claude Code puts around each shell command the agent runs in a local agent task run (Seatbelt on macOS). | jail, container, isolation |
| file tool limit | The confinement of the agent's file tools (Read, Edit, Write, Grep, Glob) to the agent task run copy in a local agent task run. | file tool sandbox, tool fence |
| temporary folder | A folder inside the project where a command the scripts start, or a local agent task run, writes its temporary files and npm cache, in place of the system's temporary folder and the home directory. Each local agent task run has its own. | scratch folder |
| fence check | The check that starts one agent the way a local agent task run does and asks it to write and read outside its agent task run copy. It passes when every outside call fails. | sandbox test, escape test |
| key | The file that maps each agent task run id to its codebase version and task. | mapping, lookup, index, legend |
| blind edits-review | A pass over agent task run diffs with no codebase version shown, by a person or an AI stand-in, to mark wrong edits before anyone reads the key. An AI stand-in reads only each agent task run's task prompt, diff, and final reply. Each note it writes on the sheet starts with "AI stand-in". | blind review, blinded review, masked review |
| blind edits-review sheet | The list of every agent task run, one row each, in shuffled order with no codebase version. Whoever does the blind edits-review writes yes or no in the wrong_edits column. | blind review sheet, judging sheet, blind sheet, review form |
| wrong edit | An edit in an agent task run's diff that whoever does the blind edits-review marks as incorrect or not asked for. | bad edit, unexpected edit, bad change |
| routine | A saved claude.ai configuration of a prompt, a repository, and an API trigger. One routine exists per task and codebase version. | scheduled task, automation, job, workflow |
| cloud agent task run repository | The private GitHub repository that holds one codebase version for cloud agent task runs: the codebase version's files and the start hook, as one commit. Its name shows no codebase version. | run repository, cloud repository, mirror, copy of the version |
| cloud agent task run branch | The branch that a cloud agent task run pushes its changes and reply file to. | run branch, result branch, output branch, answer branch |
| reply file | The file in which a cloud agent task run writes its final reply, because the fire request returns no reply. | answer file, output file, result file |
| start hook | The small file in each cloud agent task run repository that installs dependencies and compiles when a cloud agent task run starts, so the agent can run the type check and the codebase verification suite. Both codebase versions carry the same hook. | setup script, bootstrap, init script |
| pending agent task run | A fired cloud agent task run whose cloud agent task run branch has not appeared. | pending run, queued run, waiting run, in-flight run |
| transcript | The agent's full event stream for one agent task run, as newline-delimited JSON. | log, trace, session log, output |
| final reply | The agent's last message in an agent task run. | final answer, response, result text, output |
| individual codebase verification | One of the codebase's own checks. | test, codebase test, Ky test |
| codebase verification suite | All of the codebase's individual codebase verifications together. | test suite, tests |
| codebase verification suite execution | One execution of the codebase verification suite in a codebase version or an agent task run copy. | test run, suite run |
| individual codebase verification re-execution | One more execution of one individual codebase verification in the same directory. | rerun, test rerun |
| verification file | A file in the codebase's verification folder that holds individual codebase verifications. | test file |
| verification title | The name the codebase verification suite prints for one individual codebase verification: the verification file name, the verification title separator in the codebase configuration, then the name the individual codebase verification declares. | test title, test name, test label, test id |
| verification declaration | The line in a verification file that declares one individual codebase verification and the name its verification title ends with. | test declaration, test definition, test header |
| pre-edit codebase verification suite results | The type check and codebase verification suite results of a codebase version before any agent edits it. | baseline, reference results, control results, original results |
| withheld acceptance test | Our check, copied into an agent task run copy after the agent finishes, that the edit task's goal was met. The agent cannot read it during the agent task run. | hidden test, hidden acceptance test, secret test, holdout test |
| edit regression | An individual codebase verification that passed in the pre-edit codebase verification suite results and fails after the agent's edit, or a removed verification. | regression, test regression, breakage, failure, broken test |
| hunk | One block of changed lines in a diff, under a header line that holds the block's start line and its counts of removed and added lines. | change block, block of changed lines, diff chunk |
| lost verification title | A verification title that the pre-edit codebase verification suite results hold and an agent task run's results lack. | lost title, missing test, vanished test, dropped title |
| new verification title | A verification title that an agent task run's results hold and the pre-edit codebase verification suite results lack. | new title, added title, extra test, unknown test |
| renamed verification | An individual codebase verification whose verification title an agent task run changed. | renamed test, retitled test, moved test |
| removed verification | A lost verification title with no pair, that fails its individual codebase verification re-execution. | removed test, deleted test, dropped test |
| flaky verification | An individual codebase verification that both passes and fails across individual codebase verification re-executions. | flaky, flaky test, unstable, nondeterministic, intermittent |
| self-test | This project's own checks of its scripts. | unit tests, harness tests |

## Scores

| Term | Meaning | Retired |
|---|---|---|
| hit | A line a pattern search returned. | match, result, occurrence |
| true positive | A hit, or a listed line, that is in the ground truth. | found line, correct hit |
| false positive | A hit outside the ground truth: a line the pattern search returned that does not belong to the concept. | unrelated hit, wrong hit, noise |
| miss | A ground truth line that a pattern search or an agent reply did not include. | missed line, false negative, gap, omission |
| locked line | A line that no name edit or wording edit can change without changing behavior. It takes one of two forms: a ground truth line that no edit can make the proposed search pattern match, or a hit outside the ground truth that no edit can stop the proposed search pattern from matching. No edit can change four kinds of text: a name the standard library declares, a public name that callers use, a string the program outputs or compares at runtime, and a file path or a URL. A comment is locked only when its only concept wording, or its only text the proposed search pattern matches, names a name of the first two kinds. A code line with no wording of the concept is locked with the reason "no wording on the line". | fixed line, unchangeable line, excluded line, out-of-scope line |
| recall | True positives divided by ground truth lines: of every line where the concept appears, the share a pattern search or an agent reply included. | find rate, coverage, completeness, sensitivity, hit rate |
| precision | True positives divided by true positives plus false positives, i.e. by hits: of every line a pattern search returned, the share that belongs to the concept. It is a property of the proposed search pattern in one codebase version. A low value has two causes. Pattern overload: the codebase holds the same word for a second thing that could carry its own name, and a name edit removes the overlap. Structural overlap: the codebase holds distinct concepts that share language, such as rate, annual rate, and effective rate, and the codebase is structurally indistinct for that pattern. | term distinctiveness, accuracy, purity, positive predictive value |
| success | An agent task run that met every condition of its task: no misses, and for an edit task a passing type check, no edit regressions, and a passing withheld acceptance test when there is one. An agent task run of an edit task with a verification file that stopped partway has unknown success. | pass, win, completion, correct run |
| interval | The Wilson 95% interval around a success count. | confidence interval, error bar, range, margin |
| Fisher comparison (p) | The two-sided comparison of the published codebase and proposed codebase success counts for one task, by Fisher's exact method for a 2x2 table. Its value is p. | p, Fisher exact test, p-value, significance, probability |
| results table | The table of each concept's search score and agent score in each codebase version, with the change for each score, the recall and precision behind the search score, and the overall row. | results matrix, scorecard, summary table |
| change | A score in the proposed codebase minus the same score in the published codebase, in percentage points. | delta, difference, improvement, lift |
| overall row | The results table row that combines every concept except the control concept. Its search score is the mean over those concepts, so each concept counts once. Its agent score pools their agent task runs, so each agent task run counts once. A concept with no search score in a codebase version leaves that codebase version's overall search score empty, so both codebase versions average the same concepts. | total row, aggregate, summary row |

## Words kept literal

- **line** is always a line of a file, written as path and number separated by a colon. A line of prose in a document is a sentence.
- **pattern search** is always one ripgrep execution with one proposed search pattern. Grep, ripgrep, and pattern search are not interchangeable in prose: "pattern search" stands for the operation, "ripgrep" stands for the tool.
- **test** appears only inside "withheld acceptance test", "self-test", and third-party names. One of the codebase's own checks is an individual codebase verification.
- **copy** never appears without a qualifier. Write "agent task run copy" or "codebase version".
- **run** as a noun never appears alone. Write "agent task run", or "codebase verification suite execution" for the suite. The verb "run" for starting a command stays.

## Applied to Ky

The current codebase is Ky, pinned to the commit in the codebase configuration. The corpus is every TypeScript file under its source folder. The five concepts are `retry count`, `retry delay`, `progress callback`, `caller abort`, and `jitter`, with jitter as the control concept.
