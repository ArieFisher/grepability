// Unit tests for the results table in results.mjs. Run: node --test scripts/
import assert from 'node:assert/strict';
import test from 'node:test';
import {resultsTable, searchScore} from './results.mjs';

const codebaseVersionNames = ['published', 'proposed'];
const concepts = [
	{id: 'count', name: 'Count'},
	{id: 'delay', name: 'Delay'},
	{id: 'jitter', name: 'Jitter', control: true},
];
const tasks = [
	{id: 'find', concept: 'count'},
	{id: 'edit', concept: 'count'},
	{id: 'jitter-find', concept: 'jitter'},
];
const searchRow = (version, concept, recall, precision) => ({version, concept, recall, precision});
const searchResults = [
	searchRow('published', 'count', 0.5, 1),
	searchRow('published', 'delay', 0.5, 0.5),
	searchRow('published', 'jitter', 1, 1),
	searchRow('proposed', 'count', 1, 1),
	searchRow('proposed', 'delay', 1, 0.5),
	searchRow('proposed', 'jitter', 1, 1),
];
const run = (version, task, success) => ({version, task, success});
const agentTaskRuns = [
	run('published', 'find', true),
	run('published', 'edit', false),
	run('published', 'jitter-find', true),
	run('proposed', 'find', true),
	run('proposed', 'edit', true),
	run('proposed', 'jitter-find', false),
];
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test('searchScore is the harmonic mean of recall and precision', () => {
	close(searchScore(0.5, 1), 2 / 3);
	assert.equal(searchScore(1, 1), 1);
	assert.equal(searchScore(0, 0), 0);
	assert.equal(searchScore(null, 1), null);
	assert.equal(searchScore(1, null), null);
});

test('searchScore of a search with no hits is 0, because its recall is 0', () => {
	assert.equal(searchScore(0, null), 0);
});

test('resultsTable overall search score is null when a measured concept has no search score in a version', () => {
	const noTruth = searchResults.map(row => row.version === 'proposed' && row.concept === 'delay' ? {...row, recall: null} : row);
	const table = resultsTable({concepts, tasks, searchResults: noTruth, agentTaskRuns, codebaseVersionNames});
	assert.equal(table.overall.byCodebaseVersion.proposed.searchScore, null);
	assert.equal(table.overall.change.searchScore, null);
});

test('resultsTable counts the runs scored without the type check and the tests', () => {
	const skipped = [...agentTaskRuns, {...run('published', 'edit', true), testsRun: false}];
	assert.equal(resultsTable({concepts, tasks, searchResults, agentTaskRuns: skipped, codebaseVersionNames}).skippedAgentTaskRuns, 1);
	assert.equal(resultsTable({concepts, tasks, searchResults, agentTaskRuns, codebaseVersionNames}).skippedAgentTaskRuns, 0);
});

test('resultsTable counts the runs with unknown success and leaves them out of the agent score', () => {
	const unknown = [...agentTaskRuns, run('published', 'edit', null)];
	const table = resultsTable({concepts, tasks, searchResults, agentTaskRuns: unknown, codebaseVersionNames});
	assert.equal(table.unknownAgentTaskRuns, 1);
	assert.equal(table.rows[0].byCodebaseVersion.published.agent.agentTaskRuns, 2);
	assert.equal(resultsTable({concepts, tasks, searchResults, agentTaskRuns, codebaseVersionNames}).unknownAgentTaskRuns, 0);
});

test('resultsTable gives each concept its search score and agent score per version', () => {
	const table = resultsTable({concepts, tasks, searchResults, agentTaskRuns, codebaseVersionNames});
	const count = table.rows.find(row => row.concept === 'count');
	close(count.byCodebaseVersion.published.searchScore, 2 / 3);
	assert.equal(count.byCodebaseVersion.proposed.searchScore, 1);
	assert.deepEqual({successes: count.byCodebaseVersion.published.agent.successes, agentTaskRuns: count.byCodebaseVersion.published.agent.agentTaskRuns}, {successes: 1, agentTaskRuns: 2});
	assert.equal(count.byCodebaseVersion.proposed.agent.score, 1);
	assert.ok(count.byCodebaseVersion.proposed.agent.interval.low < 1);
	close(count.change.searchScore, 1 / 3);
	assert.equal(count.change.agentScore, 0.5);
});

test('resultsTable gives no agent score to a concept without runs', () => {
	const table = resultsTable({concepts, tasks, searchResults, agentTaskRuns, codebaseVersionNames});
	const delay = table.rows.find(row => row.concept === 'delay');
	assert.equal(delay.byCodebaseVersion.published.agent, null);
	assert.equal(delay.change.agentScore, null);
});

test('resultsTable overall row leaves out the control concept', () => {
	const table = resultsTable({concepts, tasks, searchResults, agentTaskRuns, codebaseVersionNames});
	close(table.overall.byCodebaseVersion.published.searchScore, ((2 / 3) + 0.5) / 2);
	close(table.overall.byCodebaseVersion.proposed.searchScore, (1 + (2 / 3)) / 2);
	assert.equal(table.overall.byCodebaseVersion.published.agent.score, 0.5);
	assert.equal(table.overall.byCodebaseVersion.proposed.agent.score, 1);
	assert.equal(table.overall.change.agentScore, 0.5);
});

test('resultsTable with no agent runs gives every agent score as null', () => {
	const table = resultsTable({concepts, tasks, searchResults, agentTaskRuns: [], codebaseVersionNames});
	assert.ok(table.rows.every(row => codebaseVersionNames.every(version => row.byCodebaseVersion[version].agent === null)));
	assert.equal(table.overall.byCodebaseVersion.published.agent, null);
});

test('resultsTable throws when a concept has no search result in a version', () => {
	assert.throws(() => resultsTable({concepts, tasks, searchResults: searchResults.slice(1), agentTaskRuns, codebaseVersionNames}), /count.*published/);
});

test('resultsTable throws on a run whose task is not in the task configuration', () => {
	assert.throws(() => resultsTable({concepts, tasks, searchResults, agentTaskRuns: [run('published', 'gone', true)], codebaseVersionNames}), /gone/);
});
