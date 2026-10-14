// Unit tests for the results table in results.mjs. Run: node --test scripts/
import assert from 'node:assert/strict';
import test from 'node:test';
import {resultsTable, searchScore} from './results.mjs';

const versionNames = ['published', 'proposed'];
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
const searchRow = (version, concept, findRate, termDistinctiveness) => ({version, concept, findRate, termDistinctiveness});
const searchResults = [
	searchRow('published', 'count', 0.5, 1),
	searchRow('published', 'delay', 0.5, 0.5),
	searchRow('published', 'jitter', 1, 1),
	searchRow('proposed', 'count', 1, 1),
	searchRow('proposed', 'delay', 1, 0.5),
	searchRow('proposed', 'jitter', 1, 1),
];
const run = (version, task, success) => ({version, task, success});
const agentRuns = [
	run('published', 'find', true),
	run('published', 'edit', false),
	run('published', 'jitter-find', true),
	run('proposed', 'find', true),
	run('proposed', 'edit', true),
	run('proposed', 'jitter-find', false),
];
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test('searchScore is the harmonic mean of find rate and term distinctiveness', () => {
	close(searchScore(0.5, 1), 2 / 3);
	assert.equal(searchScore(1, 1), 1);
	assert.equal(searchScore(0, 0), 0);
	assert.equal(searchScore(null, 1), null);
	assert.equal(searchScore(1, null), null);
});

test('resultsTable gives each concept its search score and agent score per version', () => {
	const table = resultsTable({concepts, tasks, searchResults, agentRuns, versionNames});
	const count = table.rows.find(row => row.concept === 'count');
	close(count.byVersion.published.searchScore, 2 / 3);
	assert.equal(count.byVersion.proposed.searchScore, 1);
	assert.deepEqual({successes: count.byVersion.published.agent.successes, runs: count.byVersion.published.agent.runs}, {successes: 1, runs: 2});
	assert.equal(count.byVersion.proposed.agent.score, 1);
	assert.ok(count.byVersion.proposed.agent.interval.low < 1);
	close(count.change.searchScore, 1 / 3);
	assert.equal(count.change.agentScore, 0.5);
});

test('resultsTable gives no agent score to a concept without runs', () => {
	const table = resultsTable({concepts, tasks, searchResults, agentRuns, versionNames});
	const delay = table.rows.find(row => row.concept === 'delay');
	assert.equal(delay.byVersion.published.agent, null);
	assert.equal(delay.change.agentScore, null);
});

test('resultsTable overall row leaves out the control concept', () => {
	const table = resultsTable({concepts, tasks, searchResults, agentRuns, versionNames});
	close(table.overall.byVersion.published.searchScore, ((2 / 3) + 0.5) / 2);
	close(table.overall.byVersion.proposed.searchScore, (1 + (2 / 3)) / 2);
	assert.equal(table.overall.byVersion.published.agent.score, 0.5);
	assert.equal(table.overall.byVersion.proposed.agent.score, 1);
	assert.equal(table.overall.change.agentScore, 0.5);
});

test('resultsTable with no agent runs gives every agent score as null', () => {
	const table = resultsTable({concepts, tasks, searchResults, agentRuns: [], versionNames});
	assert.ok(table.rows.every(row => versionNames.every(version => row.byVersion[version].agent === null)));
	assert.equal(table.overall.byVersion.published.agent, null);
});

test('resultsTable throws when a concept has no search result in a version', () => {
	assert.throws(() => resultsTable({concepts, tasks, searchResults: searchResults.slice(1), agentRuns, versionNames}), /count.*published/);
});

test('resultsTable throws on a run whose task is not in the task configuration', () => {
	assert.throws(() => resultsTable({concepts, tasks, searchResults, agentRuns: [run('published', 'gone', true)], versionNames}), /gone/);
});
