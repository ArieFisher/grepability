// Stand-in reviewer: an AI model tags the reviewer sheet, one chunk per fresh session, with no tools.
// Each run is independent; run it twice with different names to get two reviewers. A person can
// replace either file by tagging truth/review-sheet.csv by hand.
// Each sheet line is shown with the source lines around it (--context, default 3 each side), so the
// reviewer sees which option or function a comment belongs to rather than the line on its own.
// Usage: node ai-review.mjs <reviewer-name> [--model sonnet] [--chunk 120] [--parallel 4] [--context 3]
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fromCsv, loadConcepts, projectRoot, toCsv, versionDir} from './lib.mjs';

const argv = process.argv.slice(2);
const option = (name, fallback) => {
	const index = argv.indexOf(`--${name}`);
	return index === -1 ? fallback : argv[index + 1];
};

const name = argv[0];
if (!name || name.startsWith('--')) {
	throw new Error('Usage: node ai-review.mjs <reviewer-name> [--model sonnet] [--chunk 120] [--parallel 4]');
}

const model = option('model', 'sonnet');
const chunkSize = Number(option('chunk', 120));
const parallel = Number(option('parallel', 4));
const contextLines = Number(option('context', 3));
const {concepts} = loadConcepts();
const rows = fromCsv(fs.readFileSync(path.join(projectRoot, 'truth', 'review-sheet.csv'), 'utf8'));
const conceptText = concepts.map(concept => `- ${concept.id}: ${concept.name}. ${concept.definition}`).join('\n');

// Source text of the published codebase, read once per file, for the context around each sheet line.
const sourceCache = new Map();
const sourceLines = file => {
	if (!sourceCache.has(file)) {
		sourceCache.set(file, fs.readFileSync(path.join(versionDir('published'), file), 'utf8').split('\n'));
	}

	return sourceCache.get(file);
};

// One sheet line with its neighbours; the line under judgement is marked with `>`.
const withContext = ({index, row}) => {
	const lines = sourceLines(row.file);
	const line = Number(row.line);
	const first = Math.max(1, line - contextLines);
	const last = Math.min(lines.length, line + contextLines);
	const block = [];
	for (let number = first; number <= last; number++) {
		block.push(`${number === line ? '>' : ' '} ${lines[number - 1]}`);
	}

	return `#${index} ${row.file}:${row.line}\n${block.join('\n')}`;
};

const prompt = chunk => `You are tagging lines of a TypeScript repository's source for a code-search study.
Each item below is one line to judge, marked with ">", shown with the source lines around it. Decide which of these concepts the marked line refers to; the surrounding lines are context only. A line refers to a concept when its words or code describe, name, or use that concept, in any wording, including synonyms and code examples inside documentation. A line can refer to several concepts or none. Judge meaning, not keywords: a word that matches a concept's usual name but means something else does not count, and a line that describes the concept without using its usual name does count.

Concepts:
${conceptText}

Items (#number file:line, then the source with the judged line marked ">"):
${chunk.map(item => withContext(item)).join('\n\n')}

Reply with only a JSON object mapping item numbers to arrays of concept ids, listing only items whose marked line refers to at least one concept. Example: {"12": ["retry-count"], "15": ["retry-delay", "jitter"]}`;

const ask = text => new Promise((resolve, reject) => {
	const child = spawn('claude', ['-p', '--model', model, '--tools', '', '--output-format', 'json', '--no-session-persistence', '--strict-mcp-config'], {stdio: ['pipe', 'pipe', 'pipe']});
	let stdout = '';
	let stderr = '';
	child.stdout.on('data', data => {
		stdout += data;
	});
	child.stderr.on('data', data => {
		stderr += data;
	});
	child.on('close', code => {
		if (code !== 0) {
			reject(new Error(`claude exited ${code}: ${stderr.slice(0, 500)}`));
			return;
		}

		resolve(JSON.parse(stdout));
	});
	child.stdin.end(text);
});

// Replies hold flat objects of arrays. If the model corrects itself, the last object wins.
const parseTags = result => {
	const objects = (result.match(/\{[^{}]*\}/g) ?? []).flatMap(text => {
		try {
			return [JSON.parse(text)];
		} catch {
			return [];
		}
	});
	if (objects.length === 0) {
		throw new Error(`No JSON object in reply: ${result.slice(0, 300)}`);
	}

	return objects.at(-1);
};

const indexed = rows.map((row, index) => ({index, row}));
const chunks = [];
for (let i = 0; i < indexed.length; i += chunkSize) {
	chunks.push(indexed.slice(i, i + chunkSize));
}

const tags = new Map();
let cost = 0;
const validIds = new Set(concepts.map(concept => concept.id));
const queue = [...chunks.keys()];
const worker = async () => {
	while (queue.length > 0) {
		const chunkIndex = queue.shift();
		let attempt = 0;
		for (;;) {
			try {
				// eslint-disable-next-line no-await-in-loop
				const reply = await ask(prompt(chunks[chunkIndex]));
				cost += reply.total_cost_usd ?? 0;
				for (const [index, ids] of Object.entries(parseTags(reply.result))) {
					tags.set(Number(index), ids.filter(id => validIds.has(id)));
				}

				console.log(`${name}: chunk ${chunkIndex + 1}/${chunks.length} done`);
				break;
			} catch (error) {
				attempt++;
				if (attempt >= 3) {
					throw error;
				}

				console.log(`${name}: chunk ${chunkIndex + 1} failed (${error.message.slice(0, 120)}), retrying`);
			}
		}
	}
};

await Promise.all(Array.from({length: parallel}, worker));

const output = path.join(projectRoot, 'truth', `reviewer-${name}.csv`);
fs.writeFileSync(output, toCsv([
	['file', 'line', 'kind', 'concepts', 'text'],
	...rows.map((row, index) => [row.file, row.line, row.kind, (tags.get(index) ?? []).join(' '), row.text]),
]));
console.log(`${name}: ${[...tags.values()].filter(ids => ids.length > 0).length} tagged lines, $${cost.toFixed(2)} -> ${output}`);
