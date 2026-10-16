// Search score: one case-insensitive ripgrep search per concept per version, scored against the ground truth.
// Recall: share of the concept's lines the search returns. Precision: share of hits that belong to the concept.
// The script removes each concept's locked lines, which the concept configuration lists, from both parts in both versions.
// Writes results/search-score.{json,md} and results/misses-<version>.csv (the lines each search missed;
// the published codebase's misses are the worklist for building the proposed codebase).
// Usage: node search-score.mjs
import fs from 'node:fs';
import path from 'node:path';
import {isNameLine, key, loadCodebase, loadConcepts, percent, projectRoot, readJson, readLockedLines, runChecked, searchRates, splitKey, toCsv, truthLines, truthStatement, versionDir, versions, writeJson} from './lib.mjs';

const {concepts} = loadConcepts();
const {corpus} = loadCodebase();
const truth = readJson(path.join(projectRoot, 'truth', 'truth.json'));
const present = versions.filter(version => fs.existsSync(path.join(versionDir(version), corpus.directory)));
if (present.length === 0) {
	throw new Error('No versions under work/: run scripts/setup.sh first. Nothing written to results/.');
}

// A run that scores fewer versions than the experiment compares says so in the output.
const absent = versions.filter(version => !present.includes(version));
const scope = absent.length > 0 ? `Scored ${present.join(' and ')} only: ${absent.join(' and ')} is not built.` : '';
if (scope) {
	console.warn(scope);
}

const resultsDir = path.join(projectRoot, 'results');

// ripgrep exits 0 with hits, 1 with none, and 2 on an error. A missing program or a signal throws in runChecked.
const search = (root, pattern) => {
	const result = runChecked('rg', ['--ignore-case', '--line-number', '--no-heading', '--with-filename', '--glob', `*${corpus.extension}`, '--regexp', pattern, corpus.directory], {cwd: root});
	if (result.status > 1) {
		throw new Error(`rg failed on ${pattern}: ${result.stderr}`);
	}

	return new Set(result.stdout.split('\n').filter(Boolean).map(line => {
		const [file, number] = line.split(':');
		return key(file, Number(number));
	}));
};

// The trimmed text of one line, or undefined past the end of the file.
const lineText = (root, file, line) => fs.readFileSync(path.join(root, file), 'utf8').split('\n')[line - 1]?.trim();

// Every search and line read finishes before any file is written, so a failure leaves results/ as it was.
const results = [];
const missesByVersion = new Map();
for (const version of present) {
	const root = versionDir(version);
	// readLockedLines checks every entry in each version, so an entry whose text is missing from either version stops the script.
	const lockedByConcept = readLockedLines(concepts, (file, line) => lineText(root, file, line));
	const misses = [];
	missesByVersion.set(version, misses);
	for (const concept of concepts) {
		const expected = new Set(truthLines(truth.concepts[concept.id]));
		const {missed, ...rates} = searchRates(expected, search(root, concept.proposedSearchPattern), lockedByConcept.get(concept.id));
		results.push({
			version,
			concept: concept.id,
			control: Boolean(concept.control),
			search: concept.proposedSearchPattern,
			...rates,
		});
		for (const line of missed) {
			const {file, line: number} = splitKey(line);
			misses.push([concept.id, file, number, isNameLine(truth.concepts[concept.id], line) ? 'name' : 'text', lineText(root, file, number)]);
		}
	}
}

fs.mkdirSync(resultsDir, {recursive: true});
writeJson(path.join(resultsDir, 'search-score.json'), {truth: {provisional: truth.provisional, unresolvedDisagreements: truth.unresolvedDisagreements, adjudicators: truth.adjudicators}, results});
for (const [version, misses] of missesByVersion) {
	fs.writeFileSync(path.join(resultsDir, `misses-${version}.csv`), toCsv([['concept', 'file', 'line', 'source', 'text'], ...misses]));
}

const rows = concepts.map(concept => {
	const cells = present.flatMap(version => {
		const result = results.find(item => item.version === version && item.concept === concept.id);
		return [`${percent(result.recall)} (${result.truePositives}/${result.truthLines})`, percent(result.precision)];
	});
	return `| ${concept.name} | \`${concept.proposedSearchPattern}\` | ${cells.join(' | ')} |`;
});
const header = `| Concept | Search | ${present.map(version => `Recall ${version} | Precision ${version}`).join(' | ')} |`;
const markdown = [
	'# Search score',
	'',
	truthStatement(truth),
	...(scope ? ['', scope] : []),
	'',
	header,
	`|${'---|'.repeat(2 + (present.length * 2))}`,
	...rows,
	'',
].join('\n');
fs.writeFileSync(path.join(resultsDir, 'search-score.md'), markdown);
console.log(markdown);
