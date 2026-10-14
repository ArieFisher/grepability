// Cloud runs: the agent runs in claude.ai/code routines on two private repositories, one per version.
// This module holds what the fire, publish, and collect scripts share: the routine prompt, the routine
// file, the fire request, the files that install dependencies on start, and the reading of a run branch.
import fs from 'node:fs';
import path from 'node:path';
import {loadCodebase, loadTasks, projectRoot, readJson, runChecked, versions} from './lib.mjs';

// The routine file holds the repository address of each version and the address and token of each routine.
// The file sits in work/, which git ignores, because the tokens are secrets.
export const routinesFile = path.join(projectRoot, 'work', 'cloud-routines.json');

// Cap on the wait for a fire request: 30 seconds, far above a normal answer. A request that reaches the
// cap fails and fires nothing that the script records, so the person fires that run again.
export const fireTimeoutMs = 30_000;

const fireUrl = /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_\w+\/fire$/;
const tokenPrefix = 'sk-ant-oat01-';

export const cellKey = (taskId, version) => `${taskId}|${version}`;

// The cloud settings of config/tasks.json. Every field is required, so a missing one fails here.
export const loadCloud = () => {
	const {cloud} = loadTasks();
	const missing = ['defaultBranch', 'runBranchPrefix', 'replyFile', 'pendingLimitMinutes'].filter(field => cloud?.[field] === undefined);
	if (missing.length > 0) {
		throw new Error(`config/tasks.json cloud is missing: ${missing.join(', ')}`);
	}

	if (!Number.isInteger(cloud.pendingLimitMinutes) || cloud.pendingLimitMinutes < 1) {
		throw new Error('config/tasks.json: cloud.pendingLimitMinutes must be a whole number of at least 1');
	}

	return cloud;
};

export const runBranch = (cloud, runId) => `${cloud.runBranchPrefix}${runId}`;

// The instructions to paste into a routine: the task prompt, then how the run reports its work. The fire
// request passes the run id as text, and the routine treats that text as data unless the prompt names it,
// so the instructions name the routine-fire-payload block.
export const cloudPrompt = (task, cloud) => `${task.prompt}

How this run reports its work. The routine-fire-payload block holds one line, "run-id: <id>". Create a branch named ${cloud.runBranchPrefix}<id> from the default branch and do all your work on it. When you finish, write the complete text of your final reply to a file named ${cloud.replyFile} in the repository root. That file is the one file you may add beyond what the task asks, even when the task says not to edit files. Commit all your changes, including ${cloud.replyFile}, to the run branch and push that branch to origin. Do not open a pull request and do not push any other branch.`;

// Reads and checks the routine file for the given cells: one repository address per version, and a
// routine address and token per cell. An error names the cell or version and never prints a token.
export const loadRoutines = (cells, file = routinesFile) => {
	if (!fs.existsSync(file)) {
		throw new Error(`Missing ${file}: see docs/cloud-runs.md for how to create it.`);
	}

	const {repositories, routines} = readJson(file);
	for (const version of versions) {
		if (typeof repositories?.[version] !== 'string' || !repositories[version].startsWith('https://')) {
			throw new Error(`${file}: repositories.${version} must be an https address.`);
		}
	}

	for (const cell of cells) {
		const routine = routines?.[cell];
		if (!routine || !fireUrl.test(routine.url ?? '')) {
			throw new Error(`${file}: routines["${cell}"].url must be the https://api.anthropic.com/v1/claude_code/routines/trig_.../fire address that the web form shows.`);
		}

		if (typeof routine.token !== 'string' || !routine.token.startsWith(tokenPrefix)) {
			throw new Error(`${file}: routines["${cell}"].token must be the token the web form shows, which starts with ${tokenPrefix}.`);
		}
	}

	return {repositories, routines};
};

// An error from a fire request. `status` is the HTTP status; `retryAfterSeconds` comes from a 429 answer.
export class FireError extends Error {
	constructor(message, status, retryAfterSeconds) {
		super(message);
		this.name = 'FireError';
		this.status = status;
		this.retryAfterSeconds = retryAfterSeconds;
	}
}

