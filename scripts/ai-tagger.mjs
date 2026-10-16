// AI stand-in tagger: tags the tagging sheet, one chunk per fresh session, with no tools.
// Each execution of the script is independent; run it twice with different names to get two taggers. A person can
// replace either file by tagging truth/tagging-sheet.csv by hand.
// Each sheet line is shown with the source lines around it (--context, default 3 each side), so the
// tagger sees which option or function a comment belongs to rather than the line on its own.
// Usage: node ai-tagger.mjs <tagger-name> [--model sonnet] [--chunk 120] [--parallel 4] [--context 3]
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {acceptTags, codebaseVersionDir, fromCsv, integerOption, loadConcepts, loadTasks, option, projectRoot, publishedCodebaseVersion, toCsv} from './lib.mjs';

const argv = process.argv.slice(2);
const name = argv[0];
if (!name || name.startsWith('--')) {
	throw new Error('Usage: node ai-tagger.mjs <tagger-name> [--model sonnet] [--chunk 120] [--parallel 4] [--context 3]');
}

// The tagger starts the same command and model as the agent, so one place holds them.
const {agent} = loadTasks();
const model = option(argv, 'model', agent.model);
const chunkSize = integerOption(argv, 'chunk', 120, 1);
const parallel = integerOption(argv, 'parallel', 4, 1);
const contextLines = integerOption(argv, 'context', 3, 0);
// A hand-tagged file under this name would be lost to a second execution, so an existing file stops the script.
// Remove the file, or pick another tagger name, to run the script again.
const output = path.join(projectRoot, 'truth', `tagger-${name}.csv`);
if (fs.existsSync(output)) {
	throw new Error(`${output} exists. Remove it or pick another tagger name.`);
}
const {concepts} = loadConcepts();
const rows = fromCsv(fs.readFileSync(path.join(projectRoot, 'truth', 'tagging-sheet.csv'), 'utf8'));
const conceptText = concepts.map(concept => `- ${concept.id}: ${concept.name}. ${concept.definition}`).join('\n');

// Source text of the published codebase, read once per file, for the context around each sheet line.
const sourceCache = new Map();
const sourceLines = file => {
	if (!sourceCache.has(file)) {
		sourceCache.set(file, fs.readFileSync(path.join(codebaseVersionDir(publishedCodebaseVersion), file), 'utf8').split('\n'));
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
	const child = spawn(agent.command, ['-p', '--model', model, '--tools', '', '--output-format', 'json', '--no-session-persistence', '--strict-mcp-config'], {stdio: ['pipe', 'pipe', 'pipe']});
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
			reject(new Error(`${agent.command} exited ${code}: ${stderr.slice(0, 500)}`));
			return;
		}

		try {
			resolve(JSON.parse(stdout));
		} catch (error) {
			reject(new Error(`${agent.command} printed output that is not JSON: ${error.message}`));
		}
	});
	child.on('error', error => {
		reject(new Error(`${agent.command} did not start: ${error.message}`));
	});
	child.stdin.end(text);
});

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
				const chunkItems = new Set(chunks[chunkIndex].map(item => item.index));
				for (const [index, ids] of acceptTags(reply.result, chunkItems, validIds)) {
					tags.set(index, ids);
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

fs.writeFileSync(output, toCsv([
	['file', 'line', 'kind', 'concepts', 'text'],
	...rows.map((row, index) => [row.file, row.line, row.kind, (tags.get(index) ?? []).join(' '), row.text]),
]));
console.log(`${name}: ${[...tags.values()].filter(ids => ids.length > 0).length} tagged lines, $${cost.toFixed(2)} -> ${output}`);
