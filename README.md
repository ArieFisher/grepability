# Grepability test

A measure of how effective an AI coding agents like Codex or Claude code (AKA: copilots, agentic harness, LLM coder, etc. ) can be on a codebase. 

Conceptual grepability is blend of 2 scores: 
1. `search score`: whether the AI coding agent can find all of the relevant codebase (e.g. code, comments, etc.) for given concepts
2. `agent score`: whether that changes how effective an AI agent is on executing its tasks

## context
The agent you code with everyday knows very little about your code.  When you give it any instruction, it starts by reading the code - but not all hundred thousand lines of it -  just the relevant parts.

But how does it know what is relevant? 

It 'greps' the codebase (does a text pattern search) and extracts just the *relevant* lines.

Unfortunately, the  LLM that *creates* code is not designed to work with the agentic harness that *finds* code (!)  AI coders don't write grep-friendly code.  You may have noticed this manifest in: 
	- increasingly longer turn times for what appear to be simple changes
	- after a fix or feature, a stream of edge case bugs that must be also be addressed in the same way as the original fix itself
	- documentation drift
If you were to look inside your code, you would see this manifesting in multiple ways that impact you in the exact same way as the agent:
	- comments that, while once correct, now *misdirect* you
	- the same concept being called differently in different parts of the code (e.g. `rate`, `interest`, `APR`, `juice`, `vig`, `x` ...)

Changes get more expensive, become less reliable, and the agentic coder itself becomes less effective.

But how do we know that this is a real problem?
## testing the hypothesis
This experiment was designed to test the hypothesis that grepable code makes an agent more effective.

The experiment uses
1. a codebase where the same concept(s) are represented differently (in words, variables, function names, etc) 
2. a proposed codebase where each concepts has been harmonized across the codebase into a single name (word or set of words).  In this way, one search pattern matches the concept in both the code and the prose. 
   e.g. one pattern that matches: "retryCount", "retry_count", "retry-count", and "retry count"
	1. In the published codebase: a comment that says "the number of retries attempted" is a miss. In the proposed codebase, the comment is rewritten to use the code's name (with spaces): as "the retry count".  The same search now finds the field, the parameter, and the comment (!) 
