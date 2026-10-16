# grepable code

AI **coding agents share one specific shortcoming**:  the part that *generates* code is not designed to work with the part that *finds* the code.  In essence it generates code, comments, and documentation that it does not reliably find again.  It’s hard to believe this but once you turn over that rock, you can’t unsee it.

As such, the codebase almost immediately starts diverging from itself, accumulating multiple names for the same thing, overlapping logic, stale documentation, comments that  once accurately described but now actively mislead the reader (human or LLM). 

And even if you never  read that code, you will notice its effects.  Because as it grows and diverges, the agentic coder performs palpably worse at adding a new feature, fixing a bug, or answering a question.

We can account for agents’ shortcoming by designing ‘grepable code’; which in turn can improve - across the board, regardless of harness, language, or vendor - agentic coders’ productivity, quality, reliability, speed, and cost.

I set out to test this hypothesis:  **are agents more effective on 'grepable’ code?** 

First I defined and then designed a test to **measure grepability**, and then tested if more grepable codebases improved coding agent performance.

1. `grepability`: whether a non-AI text search (`grep`) can identify the concept wherever it appears within the codebase (code or prose) without matching other concepts.
2. `agentic effectiveness`: whether that changes how effective an AI agent is on executing its tasks

## background

The agent that works on your code every day knows very little about it.  It starts every session (e.g. bug fix)  by reading the code - not all hundred thousand lines of it - just the *relevant* parts.

How does it know what is relevant? It uses a traditional command-line search tool, often  `grep`  (or variants like `ripgrep`).  It ‘greps’ the codebase (does a text pattern search) and reads into its context just the *relevant* lines.

> Whether the tool is `grep`, a vector database, or an AST parser, the agent's ability to find the right code relies almost entirely on consistent naming conventions, centralized logic, and accurate documentation. All the things that LLM coders are challenged by.
>
> If a codebase has diverged and uses three different names for the same concept, both `grep` and advanced semantic search will fail to pull the full picture into the agent's context window.

Unfortunately, **AI coders don't write grep-friendly code**.  The  left hand (the LLM that *creates* code) is not designed to work with the right hand (the agentic harness that *finds* code) (\!)

If you opened the code, you would find the same concepts being called many different things (e.g. `rate`, `interest`, `APR`, `juice`, `vig`, `x`, `prime`, ...)

Even if you would never open the code, this is a big problem for you. You may have noticed it manifesting in the **agentic coder becoming less effective** over time: changes taking longer (even simple ones), becoming more expensive, and less reliable, documentation accumulating ‘technical debt’ of sorts ….

At least that’s the narrative.  But can we test it?  Can we go further and measure it?

## The experiment

*(NB: see [docs/vocabulary.md](docs/vocabulary.md) for the definition of every term below)*

