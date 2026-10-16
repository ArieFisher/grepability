// Unit tests for containment.mjs and agent-runner.mjs: the launch arguments, settings, and environment
// that keep agent runs and script commands inside the project folder. Run: node --test scripts/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {checkSlotsEmpty, copyIntoSlot, copyName, loadAgent, slotDir} from './agent-runner.mjs';
import {agentArgs, agentEnv, agentSettings, checkAllowedTools, containedEnv} from './containment.mjs';
import {commandTmpDir, publishedVersion, runChecked, toolCalls} from './lib.mjs';

const agent = {tools: 'Read,Edit,Bash', allowedTools: ['Bash(npx tsc:*)'], maxBudgetUsd: 5};
const argsFor = () => agentArgs({prompt: 'p', model: 'sonnet', agent, tmpDir: '/run/tmp'});
const valueAfter = (args, flag) => args[args.indexOf(flag) + 1];

test('agentArgs starts claude in restricted mode with the sandbox settings and no settings files', () => {
	const args = argsFor();
	assert.ok(args.includes('--restricted'));
	assert.ok(!args.includes('--setting-sources'));
	assert.deepEqual(JSON.parse(valueAfter(args, '--settings')), agentSettings('/run/tmp'));
	assert.equal(valueAfter(args, '--permission-mode'), 'acceptEdits');
	assert.equal(valueAfter(args, '--tools'), 'Read,Edit,Bash');
	assert.equal(valueAfter(args, '--allowedTools'), 'Bash(npx tsc:*)');
});

test('agentSettings turns the sandbox on with no unsandboxed fallback and no automatic approval', () => {
	const {sandbox} = agentSettings('/run/tmp');
	assert.equal(sandbox.enabled, true);
	assert.equal(sandbox.failIfUnavailable, true);
	assert.equal(sandbox.allowUnsandboxedCommands, false);
	assert.equal(sandbox.autoAllowBashIfSandboxed, false);
	assert.deepEqual(sandbox.filesystem.allowWrite, ['/run/tmp']);
	assert.equal(sandbox.excludedCommands, undefined);
});

test('checkAllowedTools accepts Bash rules and throws on any file tool rule', () => {
	assert.doesNotThrow(() => checkAllowedTools(['Bash(npx tsc:*)', 'Bash(git diff:*)']));
	for (const rule of ['Edit', 'Write', 'Read', 'Glob', 'Grep', 'Edit(/**)', 'Bash']) {
		assert.throws(() => checkAllowedTools(['Bash(ls:*)', rule]), /may hold only Bash/, rule);
	}

	assert.throws(() => agentArgs({prompt: 'p', model: 'sonnet', agent: {...agent, allowedTools: ['Edit']}, tmpDir: '/run/tmp'}), /Edit/);
});

test('the task configuration holds only Bash rules in agent.allowedTools', () => {
	assert.doesNotThrow(() => checkAllowedTools(loadAgent().allowedTools));
});

test('containedEnv points TMPDIR and the npm cache into the temporary folder and keeps the rest', () => {
	const env = containedEnv({PATH: '/bin', TMPDIR: '/var/folders/x'}, '/project/work/tmp');
	assert.equal(env.PATH, '/bin');
	assert.equal(env.TMPDIR, '/project/work/tmp');
	assert.equal(env.npm_config_cache, '/project/work/tmp/npm-cache');
	assert.equal(agentEnv({}, '/run/tmp').CLAUDE_CODE_TMPDIR, '/run/tmp');
});

test('runChecked gives commands the temporary folder inside the project', () => {
	const result = runChecked('node', ['-e', "console.log(require('node:os').tmpdir() + '\\n' + process.env.npm_config_cache)"]);
	assert.deepEqual(result.stdout.trim().split('\n'), [commandTmpDir, path.join(commandTmpDir, 'npm-cache')]);
});

test('copyIntoSlot throws when the slot still holds a run copy', () => {
	const slot = `test-${process.pid}`;
	fs.mkdirSync(path.join(slotDir(slot), copyName()), {recursive: true});
	try {
		assert.throws(() => copyIntoSlot(slot, publishedVersion), /did not finish/);
	} finally {
		fs.rmSync(slotDir(slot), {recursive: true, force: true});
	}
});

test('checkSlotsEmpty throws when any slot still holds a run copy, and passes when none does', () => {
	const stale = `test-${process.pid}-stale`;
	const empty = `test-${process.pid}-empty`;
	fs.mkdirSync(path.join(slotDir(stale), copyName()), {recursive: true});
	try {
		assert.doesNotThrow(() => checkSlotsEmpty([empty]));
		assert.throws(() => checkSlotsEmpty([empty, stale]), /did not finish/);
	} finally {
		fs.rmSync(slotDir(stale), {recursive: true, force: true});
	}
});

test('toolCalls pairs each tool call with its result and error flag', () => {
	const transcript = [
		{type: 'assistant', message: {content: [{type: 'tool_use', id: 'a', name: 'Bash', input: {command: 'node -e x'}}, {type: 'tool_use', id: 'b', name: 'Read', input: {file_path: '/x'}}]}},
		{type: 'user', message: {content: [{type: 'tool_result', tool_use_id: 'a', content: 'EPERM: operation not permitted', is_error: true}]}},
		{type: 'user', message: {content: [{type: 'tool_result', tool_use_id: 'b', content: [{type: 'text', text: 'line 1'}]}]}},
		{type: 'assistant', message: {content: [{type: 'tool_use', id: 'c', name: 'Write', input: {}}]}},
	].map(event => JSON.stringify(event)).join('\n');
	assert.deepEqual(toolCalls(transcript), [
		{name: 'Bash', input: {command: 'node -e x'}, result: 'EPERM: operation not permitted', isError: true},
		{name: 'Read', input: {file_path: '/x'}, result: 'line 1', isError: false},
		{name: 'Write', input: {}, result: undefined, isError: false},
	]);
});
