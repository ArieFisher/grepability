// Unit tests for the cloud run helpers in cloud.mjs. Run: node --test scripts/
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {applyDiff, buildCloudAgentTaskRunRepository, cellKey, cloudPrompt, FireError, fireRoutine, fetchCloudAgentTaskRunBranches, loadCloud, loadRoutines, readCloudAgentTaskRunBranch, shellLine, startFiles} from './cloud.mjs';
import {diffSinceSnapshot, loadTasks, makeAgentTaskRunCopy} from './lib.mjs';

const routine = {url: 'https://api.anthropic.com/v1/claude_code/routines/trig_ABC123/fire', token: 'sk-ant-oat01-secret'};
const goodFile = {
	repositories: {published: 'https://github.com/o/a.git', proposed: 'https://github.com/o/b.git'},
	routines: {[cellKey('find-all', 'published')]: routine},
};

const withScratch = run => {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-test-'));
	try {
		return run(scratch);
	} finally {
		fs.rmSync(scratch, {recursive: true, force: true});
	}
};

const writeRoutines = (scratch, content) => {
	const file = path.join(scratch, 'routines.json');
	fs.writeFileSync(file, JSON.stringify(content));
	return file;
};

const response = (status, body, headers = {}) => ({
	ok: status >= 200 && status < 300,
	status,
	headers: {get: name => headers[name.toLowerCase()] ?? null},
	json: async () => body,
});

test('loadCloud reads the cloud settings and the configuration holds them', () => {
	const cloud = loadCloud();
	assert.equal(cloud.defaultBranch, 'main');
	assert.ok(Number.isInteger(cloud.pendingLimitMinutes));
});

test('cloudPrompt keeps the task prompt and names the payload, the run branch, and the reply file', () => {
	const cloud = loadCloud();
	const task = loadTasks().tasks[0];
	const prompt = cloudPrompt(task, cloud);
	assert.ok(prompt.startsWith(task.prompt));
	assert.match(prompt, /routine-fire-payload/);
	assert.ok(prompt.includes(`${cloud.cloudAgentTaskRunBranchPrefix}<id>`));
	assert.ok(prompt.includes(cloud.replyFile));
});

test('loadRoutines accepts a complete file', () => withScratch(scratch => {
	const file = writeRoutines(scratch, goodFile);
	assert.deepEqual(loadRoutines([cellKey('find-all', 'published')], file).routines, goodFile.routines);
}));

test('loadRoutines throws on a missing file, a missing repository, a missing cell, a wrong address, and a wrong token', () => withScratch(scratch => {
	const cells = [cellKey('find-all', 'published')];
	assert.throws(() => loadRoutines(cells, path.join(scratch, 'none.json')), /Missing/);
	assert.throws(() => loadRoutines(cells, writeRoutines(scratch, {...goodFile, repositories: {published: 'https://x/y.git'}})), /repositories\.proposed/);
	assert.throws(() => loadRoutines([cellKey('rename', 'published')], writeRoutines(scratch, goodFile)), /rename\|published/);
	assert.throws(() => loadRoutines(cells, writeRoutines(scratch, {...goodFile, routines: {[cells[0]]: {...routine, url: 'https://example.com/fire'}}})), /url/);
	const badToken = {...goodFile, routines: {[cells[0]]: {...routine, token: 'not-a-token'}}};
	assert.throws(() => loadRoutines(cells, writeRoutines(scratch, badToken)), error => /token/.test(error.message) && !error.message.includes('not-a-token'));
}));

test('fireRoutine posts the run id with the bearer token and returns the session', async () => {
	const calls = [];
	const fetchStub = async (url, options) => {
		calls.push({url, options});
		return response(200, {type: 'routine_fire', claude_code_session_id: 'session_1', claude_code_session_url: 'https://claude.ai/code/session_1'});
	};

	const session = await fireRoutine(routine, 'abcd1234', fetchStub);
	assert.deepEqual(session, {sessionId: 'session_1', sessionUrl: 'https://claude.ai/code/session_1'});
	assert.equal(calls[0].url, routine.url);
	assert.equal(calls[0].options.method, 'POST');
	assert.equal(calls[0].options.headers.Authorization, `Bearer ${routine.token}`);
	assert.equal(calls[0].options.headers['anthropic-version'], '2023-06-01');
	assert.deepEqual(JSON.parse(calls[0].options.body), {text: 'run-id: abcd1234'});
});

test('fireRoutine throws a FireError with the status and the retry delay of a 429 answer', async () => {
	const fetchStub = async () => response(429, {type: 'error', error: {type: 'rate_limit_error', message: 'limit'}}, {'retry-after': '120'});
	await assert.rejects(fireRoutine(routine, 'abcd1234', fetchStub), error => error instanceof FireError && error.status === 429 && error.retryAfterSeconds === 120 && /rate_limit_error/.test(error.message) && !error.message.includes(routine.token));
});

