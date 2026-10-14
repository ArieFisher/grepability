# Cloud runs

TL;DR: a cloud run executes the agent in a claude.ai routine on a private GitHub repository, so the run needs no part of your machine. Six routines exist, one per task and version. A script fires each routine ten times, each run pushes a run branch, and a second script turns every branch into a run directory that the scoring script reads like a local run.

Terms are defined in [vocabulary.md](vocabulary.md). The routine behavior below comes from the Claude Code documentation: [routines](https://code.claude.com/docs/en/routines), [cloud environments](https://code.claude.com/docs/en/cloud-environments), and the [fire endpoint](https://platform.claude.com/docs/en/api/claude-code/routines-fire). The feature is a research preview, so any of these facts can change.

## What a cloud run reports

A cloud run reports the diff and the final reply. It reports no cost, time, turns, tool counts, or model identifier, because the fire request returns only a link to the run page. The scoring script records each missing figure as null, and the summary shows n/a.

The routine form sets the model, and the agent runs without the tool allowlist and the spending cap that local runs use. Every routine uses the model in `config/tasks.json`, which you select by hand on each form. The routine runs under your claude.ai account: its usage counts against your plan, and its GitHub pushes carry your GitHub identity.

## One-time setup

Each step is one action. Steps marked **Claude** are commands that the scripts run for you after you ask; the other steps need your hands.

1. Open [github.com/new](https://github.com/new). Type a name such as `ky-run-a`. Select **Private**. Leave every box under it empty. Click **Create repository**.
2. Repeat step 1 with a second name such as `ky-run-b`. Neutral names matter: a name that says "published" or "proposed" shows the agent its version.
3. Open [github.com/apps/claude/installations/new](https://github.com/apps/claude/installations/new). Pick your account. Select **Only select repositories**. Add `ky-run-a` and `ky-run-b`. Click **Install**.
4. Open [claude.ai/code](https://claude.ai/code). If a GitHub sign-in button shows, click it and approve the request on GitHub.
5. Create the file `work/cloud-routines.json` in this repository. The folder `work/` is ignored by git, so the file stays on your machine. Start it with the text below, with your own GitHub name and repository names. The first repository holds the published codebase and the second holds the proposed codebase; only this file records which is which.

   ```json
   {
   	"repositories": {
   		"published": "https://github.com/YOUR-NAME/ky-run-a.git",
   		"proposed": "https://github.com/YOUR-NAME/ky-run-b.git"
   	},
   	"routines": {}
   }
   ```

6. **Claude:** ask it to run `node scripts/publish-run-repositories.mjs` without `--push`. The script builds both repositories and prints what it would send. After you approve, ask it to run the script with `--push`. A push replaces everything in the target repository.
7. Open [claude.ai/code/routines](https://claude.ai/code/routines). Click **New routine**. Repeat steps 8 to 16 six times, once for each task and version in this table:

   | Routine name | Task | Repository |
   |---|---|---|
   | find-all A | find-all | `ky-run-a` |
   | find-all B | find-all | `ky-run-b` |
   | rename A | rename | `ky-run-a` |
   | rename B | rename | `ky-run-b` |
   | retry-count-start A | retry-count-start | `ky-run-a` |
   | retry-count-start B | retry-count-start | `ky-run-b` |

8. Type the routine name from the table into the name field.
9. **Claude:** ask it to run `node scripts/routine-prompts.mjs`. Copy the text under the heading of this routine's task.
10. Click the **Instructions** box. Paste the text.
11. Click the model selector in the prompt box. Select the model that `config/tasks.json` names under `agent.model`.
12. Click **Select repositories**. Pick the repository from the table.
13. Click the cloud icon below the **Instructions** box. Pick **Default**.
14. Under **Select a trigger**, choose **API**.
15. Under **Connectors** at the bottom, remove every connector. Claude can use every tool of an included connector without asking, so a connector gives the agent access to your mail, documents, and other services.
16. Click **Create**.
17. On the routine page, click the menu next to the routine name. Click **Edit**. Under **Select a trigger**, open the **API** trigger. Copy the URL. Click **Generate token**. Copy the token at once: the page shows it one time.
18. Add the routine to `routines` in `work/cloud-routines.json`. The key is the task, a vertical bar, and the version, for example `"find-all|published"`. The published version is the repository you listed first.

    ```json
    "find-all|published": {
    	"url": "https://api.anthropic.com/v1/claude_code/routines/trig_.../fire",
    	"token": "sk-ant-oat01-..."
    }
    ```

    Paste a token only into this file. Never paste one into a chat, an issue, or a commit.
19. After all six routines exist, run one test. Open the routine page of `find-all A`. Click **Run now**. Type `run-id: probe` in the text field and confirm. Click the new run to watch it. When it ends, check three things: the transcript of the run shows that the start hook ran (the agent ran `npx tsc` without a missing-package error), the repository `ky-run-a` on GitHub holds a branch named `run-probe`, and that branch holds a file named `REPLY.md`. If any check fails, stop and send the transcript text to Claude.

## Run the experiment

1. **Claude:** `node scripts/fire-routines.mjs`. The script fires every routine until each task and version has ten runs, in round-robin order. It writes each fired run to `work/runs/cloud-fired.json`.
2. Wait until the runs finish. The page [claude.ai/code](https://claude.ai/code) lists them, and the pending limit below bounds the wait.
3. **Claude:** `node scripts/collect-runs.mjs`. The script fetches the run branches, builds a run copy of the version for each run, applies the branch's changes, and writes the run files. A run that has pushed nothing stays pending. Run the script again later to collect the rest.
4. **Claude:** `node scripts/score-agents.mjs`, then fill the blind review sheet, then `node scripts/summarize-agents.mjs`.

## Limits and caps

| Limit | Value | Reason | Behavior at the limit |
|---|---|---|---|
| Fires per routine per hour | 30 | Service limit, shared with **Run now** | Ten fires per routine fit; the fire script stops at the first error and prints the wait |
| Fires per account per hour | 100 | Service limit | Sixty fires fit; same behavior |
| Wait for one fire request | 30 seconds | Far above a normal answer | The script stops, and the run stays unfired |
| Pending limit | 60 minutes after the fire (`cloud.pendingLimitMinutes` in `config/tasks.json`) | Twice the 30-minute cap of local runs, because the service sets no cap per run | The collect script records the run as a failed run with no changes |

A fire has no idempotency key. A fire request that fails after the service accepted it can leave a run with no record; that run pushes a branch that no script reads.

## Troubleshooting

- A cloud run that fails to push the run branch usually meets a GitHub branch rule on the repository. Open the repository settings on GitHub and remove any rule on branches that start with `run-`.
- If the setup test shows a missing-package error, the start hook did not run. The hook runs only when the run starts in a repository with a single checkout, and only from `.claude/settings.json` in that repository.
- When the GitHub connection lapses, a routine skips its runs for up to 72 hours and then turns off. Reconnect GitHub at [claude.ai/code](https://claude.ai/code), and turn the routine on again if it went off.
