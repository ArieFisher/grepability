// Builds the ground truth: every line of the published codebase where each concept appears.
//   Names in code: the type checker's references for each seed symbol in config/concepts.json.
//   Comments and strings: lines the reviewers tagged (truth/reviewer-*.csv). Lines all reviewers agree on
//   count; disagreements go to truth/disagreements.csv. Copy that file to truth/adjudication.csv and set
//   `decision` to yes or no on each row; adjudicated rows then count too. Without adjudication the
//   truth is marked provisional.
// Usage: node ground-truth.mjs
import fs from 'node:fs';
import path from 'node:path';
import {createService, fromCsv, inCorpus, key, lineOf, loadConcepts, loadCodebase, positionOf, projectRoot, relative, toCsv, versionDir, writeJson} from './lib.mjs';

const root = versionDir('published');
const {concepts} = loadConcepts();
const service = createService(root);
const truthDir = path.join(projectRoot, 'truth');

// Names in code.
const identifierLines = new Map(concepts.map(concept => [concept.id, new Set()]));
for (const concept of concepts) {
	for (const seed of concept.seeds) {
		const position = positionOf(root, seed.file, seed.line, seed.name, seed.nth ?? 0);
		identifierLines.get(concept.id).add(key(seed.file, seed.line));
		for (const symbol of service.findReferences(path.join(root, seed.file), position) ?? []) {
			for (const reference of symbol.references) {
				const file = relative(root, reference.fileName);
				if (inCorpus(file)) {
					identifierLines.get(concept.id).add(key(file, lineOf(root, file, reference.textSpan.start)));
				}
			}
		}
	}
}

// Comments and strings.
const reviewerFiles = fs.readdirSync(truthDir).filter(file => /^reviewer-.+\.csv$/.test(file)).sort();
if (reviewerFiles.length === 0) {
	throw new Error('No reviewer files in truth/. Run extract-review-sheet.mjs and tag it first.');
}

const reviewers = reviewerFiles.map(file => ({
	name: file.replace(/^reviewer-|\.csv$/g, ''),
	tags: new Map(fromCsv(fs.readFileSync(path.join(truthDir, file), 'utf8'))
		.map(row => [key(row.file, row.line), {row, ids: new Set(row.concepts.split(/\s+/).filter(Boolean))}])),
}));
const rowKeys = [...reviewers[0].tags.keys()];
const adjudicationFile = path.join(truthDir, 'adjudication.csv');
const adjudication = new Map(fs.existsSync(adjudicationFile)
	? fromCsv(fs.readFileSync(adjudicationFile, 'utf8')).map(row => [`${key(row.file, row.line)}|${row.concept}`, row.decision.trim().toLowerCase()])
	: []);

const textLines = new Map(concepts.map(concept => [concept.id, new Set()]));
const disagreements = [];
const agreement = {};
let unresolved = 0;
for (const concept of concepts) {
	let both = 0;
	let neither = 0;
	let split = 0;
	for (const rowKey of rowKeys) {
		const votes = reviewers.map(reviewer => reviewer.tags.get(rowKey)?.ids.has(concept.id) ?? false);
		if (votes.every(Boolean)) {
			both++;
			textLines.get(concept.id).add(rowKey);
		} else if (votes.some(Boolean)) {
			split++;
			const decision = adjudication.get(`${rowKey}|${concept.id}`) ?? '';
			if (decision === 'yes') {
				textLines.get(concept.id).add(rowKey);
			} else if (decision !== 'no') {
				unresolved++;
			}

			const {row} = reviewers[0].tags.get(rowKey);
			disagreements.push([row.file, row.line, concept.id, reviewers.filter((_, i) => votes[i]).map(reviewer => reviewer.name).join(' '), decision, row.text]);
		} else {
			neither++;
		}
	}

	// Cohen's kappa for two reviewers; with more, the share of agreeing rows.
	const total = both + neither + split;
	const observed = (both + neither) / total;
	let kappa = null;
	if (reviewers.length === 2) {
		const [a, b] = reviewers.map(reviewer => rowKeys.filter(rowKey => reviewer.tags.get(rowKey)?.ids.has(concept.id)).length / total);
		const expected = (a * b) + ((1 - a) * (1 - b));
		kappa = expected === 1 ? 1 : (observed - expected) / (1 - expected);
	}

	agreement[concept.id] = {agreedYes: both, disagreed: split, kappa: kappa === null ? null : Number(kappa.toFixed(3))};
}

fs.writeFileSync(path.join(truthDir, 'disagreements.csv'), toCsv([['file', 'line', 'concept', 'tagged_by', 'decision', 'text'], ...disagreements]));

const sortKeys = keys => [...keys].sort((a, b) => {
	const [fileA, lineA] = a.split(':');
	const [fileB, lineB] = b.split(':');
	return fileA.localeCompare(fileB) || Number(lineA) - Number(lineB);
});

const truth = {
	commit: loadCodebase().commit,
	reviewers: reviewers.map(reviewer => reviewer.name),
	provisional: unresolved > 0,
	unresolvedDisagreements: unresolved,
	agreement,
	concepts: Object.fromEntries(concepts.map(concept => {
		const names = identifierLines.get(concept.id);
		const text = textLines.get(concept.id);
		return [concept.id, {
			names: sortKeys(names),
			text: sortKeys(text),
			all: sortKeys(new Set([...names, ...text])),
		}];
	})),
};
writeJson(path.join(truthDir, 'truth.json'), truth);

for (const concept of concepts) {
	const entry = truth.concepts[concept.id];
	const {kappa, disagreed} = agreement[concept.id];
	console.log(`${concept.id}: ${entry.all.length} lines (${entry.names.length} from names, ${entry.text.length} from comments/strings); reviewer kappa ${kappa ?? 'n/a'}, ${disagreed} disagreements`);
}

console.log(truth.provisional
	? `Provisional: ${unresolved} disagreements unresolved. Decide them in truth/adjudication.csv (copy of truth/disagreements.csv) and rerun.`
	: 'All disagreements resolved.');