test('fireRoutine throws on an answer that is not a created session', async () => {
	await assert.rejects(fireRoutine(routine, 'abcd1234', async () => response(200, {type: 'other'})), /not a created routine session/);
});

test('shellLine quotes words that hold more than plain characters', () => {
	assert.equal(shellLine(['npm', 'install', '--ignore-scripts']), 'npm install --ignore-scripts');
	assert.equal(shellLine(['echo', "it's here", 'a b']), String.raw`echo 'it'\''s here' 'a b'`);
});

test('startFiles writes a start hook that runs the install and compile commands and logs their output', () => {
	const files = startFiles({install: ['npm', 'install'], compile: ['npm', 'run', 'build']});
	const settings = JSON.parse(files['.claude/settings.json']);
	assert.equal(settings.hooks.SessionStart[0].hooks[0].command, 'bash "$CLAUDE_PROJECT_DIR/.claude/prepare.sh"');
	assert.match(files['.claude/prepare.sh'], /\{ npm install && npm run build; \} >\/tmp\/prepare\.log 2>&1/);
});

test('buildCloudAgentTaskRunRepository commits a version and the start files as one commit on the default branch, without dependencies', () => withScratch(scratch => {
	const cloud = {defaultBranch: 'main'};
	const source = path.join(scratch, 'source');
	fs.mkdirSync(path.join(source, 'src'), {recursive: true});
	fs.writeFileSync(path.join(source, 'src', 'a.ts'), 'export {};\n');
	const directory = path.join(scratch, 'repository');
	const head = buildCloudAgentTaskRunRepository(source, directory, cloud, {'.claude/prepare.sh': 'echo hi\n'});
	const git = (...args) => execFileSync('git', args, {cwd: directory, encoding: 'utf8'});
	assert.equal(git('rev-parse', 'HEAD').trim(), head);
	assert.equal(git('branch', '--show-current').trim(), 'main');
	assert.equal(git('rev-list', '--count', 'HEAD').trim(), '1');
	assert.deepEqual(git('ls-files').trim().split('\n'), ['.claude/prepare.sh', 'src/a.ts']);
	assert.ok(!fs.existsSync(path.join(directory, 'node_modules')));
}));

test('fetchCloudAgentTaskRunBranches and readCloudAgentTaskRunBranch return the diff and the reply of a pushed run branch', () => withScratch(scratch => {
	const cloud = {defaultBranch: 'main', cloudAgentTaskRunBranchPrefix: 'run-', replyFile: 'REPLY.md'};
	const origin = path.join(scratch, 'origin');
	fs.mkdirSync(origin);
	const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${os.devNull}`, ...args], {cwd, encoding: 'utf8'});
	git(origin, 'init', '-q', '-b', 'main');
	fs.writeFileSync(path.join(origin, 'a.txt'), 'one\ntwo\nthree\n');
	git(origin, 'add', '-A');
	git(origin, 'commit', '-q', '-m', 'start');
	git(origin, 'switch', '-q', '-c', 'run-abcd1234');
	fs.writeFileSync(path.join(origin, 'a.txt'), 'one\nTWO\nthree\n');
	fs.writeFileSync(path.join(origin, 'REPLY.md'), 'done\n');
	git(origin, 'add', '-A');
	git(origin, 'commit', '-q', '-m', 'work');

	const cache = path.join(scratch, 'cache');
	fetchCloudAgentTaskRunBranches(cache, origin);
	const result = readCloudAgentTaskRunBranch(cache, cloud, 'abcd1234');
	assert.equal(result.reply, 'done\n');
	assert.match(result.diff, /^--- a\/a\.txt$/m);
	assert.match(result.diff, /^\+\+\+ b\/a\.txt$/m);
	assert.ok(!result.diff.includes('REPLY.md'));
	assert.equal(readCloudAgentTaskRunBranch(cache, cloud, 'ffffffff'), null);
}));

test('applyDiff reproduces a run branch edit in a run copy, and fails on a diff that does not fit', () => withScratch(scratch => {
	const source = path.join(scratch, 'source');
	fs.mkdirSync(source);
	fs.writeFileSync(path.join(source, 'a.txt'), 'one\ntwo\nthree\n');
	fs.writeFileSync(path.join(source, '.gitignore'), 'node_modules/\n');
	const {directory, snapshot} = makeAgentTaskRunCopy(source, path.join(scratch, 'copy'));
	const diff = '--- a/a.txt\n+++ b/a.txt\n@@ -2 +2 @@\n-two\n+TWO\n';
	applyDiff(directory, diff);
	assert.equal(fs.readFileSync(path.join(directory, 'a.txt'), 'utf8'), 'one\nTWO\nthree\n');
	assert.match(diffSinceSnapshot(directory, snapshot), /^\+TWO$/m);
	assert.throws(() => applyDiff(directory, '--- a/missing.txt\n+++ b/missing.txt\n@@ -1 +1 @@\n-x\n+y\n'), /git apply failed/);
	assert.doesNotThrow(() => applyDiff(directory, ''));
}));
