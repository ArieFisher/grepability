// Self-tests for the per-concept sections in concept-edits.mjs. Run: node --test scripts/
import assert from 'node:assert/strict';
import test from 'node:test';
import {codeCell, conceptEdits} from './concept-edits.mjs';

const concepts = [
	{id: 'count', name: 'Retry count', proposedSearchPattern: 'retry count', publishedSearchPattern: 'retry count|attempt count'},
	{id: 'jitter', name: 'Jitter', proposedSearchPattern: 'jitter', control: true},
];
const edits = {
	nameEdits: [
		{concept: 'count', file: 'a.ts', line: 4, name: 'attemptCount', newName: 'retryCount'},
		{concept: 'count', file: 'b.ts', line: 9, name: 'attemptCount', newName: 'retryCount'},
	],
	wordingEdits: [
		{concept: 'count', file: 'a.ts', line: 2, from: 'The attempts.', to: 'The retry count.'},
		{concept: 'count', file: 'b.ts', line: 7, from: 'The attempts.', to: 'The retry count.'},
	],
};

test('conceptEdits gives each concept its proposed search pattern, its published search pattern, and its edits', () => {
	const markdown = conceptEdits(concepts, edits).join('\n');
	assert.match(markdown, /## Retry count\n\nProposed search pattern: ` retry count `\n\nPublished search pattern: ` retry count\|attempt count `/);
	assert.match(markdown, /\| Wording edit \| ` The attempts\. ` \| ` The retry count\. ` \| 2 \| a\.ts:2, b\.ts:7 \|/);
});

test('conceptEdits gives a name edit row its declarations, because the build changes every reference to the name', () => {
	const markdown = conceptEdits(concepts, edits).join('\n');
	assert.match(markdown, /\| Name edit \| ` attemptCount ` \| ` retryCount ` \| every reference \| declared at a\.ts:4, b\.ts:9 \|/);
});

test('codeCell escapes a pipe and fences a backtick so the table keeps its columns', () => {
	assert.equal(codeCell('a | b `c`'), '`` a \\| b `c` ``');
	assert.equal(codeCell(' padded '), '`  padded  `');
});

test('conceptEdits states that a concept without a published search pattern or edits records none', () => {
	const markdown = conceptEdits(concepts, edits).join('\n');
	assert.match(markdown, /## Jitter\n\nProposed search pattern: ` jitter `\n\nPublished search pattern: not recorded\.\n\nThe proposed codebase build makes no edit for this concept\./);
});

test('conceptEdits throws on an edit whose concept is not in the concept configuration', () => {
	assert.throws(() => conceptEdits(concepts, {nameEdits: [{...edits.nameEdits[0], concept: 'gone'}], wordingEdits: []}), /gone/);
});

test('conceptEdits throws on a missing list of name edits or wording edits', () => {
	assert.throws(() => conceptEdits(concepts, {nameEdits: []}), /wordingEdits/);
	assert.throws(() => conceptEdits(concepts, {wordingEdits: []}), /nameEdits/);
});

test('conceptEdits throws on an edit that lacks a field', () => {
	assert.throws(() => conceptEdits(concepts, {nameEdits: [], wordingEdits: [{concept: 'count', file: 'a.ts', line: 2, from: 'x'}]}), /lacks to/);
	assert.throws(() => conceptEdits(concepts, {nameEdits: [{concept: 'count', name: 'a', newName: 'b'}], wordingEdits: []}), /lacks file, line/);
});
