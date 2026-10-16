// Search score: one case-insensitive pattern search per concept per codebase version, scored against the ground
// truth. Recall: share of the concept's lines the pattern search returns. Precision: share of hits that belong to
// the concept. The script removes each concept's locked lines, which the concept configuration lists, from both
// parts in both codebase versions.
// Writes results/search-score.{json,md} and results/misses-<codebase version>.csv (the lines each pattern search
// missed; the published codebase's misses are the worklist for building the proposed codebase).
// Below the table, search-score.md gives each concept's search patterns and the edits the proposed codebase build makes.
// Usage: node search-score.mjs
import fs from 'node:fs';
import path from 'node:path';
import {conceptWordings} from './concept-wordings.mjs';
import {codebaseVersionDir, codebaseVersions, isNameLine, key, loadCodebase, loadConcepts, loadProposedEdits, percent, projectRoot, readJson, readLockedLines, runChecked, searchRates, splitKey, toCsv, truthLines, truthStatement, writeJson} from './lib.mjs';

const {concepts} = loadConcepts();
const {corpus} = loadCodebase();
const wordings = conceptWordings(concepts, loadProposedEdits());
const truth = readJson(path.join(projectRoot, 'truth', 'truth.json'));
const present = codebaseVersions.filter(codebaseVersion => fs.existsSync(path.join(codebaseVersionDir(codebaseVersion), corpus.directory)));
if (present.length === 0) {
	throw new Error('No codebase versions under work/: run scripts/setup.sh first. Nothing written to results/.');
}

// When the script scores fewer codebase versions than the experiment compares, the output says so.
const absent = codebaseVersions.filter(codebaseVersion => !present.includes(codebaseVersion));
const scope = absent.length > 0 ? `Scored ${present.join(' and ')} only: ${absent.join(' and ')} is not built.` : '';
if (scope) {
	console.warn(scope);
}

const resultsDir = path.join(projectRoot, 'results');

// ripgrep exits 0 with hits, 1 with none, and 2 on an error. A missing program or a signal throws in runChecked.
const patternSearch = (root, pattern) => {
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

// Every pattern search and line read finishes before any file is written, so a failure leaves results/ as it was.
const results = [];
const missesByCodebaseVersion = new Map();
for (const codebaseVersion of present) {
	const root = codebaseVersionDir(codebaseVersion);
	// readLockedLines checks every entry in each codebase version, so an entry whose text is missing from either
	// codebase version stops the script.
	const lockedByConcept = readLockedLines(concepts, (file, line) => lineText(root, file, line));
	const misses = [];
	missesByCodebaseVersion.set(codebaseVersion, misses);
	for (const concept of concepts) {
		const expected = new Set(truthLines(truth.concepts[concept.id]));
		const {missed, ...rates} = searchRates(expected, patternSearch(root, concept.proposedSearchPattern), lockedByConcept.get(concept.id));
		results.push({
			codebaseVersion,
			concept: concept.id,
			control: Boolean(concept.control),
			proposedSearchPattern: concept.proposedSearchPattern,
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
for (const [codebaseVersion, misses] of missesByCodebaseVersion) {
	fs.writeFileSync(path.join(resultsDir, `misses-${codebaseVersion}.csv`), toCsv([['concept', 'file', 'line', 'source', 'text'], ...misses]));
}

const rows = concepts.map(concept => {
	const cells = present.flatMap(codebaseVersion => {
		const result = results.find(item => item.codebaseVersion === codebaseVersion && item.concept === concept.id);
		return [`${percent(result.recall)} (${result.truePositives}/${result.truthLines})`, percent(result.precision)];
	});
	return `| ${concept.name} | \`${concept.proposedSearchPattern}\` | ${cells.join(' | ')} |`;
});
const header = `| Concept | Proposed search pattern | ${present.map(codebaseVersion => `Recall ${codebaseVersion} | Precision ${codebaseVersion}`).join(' | ')} |`;
const markdown = [
	'# Search score',
	'',
	truthStatement(truth),
	...(scope ? ['', scope] : []),
	'',
	header,
	`|${'---|'.repeat(2 + (present.length * 2))}`,
	...rows,
	...wordings,
	'',
].join('\n');
fs.writeFileSync(path.join(resultsDir, 'search-score.md'), markdown);
console.log(markdown);
