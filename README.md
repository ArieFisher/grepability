# Grepability test

I believe that **all coding agents can be improved** by **accounting for one specific shortcoming** in how agentic harnesses work, namely that the part that *generates* code is not designed to work with the part that *finds* the code before adding a new feature or fixing a bug.

I believe we can account for this shortcoming by designing ‘grepable code’**.** And that this can improve \- across the board, regardless of harness, language, or product \- agentic coders’ speed, productivity, and reliability.

So I set out to test whether agents are more effective on more ‘grepable’ codebases.

First I designed a test to **measure grepability**, and then tested if more grepable codebases (higher scoring) improved coding agent performance.

1. `grepability`: whether a text search (`grep`) can find all of the relevant instances of a concept anywhere they appear in a codebase (whether in code, prose comments, etc.) with few false positives.  
2. `Agentic effectiveness score`: whether that changes how effective an AI agent is on executing its tasks

## context

The agent you code with everyday knows very little about your code.  When you give it any instruction, it starts by reading the code \- but not all hundred thousand lines of it \-  just the relevant parts.

How does it know what is relevant? It 'greps' the codebase (does a text pattern search) and extracts just the *relevant* lines.

Unfortunately, **AI coders don't write grep-friendly code**.  The  left hand (the LLM that *creates* code) is not designed to work with the right hand (the agentic harness that *finds* code) (\!)

If you opened the code, you would find the same concepts being called by different names all over the code, comments, and documentation (e.g. `rate`, `interest`, `APR`, `juice`, `vig`, `x`, `calculate_prime(intrst)`, ...)

Even if you are a person who has and would never open your code, this is a big problem for you.  You may have noticed it manifestingå in the **agentic coder becoming less effective** over time: changes taking longer (even simple ones), becoming more expensive, and less reliable, documentation drifting, comments that (while once correct) now actively mislead, ...

## testing the hypothesis

This is a big claim: that grepable code makes an agent more effective.

Narratively, it makes sense.  But can we test it?

## The experiment

For the definition of every term below, see [docs/vocabulary.md](docs/vocabulary.md).

1. **Find something to test**: Choose a published codebase (a small, well-regarded utility) where the same concept(s) are represented differently (in words, variables, function names, etc): [KY: Delightful HTTP Requests \- a tiny and elegant HTTP client](https://github.com/sindresorhus/ky)  
     
2. **Create ground truth**: Edit a copy of the codebase so that same concepts only carry a single name. In this way a simple text search (`grep`) now finds the field, the parameter, and comment.  The edits were made such that they did not change behaviour or line number.  
     
3. **Design a measure** for grepability  
     
   Use the harmonic mean of:  
     
4. the **share of the concept's appearances** found by a pattern search (i.e. high true positives)  
   e.g. if the concept appears in the codebase 10 times and the pattern search finds 9 of them, this component scores 90%.  It is more ‘grepable’ than a codebase that scores 70%.  
   A high score means that the concepts are **consistently** represented across the codebase using the same terms.  
   A low score indicates the need to refactor concept names for consistency.  
     
5. the share of the pattern search results **that belong** to the concept (i.e. low false positives)  
   e.g. in the example above, if the pattern search found 9 of the 10 instances but also found 80 ‘false positives’ \- results that were *unrelated* to the concept (but may have shared a word), then this component scores 10% (9 of 90).  
     
   A high score means that the terms chosen to represent concepts **distinguish** them easily. So a concept that was represented by a broad term (such as "delay") that matches every line of the concept \- along with hundreds of unrelated lines \- would hurt the ‘grepability’ of this code base.  
   A low score indicates the need to refactor concept names to be more distinguishing.  
     
6. **Measure**: the grepability of the two codebases (control and ground truth)  
     
7. **Test** if the *same prompts* are *more effective* on a grepable codebase

*Test approach:*

- Give 2 Claude Code agents the *same task* (prompt) and 1 of the 2 codebases.  
- Each task was repeated 10 times for each codebase.  So 20 agents were given the *same* prompt: 10 asked to work on the original codebase, 10 on the edited one.  
- This set of 20 agent task runs was repeated twice more, with increasingly complicated tasks.  
  *Note:* The agents had: no knowledge of the hypothesis or each other, they simply did the task they were assigned.  Each agent task run is its own Claude Code session in a fresh agent task run copy of the codebase, with the same folder name and a single fresh commit, so the agent also could not tell which codebase version it was working on; and user settings, MCP servers, and saved session history were switched off;  
- After all 60 agent task runs completed, their output was collated and scored

**Task 1: Find**

- Prompt the agent to list every line, in code or comments, that refers to a specific concept (`retry count`).

**Task 2: Refactor**

- Prompt the agent to rename a concept (in this experiment `retry count` to `retry number`) everywhere: code, public types, hook state, and even prose comments.  
- Success is judged not only on *how many* of the changes were made, but also that the code works, it exhibits no behaviour changes, and all 1,500+ of the library’s own individual codebase verifications still pass.

**Task 3: Breaking change**

- Prompt the agent to make a (small) change to the logic that, if not handled properly, would change the behaviour.  
- Success is judged not only by the number of changes that were made, but also that the resulting code behaves exactly the same (meaning the agent properly compensated for its change), and all 1,500+ of the library’s own individual codebase verifications still pass.a

## The Results

\<tbd\>

## Conclusion

\<tbd\>  