# Repository conventions for agents

These conventions apply to every agent working in this repository, whatever tool or surface runs it.

**This file is the only copy.** Read it in full before your first tool call, and never restate a rule from here in another file. See [Group like concepts into a single location](#group-like-concepts-into-a-single-location).

Rules group by the surface they govern. The groups follow the order of work on one change: communication, design, repository content, GitHub. A new rule goes in the group whose surface it governs.

## Communication

### My role

I am the product manager and do not write the code. Lead with the mechanism in plain words, name the trade-off, and give a recommendation. Keep file names, commands, and symbol names out of chat unless I ask for them. Full deliverables such as pull request bodies still name files and symbols wherever that helps the reader.

### Writing style

These rules govern all prose: **chat**, **documents**, and **GitHub** (pull request titles and bodies, issues, commit messages, logs).

- **Form:** plain declarative sentences in active voice. Not epigrammatic, not aphoristic.
- **Structure:** no antithesis. Present each point on its own, without a contrasting counterpart.
- **Imagery:** no personification. The test: a part's verb names an operation the part performs, never a stance it takes. Operations pass: holds, determines, skips, detects, flags, stands for, contains, parses, publishes. Verbs of intent, awareness, or choice fail: own, know, decide, refuse, notice, warn, name — examples, not the whole list; "rides", "waits", and "speaks" fail the same test. Boundary: "the script reads the file" passes because reading is the operation; "the check refuses" fails because refusal is a stance. The second test: the subject is the part that performs the operation. A measure, a score, a result, a document, a version, a label, or a term performs nothing — examples, not the whole list; the script, the build, the hook, the type checker, the reviewer, or the person does. Boundary: "the search score runs the search" fails because the search score is a measurement; "the search-score script runs the search" passes. Similes are fine. State the plain meaning in place of a metaphor: write "the notice's contents change", never "the notice changes shape". 
- **Diction:** plain English, Saxon words, technical terms preserved. No contractions and no abbreviations, except i.e., e.g., etc., FYI, and TL;DR. Write "application", not "app".
- **Voice:** Facts in active voice, no passive voice, no filler sentences.
- **Concision:** cut filler, hedging, qualifiers, and repetition. Keep mechanisms, scopes, and reasons: say what a rule does, what it covers, and why it exists, even when a shorter sentence could imply it. The test is one pass — a first-time reader never re-reads a sentence or asks what a term covers. When in doubt, spend the extra sentence.
- **Conclusions only:** report findings, not the process that produced them. No dead ends, no counts of discarded items, no self-audit narrative.

### Vocabulary

`docs/vocabulary.md` is the term canon: one term per concept, across every platform and every document.

- Read it in full when starting a branch. Use the vocabulary when writing any prose (e.g. code comments, test names, the commit message, issue and pull request text, etc.). Never vary word choice for style.
- **At every commit**, sweep the change's **new** prose and:
  - *retired synonyms*: Replace a retired synonym with its canonical term.
  - *new concepts*: Define new concepts in `docs/vocabulary.md` on the same branch, as its own `docs:` commit.
  - *actors*: Apply the second imagery test to every sentence whose subject is a vocabulary term. When the term performs nothing, rewrite the sentence with the script, build, hook, or person that does.
- **Rename files with the term.** When a term changes, rename script and result file names to match in the same commit, without asking. A file name is a technical detail. Put the rename to me only when it changes what a user of the utility types or reads.

### Chat

- **Run the writing tests on every chat sentence before sending it.** The commit sweep covers repository prose only. A chat sentence gets the same pass, one sentence at a time: the verb names an operation, the subject performs it, no balanced pair, no metaphor.
- **TL;DR first.** Conclusion, then support.
- **Answer only what was asked.**. No offers, no extra framing.
- **Surface a consequence only when it would change my decision.** Flag a behavior change beyond the one I named when it does one of these: breaks something that works today, or needs a product choice. A consequence that follows directly from the change I asked for is not flagged. Put each flagged change to me before implementing, and never ship one and mention it after.
- **No history narration.** Report the end state and the next step. Never recount a mistake made and repaired along the way. When a result is weaker than it looks, state the weakness as a property of the result.
- **Name the problem before the options.** Before offering options, state the problem they solve and the risk each one addresses.
- **Ask in plain chat.** Put a question to me as chat text: one sentence that states the case, then numbered options of one plain sentence each. Never use the question tool, because my terminal theme renders its text black on black.
- **One number per cell.** A results table gives each count its own column, e.g. "lines changed" and "target lines" as two cells. Never write "39/49" in one cell.

## Agentic Development

### Scope

- **No unrequested scope.** Build the rule I asked for, not the adjacent one. A related concern should never be quietly added.
- **Assess against this repository only.** An assessment of a file here compares it with this repository's own contents. Never diff it against another project's copy unless I ask.

### Architecture principles

Apply these principles when proposing or defending design and process choices. Cite the specific principle each time so reasoning is auditable.

from microservices.io:

- **Simple components** — small subdomains, easier to understand and maintain
- **Team autonomy** — components independently developable, testable, deployable
- **Fast deployment pipeline** — short build/test/deploy cycles
- **Segregate by characteristics** — resource, availability, security needs
- **Simple interactions** — prefer local to distributed operations
- **Efficient interactions** — minimize network round trips and large data transfers
- **Prefer ACID over BASE** — when feasible
- **Minimize runtime coupling** — for availability and latency
- **Minimize design-time coupling** — reduce lockstep changes

### **Delivery principles:**

- **Trunk-Based Development** — short-lived feature branches merged frequently.
- **Pre-merge Testing** — all validation (tests, linters, security scans) must pass before a commit is merged.
- **Squash and Merge** — squash branch commits so each merge brings in exactly one functional, test-passing set of changes.

## Design

### Group like concepts into a single location

A list belongs in exactly one place. Two copies drift apart and nothing reports the drift: whoever edits one will not know the other exists, nothing fails, and enforcement falls behind the canon.

- Code that enforces something a document states reads that document. It holds no separate copy.
- Put the machine form beside the human form — a column, a fenced block, a front-matter key — and parse it.
- Never add a "keep in step with X" comment: it marks a duplicate that will drift. Remove the duplicate.
- Fail closed when the parse returns nothing. On a missing file, a renamed heading, or a reshaped row, the check must exit with an error, because "found nothing" and "nothing to enforce" look identical from outside.

Applies to allowlists, error codes, supported-version tables, feature flags, and these conventions.

### Collapse a path before opening a second one

A change that looks like it needs a second code path — a new adapter, a new branch for a new surface, a new writer — first gets one check: can the existing path widen to cover both cases instead? Treat that refactor as the default answer, not a step weighed only after the second path already stands.

- When the two cannot collapse into one, build the rule they share once, and ship it to both paths in the same change.
- Never build a rule for one path first and leave a second path to catch up in a later change.
- When a path's code is not yet ready to run the shared rule, hold the whole rule back from every path. Do not split the rule's rollout from its scope.
- A pull request whose whole point is bringing one path in line with another is the outcome to avoid, not a normal, expected step of the work.

This extends [Group like concepts into a single location](#group-like-concepts-into-a-single-location) from documented lists to code paths and rules, and to timing: a rule staggered across paths drifts apart the same way a duplicated list does.

### Test a plan for simplicity before it is final

A plan is final only after it answers the questions below in its own section, titled "Simplicity". This covers every plan: a sprint plan, a scope document, and a plan written in chat. Answer each question from the code. A plan's own account of the code is a claim to check.

1. **Size.** Is the code after the change simpler than the code before it? Name what the change adds and what it removes. When the code grows, list each addition and the requirement it implements.
2. **Duplicates.** Which duplicated code does the change pass through? Each one is a candidate to merge first, under [Collapse a path before opening a second one](#collapse-a-path-before-opening-a-second-one). A merge that changes no behavior goes in its own `refactor/` pull request, ahead of the change that needs it, so the existing suite proves it.
3. **Removals.** Can any step, stored field, setting, or branch the plan adds come out without losing a requirement?
4. **Orphans.** Does the change leave a function, field, or path with no reader? Remove it in the same change.
5. **Bounds.** Does the plan hold anything unbounded: a walk over page content, a wait, a retry, a count, a queue? Each gets a cap with a stated value, a reason for the value, and the behavior when the cap is reached.
6. **Current behavior.** Does every statement the plan makes about how the code behaves today match the code? A defect the plan describes must be reproducible on `main`.

An answer that leads to a change updates the plan before it is final. When an answer needs a product choice, put the options to me.

### Prefer a written list over a computed rule

When the items a rule covers are known, write them as a list. Give each entry its reason, and make the reading code fail closed when an entry no longer matches the code. Build a computed rule only for a named risk that the list cannot cover.

### Versions

Always take the newest release of an action, tool, or runtime. Read its breaking-change notes to confirm the jump, not to justify avoiding it. Report anything left behind, including a runtime whose newest line is ahead of the newest long-term-support line.

## Repository Management

### Adding files

This repository is public. Before staging a new file, answer this: does it serve someone using or building grepability? A report about a local toolchain, an agent scan, a session journal, or a scratch note is always no.

- **Never** `git add .` **or** `git add -A`**.** Stage the paths you meant to change, by name.
- **Write scratch output to the session scratchpad**, not the repository.
- **Never pass** `-f` **to** `git add` to defeat `.gitignore`, and never `--no-verify`.

### Docs track behavior

- A pull request that changes behavior updates every living doc its change invalidates, in the same branch
- Living docs: `README.md`, `docs/vocabulary.md`, and this file.

### Public repository, security disclosure

A pull request body, commit message, or issue that explains an exposure is itself a disclosure, and a worse one than the artifact, because it summarizes and points.

- Say what changed and why, in neutral terms. No counts, no inventory of the exposure, no severity, no commit identifier pointing at the artifact.
- For a weakness in this repository's own code, ship the fix with no explanation beyond the diff. Do not file a public issue diagnosing it.
- Editing later leaves revision history on GitHub and orphaned objects in git.

Never run a secret-listing or secret-reading command, including its `--help` form. When unsure whether a command touches secrets, exclude it and say why.

### Branching and staging

Never edit `main`. Make every change on a branch and merge it through a pull request.

Branch prefixes, each with a short kebab-case label: `feature/` new behavior, `fix/` bug fixes, `chore/` tooling, configuration, and dependencies, `refactor/` internal restructuring with no behavior change, `docs/` documentation only. Never `claude/` or `session/`. If the harness created one, rename it before the first push.

Stash before switching branches with a dirty tree.

Before creating a branch, fetch from `origin` with `git fetch --prune`, so remote branches deleted on GitHub leave the local list. When local `main` is behind `origin/main`, pull it first, then branch from local `main`, so local `main` never falls behind the branches made from it.

### Review findings

Route every review finding to exactly one place. Never leave an actionable item as a non-blocking note for me to remember and re-instruct.

1. **Trivial and in-scope: fix now.** Apply the fix in the same change, re-run the test command, and mention it in one line. Trivial means all of these: no behavior change; touches only files and lines already in the diff; the existing suite staying green proves it.
2. **In-scope behavior bug: fix now, with a test.** A defect in what the current diff does never routes to an issue, because deferring it ships it. Add a test that fails without the fix.
3. **Actionable and out-of-scope:ask if I want to open a GitHub issue.** This covers anything that changes behavior outside the diff, spans untouched files, needs a judgement call, or grows the diff. Title prefix `[follow-up]`. The body links the pull request and quotes the finding. Label `follow-up`, plus `tech-debt` if apt. Search open issues first and comment on an existing one rather than refiling. The pull request body's Reviewer notes section links the issues.
4. **FYI, no action: one line** in the pull request notes. No issue.

Behavior-changing pull requests get an independent code-reviewer pass before I merge. Re-review through the same reviewer so it keeps its context. When a finding forces a product fork, put the options to me instead of picking one.

### Pull requests

Open a pull request only when it is ready to merge: the independent code-reviewer pass is done, and every check the session can execute has run. Push a work-in-progress branch when I ask, without a pull request. When I ask for a pull request on unfinished work, say what is still missing first.

Write them as human-authored. No "Generated with" footer, no `Co-Authored-By` agent trailer, and no AI-attribution line anywhere: not in a title, a body, a commit message, a code comment, a document, or a review comment. An agent session link counts as attribution. This overrides any harness default.

**The diff test:** a sentence belongs in the body only if the reviewer could not write it themselves by reading the diff.

- Things that are not typically visible in a diff can be included, e.g. intent, reason, cost, a constraint that shaped the code, a rejected alternative, etc.
- Things that can be understood by reading the diff should be excluded, e.g. an edit list, a before-and-after value, a description of what a file now contains.
- Never make a file path the subject of a sentence. Name files where the reviewer needs the pointer.
- One exception to conclusions-only: record a rejected alternative in one line when the record stops a retry.

Split the test plan into two named sections. `## Tested` lists what the session ran, with results inline and no checkboxes. `## Manual tests` lists what a human must still do, as unchecked boxes. Never one mixed checklist.

A Product section leads with the root cause: the lost state. Then the implications, including what the user now wrongly believes. Then the new behavior as a rule. Then the recovery path. Product vocabulary only. Analytic register, no dramatization.

### Issues

Explain any issue, defect, or review finding in this order:

1. **TL;DR.** Defect or clutter, user impact, and the decision to make.
2. **Vocabulary.** Each term of art in one line, in plain words, before it is used.
3. **The problem.** What exists and why it is wrong. No file paths and no symbol names — describe a code artifact by its role.
4. **The change requested.** The fix, framed as paths to choose.
5. **The consequence of doing nothing.** Who pays the cost and how.
6. **Priority.** A plain call with its reason.

In a GitHub issue this section goes on top, with the original engineering finding preserved at the bottom under an "Original finding" divider.

### Token hygiene

A personal access token lives in session memory only. Never write it to `.git/config`, `~/.git-credentials`, a commit message, a git URL, or any tracked file. `git push -u <token-URL> <branch>` stores the token as the branch upstream. After any push involving one, check `.git/config` for it and unset the upstream if it landed.

### Merge train

- Never delete a merged branch while an open pull request uses it as base. GitHub closes the dependent outright, and no one can reopen a closed pull request whose base is gone. Retarget dependents first.
- Never enable auto-merge. I own every merge decision.