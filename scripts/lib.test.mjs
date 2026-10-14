// Unit tests for the pure helpers in lib.mjs. Run: node --test scripts/
import assert from 'node:assert/strict';
import test from 'node:test';
import {changedOriginalLines, fisherExact, fromCsv, interleave, listedLines, shuffle, toCsv, wilson} from './helpers.mjs';

test('listedLines reads single lines, ranges, and bare file names from the last fenced block', () => {
	const known = ['source/core/client.ts', 'source/types/retry.ts'];
	const reply = [
		'Here is a draft:',
		'```',
		'source/core/client.ts:1',
		'```',
		'Final list:',
		'```text',
		'source/core/client.ts:440',
		'./source/core/client.ts:441-443',
		'types/retry.ts:18',
		'client.ts:500 – 501',
		'```',
	].join('\n');
	assert.deepEqual([...listedLines(reply, known)].sort(), [
		'source/core/client.ts:440',
		'source/core/client.ts:441',
		'source/core/client.ts:442',
		'source/core/client.ts:443',
		'source/core/client.ts:500',
		'source/core/client.ts:501',
		'source/types/retry.ts:18',
	]);
});

test('listedLines keeps an unknown or ambiguous file name as written', () => {
	const known = ['source/a/index.ts', 'source/b/index.ts'];
	assert.deepEqual([...listedLines('index.ts:3 and other.ts:4', known)].sort(), ['index.ts:3', 'other.ts:4']);
});

test('changedOriginalLines maps hunks to old-side lines and ignores new files', () => {
	const diff = [
		'--- a/source/x.ts',
		'+++ b/source/x.ts',
		'@@ -10,2 +10,3 @@',
		'-old',
		'-old',
		'+new',
		'@@ -20 +21 @@',
		'-old',
		'+new',
		'@@ -30,0 +32,2 @@',
		'+inserted',
		'--- /dev/null',
		'+++ b/test/new.ts',
		'@@ -0,0 +1,5 @@',
		'+a',
	].join('\n');
	assert.deepEqual([...changedOriginalLines(diff)].sort(), ['source/x.ts:10', 'source/x.ts:11', 'source/x.ts:20']);
});

test('interleave puts one job from every cell in each round', () => {
	const jobs = [];
	for (const cell of ['a', 'b', 'c']) {
		for (let index = 0; index < 4; index++) {
			jobs.push({cell, index});
		}
	}

	const ordered = interleave(jobs, job => job.cell);
	assert.equal(ordered.length, 12);
	for (let round = 0; round < 4; round++) {
		const cells = ordered.slice(round * 3, (round * 3) + 3).map(job => job.cell).sort();
		assert.deepEqual(cells, ['a', 'b', 'c']);
	}
});

test('shuffle returns a permutation and leaves the input alone', () => {
	const input = [1, 2, 3, 4, 5];
	const output = shuffle(input);
	assert.deepEqual(input, [1, 2, 3, 4, 5]);
	assert.deepEqual([...output].sort(), input);
});

test('wilson brackets the observed share and clamps to [0, 1]', () => {
	const interval = wilson(9, 10);
	assert.ok(interval.low < 0.9 && interval.high > 0.9);
	assert.ok(interval.low > 0.5);
	assert.equal(wilson(10, 10).high, 1);
	assert.equal(wilson(0, 10).low, 0);
	assert.equal(wilson(0, 0), null);
});

test('fisherExact matches known values', () => {
	assert.ok(Math.abs(fisherExact(0, 10, 9, 1) - 0.000_112_8) < 1e-5);
	assert.ok(Math.abs(fisherExact(9, 1, 6, 4) - 0.303) < 0.002);
	assert.equal(fisherExact(5, 5, 5, 5), 1);
});

test('csv round-trips quoted fields', () => {
	const rows = [['a', 'b'], ['x,y', 'say "hi"\nthere']];
	const parsed = fromCsv(toCsv(rows));
	assert.deepEqual(parsed, [{a: 'x,y', b: 'say "hi"\nthere'}]);
});
