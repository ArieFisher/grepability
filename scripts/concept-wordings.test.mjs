// Self-tests for the concept wordings section in concept-wordings.mjs. Run: node --test scripts/
import assert from 'node:assert/strict';
import test from 'node:test';
import {conceptWordings} from './concept-wordings.mjs';

const concepts = [
	{id: 'count', name: 'Retry count', proposedSearchPattern: 'retry count', publishedSearchPattern: 'retry count|attempt count'},
	{id: 'jitter', name: 'Jitter', proposedSearchPattern: 'jitter', control: true},
];
const edits = {
	nameEdits: [
		{concept: 'count', file: 'a.ts', line: 4, name: 'attemptCount', newName: 'retryCount'},
		{concept: 'count', file: 'b.ts', line: 9, name: 'attemptCount', newName: 'retryCount'},
	],
	comments: [
		{concept: 'count', file: 'a.ts', line: 2, from: 'The attempts.', to: 'The retry count.'},
		{concept: 'count', file: 'b.ts', line: 7, from: 'The attempts.', to: 'The retry count.'},
		{concept: 'count', file: 'c.ts', line: 1, from: 'a | b `c`', to: 'retry count'},
	],
};

test('conceptWordings gives each concept its proposed search pattern, its published search pattern, and its edits', () => {
	const markdown = conceptWordings(concepts, edits).join('\n');
	assert.match(markdown, /## Retry count\n\nProposed search pattern: `retry count`\n\nPublished search pattern: `retry count\|attempt count`/);
	assert.match(markdown, /\| Name edit \| `attemptCount` \| `retryCount` \| 2 \| a\.ts:4, b\.ts:9 \|/);
	assert.match(markdown, /\| Wording edit \| `The attempts\.` \| `The retry count\.` \| 2 \| a\.ts:2, b\.ts:7 \|/);
});

test('conceptWordings escapes a pipe and a backtick in a wording so the table keeps its columns', () => {
	const markdown = conceptWordings(concepts, edits).join('\n');
	assert.match(markdown, /\| Wording edit \| `` a \\\| b `c` `` \| `retry count` \| 1 \| c\.ts:1 \|/);
});

test('conceptWordings states that a concept without a published search pattern or edits records none', () => {
	const markdown = conceptWordings(concepts, edits).join('\n');
	assert.match(markdown, /## Jitter\n\nProposed search pattern: `jitter`\n\nPublished search pattern: not recorded\.\n\nThe proposed codebase build makes no edit for this concept\./);
});

test('conceptWordings throws on an edit whose concept is not in the concept configuration', () => {
	assert.throws(() => conceptWordings(concepts, {nameEdits: [{...edits.nameEdits[0], concept: 'gone'}], comments: []}), /gone/);
});

test('conceptWordings throws when the proposed edits lack a list of name edits or wording edits', () => {
	assert.throws(() => conceptWordings(concepts, {nameEdits: []}), /comments/);
	assert.throws(() => conceptWordings(concepts, {comments: []}), /nameEdits/);
});