// Fires a routine once for one run. The text of the request carries the run id. Returns the session
// the service created. Any answer but a created session throws a FireError that holds no token.
export const fireRoutine = async (routine, runId, fetchFunction = fetch) => {
	const response = await fetchFunction(routine.url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${routine.token}`,
			'anthropic-version': '2023-06-01',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({text: `run-id: ${runId}`}),
		signal: AbortSignal.timeout(fireTimeoutMs),
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		const retryAfter = Number(response.headers.get('retry-after'));
		throw new FireError(`HTTP ${response.status} ${body.error?.type ?? ''}: ${body.error?.message ?? 'no message'}`.trim(), response.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
	}

	if (body.type !== 'routine_fire' || !body.claude_code_session_id) {
		throw new FireError('The answer is not a created routine session.', response.status);
	}

	return {sessionId: body.claude_code_session_id, sessionUrl: body.claude_code_session_url};
};

// A command as one shell line, with single quotes around any word that holds more than plain characters.
export const shellLine = command => command
	.map(word => /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", String.raw`'\''`)}'`)
	.join(' ');

// The files that go into each run repository, so the agent can run the type check and the tests: a start
// hook that installs dependencies and compiles. Both versions get the same files. The hook's output goes to a
// log, because a start hook's output reaches the agent as context.
export const startFiles = (codebase = loadCodebase()) => ({
	'.claude/settings.json': JSON.stringify({
		hooks: {SessionStart: [{matcher: 'startup', hooks: [{type: 'command', command: 'bash "$CLAUDE_PROJECT_DIR/.claude/prepare.sh"'}]}]},
	}, null, '\t') + '\n',
	'.claude/prepare.sh': [
		'#!/usr/bin/env bash',
		'# Installs dependencies and compiles, so the type check and the tests can run in this session.',
		'set -euo pipefail',
		'cd "$CLAUDE_PROJECT_DIR"',
		`{ ${shellLine(codebase.install)} && ${shellLine(codebase.compile)}; } >/tmp/prepare.log 2>&1`,
		'',
	].join('\n'),
});

// Fetches every branch of a run repository into a bare cache repository, creating the cache on first use.
export const fetchRunBranches = (cacheDirectory, url) => {
	fs.mkdirSync(cacheDirectory, {recursive: true});
	if (!fs.existsSync(path.join(cacheDirectory, 'HEAD'))) {
		runChecked('git', ['init', '--bare', '-q'], {cwd: cacheDirectory});
	}

	const result = runChecked('git', ['fetch', '--prune', '--quiet', url, '+refs/heads/*:refs/heads/*'], {cwd: cacheDirectory});
	if (result.status !== 0) {
		throw new Error(`git fetch from ${url} failed: ${result.stderr.slice(-500)}`);
	}
};

// Applies a diff without context lines (from readRunBranch) to a run copy. An empty diff changes nothing.
export const applyDiff = (directory, diff) => {
	if (diff === '') {
		return;
	}

	const result = runChecked('git', ['apply', '--unidiff-zero', '--whitespace=nowarn', '-'], {cwd: directory, input: diff});
	if (result.status !== 0) {
		throw new Error(`git apply failed in ${directory}: ${result.stderr.slice(-500)}`);
	}
};

// What a run branch holds in a fetched cache: the diff against the default branch (no context lines, a/ and
// b/ prefixes, the reply file left out) and the text of the reply file, or null when the file is missing.
// Returns null when the branch does not exist, which means the run has not pushed.
export const readRunBranch = (cacheDirectory, cloud, runId) => {
	const git = (...args) => runChecked('git', args, {cwd: cacheDirectory});
	const branch = `refs/heads/${runBranch(cloud, runId)}`;
	if (git('rev-parse', '--verify', '--quiet', branch).status !== 0) {
		return null;
	}

	const base = git('merge-base', `refs/heads/${cloud.defaultBranch}`, branch);
	if (base.status !== 0) {
		throw new Error(`The run branch ${runBranch(cloud, runId)} shares no history with ${cloud.defaultBranch}.`);
	}

	const diff = git('diff', '--unified=0', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', base.stdout.trim(), branch, '--', '.', `:(exclude)${cloud.replyFile}`);
	if (diff.status !== 0) {
		throw new Error(`git diff failed for run ${runId}: ${diff.stderr.slice(-500)}`);
	}

	const reply = git('show', `${branch}:${cloud.replyFile}`);
	return {diff: diff.stdout, reply: reply.status === 0 ? reply.stdout : null};
};