1. **Find something real to test**: Choose a published codebase that is small, well-regarded, and has few if any dependencies, and, where the same concept(s) are represented differently within it.\
   We chose: [KY - Delightful HTTP Requests - a tiny and elegant HTTP client.](https://github.com/sindresorhus/ky)

2. **Create ground truth**: Make a copy of the codebase and edit it such that each concept in it carries only a single name. The edits were made such that they did not change behaviour or line number.\
   \
   For example, Ky has a concept of `delay` that is referred to in variants of retry, rate limit, sleep, number… and they were all given a common name:\
   e.g. `retryAfter` —&gt; `retryAfterDelay`, `rateLimitReset` —&gt; `rateLimitResetDelay`, `“// Must return a non-negative number...”` —&gt; `”// Must return a non-negative delay”` , …


3. **Design a measure** for grepability

   `grepability` was defined as a blend of 2 metrics[^1]:

   - Measure 1: **how much of the right things were found (AKA: recall)**

     - **Definition:** The share of the lines where the concept appears that the search returns.
     - **Formula:** True positives / number of lines in the ground truth
     - **Example:** If the concept appears on 10 lines and the search returns 9 of them, recall is **90%**.
     - **Interpretation**: A high score means that the concepts are *consistently* represented across the codebase using the same terms.\
       A low score indicates the need to refactor concept names for consistency.

   - Measure 2: **how much of the things it found were right (AKA: precision)**

     - **Definition:** The share of the lines the search returns that belong to the concept.
     - **Formula:** true positives / (true positives + false positives)
     - **Example:** If the search returns all 10 lines of the concept and 90 unrelated lines that share a word with it, precision is **10%** (10 of 100 lines returned were correct).
     - **Interpretation**: A high score means that the concepts’ terms are **distinguished**. So a concept that was represented by a broad term (such as “rate") that matches every line of the concept - along with hundreds of unrelated lines - would hurt the ‘grepability’ of this code base.\
       A low score indicates the need to refactor by choosing concept names that are more distinguishing.

4. **Measure (`search score`)**: the grepability of the two versions of that codebases (the published Ky as it is right now, and, the copy of it that where concept names have been harmonized).

5. **Test** if the *same prompts* are *more effective* on a grepable codebase (`agentic effectiveness score`)

   *Approach:*

   - Two Claude Code agents were given the *same task* (i.e. the same prompt) and one of the two codebases.
   - Each task was repeated ten times. So 20 agents were given the *same* prompt: ten asked to work on the original codebase as published, ten on the edited one.
   - This set of 20 agent task runs was repeated twice more, but with an increasingly complicated task.  So 20 agents were run 3 times, given increasingly complicated tasks to do.[^2]
   - After all 60 agent task runs completed, their output was collated and scored

**Task 1: Find**

- Prompt the agent to list every line, in code or comments, that refers to a specific concept.

**Task 2: Refactor**

- Prompt the agent to rename a concept everywhere in the codebase: code, public types, hook state, and even prose comments.
- Success: judged not only on *how many* of the changes were made, but also that the code works, it accidentally created no behaviour changes, and all 1,500+ of the library’s own codebase verifications still pass.

**Task 3: Breaking change**

- Prompt the agent to make a small change to the logic that, if not handled properly, would change Ky’s behaviour.
- Success is judged not only by the number of changes that were made, but also that the resulting code behaves exactly the same (the agent properly compensated for its change), and all 1,500+ of the library’s own codebase verifications still pass.

## The Results

The **published codebase** is Ky as currently published and publicly available. The **proposed codebase** is the edited copy.

### Grepability rose from 83% to 100%

One pattern search per concept, scored on both measures above:

In the published codebase, the pattern searches for the four inconsistently named concepts found between 71% and 77% of each concept's appearances. In the proposed codebase, each pattern search found all of them. Jitter, a concept already named consistently in the published codebase, scored 100% in both, as a control should.

| Concept | Published codebase | Proposed codebase |
| --- | --- | --- |
| Retry count | 83% | 100% |
| Retry delay | 82% | 100% |
| Progress callback | 86% | 100% |
| Caller abort | 80% | 100% |
| Jitter (control) | 100% | 100% |
| **Overall** | **83%** | **100%** |

### Agents succeeded 5 times in 30 on the published and 26 times in 30 on the proposed codebase

| Task | Published codebase | Proposed codebase |
|---|---|---|
| 1: Find | 0 of 10 | 10 of 10 |
| 2: Refactor | 0 of 10 | 9 of 10 |
| 3: Breaking change | 5 of 10 | 7 of 10 |
| **All tasks** | **5 of 30 (17%)** | **26 of 30 (87%)** |

With 10 agent task runs per codebase, the gaps on the find and refactor tasks are too large to arise by chance. The gap on the breaking-change task could arise by chance.

**Where the agents fell short.** In the published codebase, the agents found and renamed every property name, and fell short on comments and parameters:

- Find: the agents found, on average, 34.6 of the concept's 38 comment lines.
- Refactor: the agents changed, on average, 24.6 of the 32 comment lines they had to change, and 0.4 of the 2 parameter lines.

In the proposed codebase, the agents found and changed every line of every kind.

**Effort.** On the proposed codebase, the agents made fewer searches in every task (on average 1.6 against 2.6 for find, 7.1 against 9.6 for refactor, and 4.5 against 7.7 for the breaking change). They also cost more on average in every task, at between $0.12 and $0.33 per agent task run against between $0.07 and $0.14.

**Edits nobody asked for.** A blind reviewer (an AI stand-in), shown no codebase version, marked edits as incorrect or not asked for in 6 and 7 of 10 refactor agent task runs (published and proposed codebase), and in 4 and 5 of 10 breaking-change agent task runs. The rate was about the same in both codebases, so it does not explain the gap in success.

## Conclusion

\<tbd\>  

[^1]: The two metrics are blended using the harmonic mean to yield an F1-score (which we call here `grepability` or simply ‘search score’ ) and define as: `2 * (Precision * Recall) / (Precision + Recall)`. In the example shown, the `grepability` score is 18%.

[^2]: The agents had no knowledge of the hypothesis or each other, they simply did the task they were assigned.

    Each agent task run is its own Claude Code session in a fresh agent task run copy of the codebase, with the same folder name and a single fresh commit, so the agent also could not tell which codebase version it was working on.

    User settings, MCP servers, and saved session history were switched off.
