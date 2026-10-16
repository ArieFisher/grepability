// Builds the ground truth: every line of the published codebase where each concept appears.
//   Names in code: the type checker's references for each seed symbol in config/concepts.json.
//   Comments and strings: lines the reviewers tagged (truth/reviewer-*.csv). Lines all reviewers agree on
//   count; disagreements go to truth/disagreements.csv. Duplicate that file as truth/adjudication.csv and set
//   `decision` to yes or no and `adjudicator` to who decided, a person or an AI stand-in, on each row;
//   adjudicated rows then count too, and truth.json lists the adjudicators. Without adjudication the
//   truth is marked provisional.
// Usage: node ground-truth.mjs
import fs from 'node:fs';
import path from 'node:path';
import {checkReviewers, createService, fromCsv, inCorpus, key, lineKindOf, lineOf, loadCodebase, loadConcepts, positionOf, projectRoot, publishedVersion, readAdjudication, readLineKinds, relative, runChecked, splitKey, toCsv, usedAdjudicators, versionDir, writeJson} from './lib.mjs';

const root = versionDir(publishedVersion);
const {concepts} = loadConcepts();
const truthDir = path.join(projectRoot, 'truth');
const lineKinds = readLineKinds(fs.readFileSync(path.join(projectRoot, 'docs', 'vocabulary.md'), 'utf8'));

// The ground truth records the commit it was built on, so the checkout must be that commit.
const checkedOut = runChecked('git', ['rev-parse', 'HEAD'], {cwd: root}).stdout.trim();
if (checkedOut !== loadCodebase().commit) {
	throw new Error(`${root} is at ${checkedOut}, not the pinned commit ${loadCodebase().commit}. Run scripts/setup.sh.`);
}

const service = createService(root);

// Names in code, each line with the line kinds of the declarations its names refer to. A seed that the
// type checker resolves to no reference means a wrong file, line, or name. Each declaration kind that the
// line kinds table lacks is recorded with its lines, so the summary can list it.
const nameLines = new Map(concepts.map(concept => [concept.id, new Map()]));
const otherKinds = new Map();
const addNameLine = (conceptId, line, declarationKind) => {
	const kind = lineKindOf(declarationKind, lineKinds.mapping);
	if (kind === 'other') {
		otherKinds.set(declarationKind, (otherKinds.get(declarationKind) ?? new Set()).add(line));
	}

	const lines = nameLines.get(conceptId);
	lines.set(line, (lines.get(line) ?? new Set()).add(kind));
};

for (const concept of concepts) {
	for (const seed of concept.seeds) {
		const position = positionOf(root, seed.file, seed.line, seed.name, seed.nth ?? 0);
		const symbols = service.findReferences(path.join(root, seed.file), position) ?? [];
		if (symbols.every(symbol => symbol.references.length === 0)) {
			throw new Error(`Seed ${seed.name} at ${seed.file}:${seed.line} of concept ${concept.id} resolves to no references.`);
		}

		for (const symbol of symbols) {
			for (const reference of symbol.references) {
				const file = relative(root, reference.fileName);
				if (inCorpus(file)) {
					addNameLine(concept.id, key(file, lineOf(root, file, reference.textSpan.start)), symbol.definition.kind);
				}
			}
		}

		// The seed line counts even when no reference lands on it; it then takes the kinds of the seed's symbols.
		const seedLine = key(seed.file, seed.line);
		if (!nameLines.get(concept.id).has(seedLine)) {
			for (const symbol of symbols) {
				addNameLine(concept.id, seedLine, symbol.definition.kind);
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
const sheetRows = fromCsv(fs.readFileSync(path.join(truthDir, 'review-sheet.csv'), 'utf8'));
const rowKeys = sheetRows.map(row => key(row.file, row.line));
// A text line takes the line kind the review sheet records for it.
const textKind = new Map(sheetRows.map(row => {
	if (!lineKinds.kinds.includes(row.kind)) {
		throw new Error(`truth/review-sheet.csv: ${row.file}:${row.line} has kind "${row.kind}", which the line kinds table lacks.`);
	}

	return [key(row.file, row.line), row.kind];
}));
checkReviewers(rowKeys, reviewers, new Set(concepts.map(concept => concept.id)));
const adjudicationFile = path.join(truthDir, 'adjudication.csv');
const adjudication = readAdjudication(fs.existsSync(adjudicationFile)
	? fromCsv(fs.readFileSync(adjudicationFile, 'utf8'))
	: []);

const textLines = new Map(concepts.map(concept => [concept.id, new Set()]));
const disagreements = [];
const disagreementKeys = new Set();
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
			const decisionKey = `${rowKey}|${concept.id}`;
			disagreementKeys.add(decisionKey);
			const {decision, adjudicator} = adjudication.get(decisionKey) ?? {decision: '', adjudicator: ''};
			if (decision === 'yes') {
				textLines.get(concept.id).add(rowKey);
			} else if (decision !== 'no') {
				unresolved++;
			}

			const {row} = reviewers[0].tags.get(rowKey);
			disagreements.push([row.file, row.line, concept.id, reviewers.filter((_, i) => votes[i]).map(reviewer => reviewer.name).join(' '), decision, adjudicator, row.text]);
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

const adjudicators = usedAdjudicators(adjudication, disagreementKeys);
fs.writeFileSync(path.join(truthDir, 'disagreements.csv'), toCsv([['file', 'line', 'concept', 'tagged_by', 'decision', 'adjudicator', 'text'], ...disagreements]));

const sortKeys = keys => [...keys].sort((a, b) => {
	const first = splitKey(a);
	const second = splitKey(b);
	return first.file.localeCompare(second.file) || first.line - second.line;
});

const truth = {
	commit: loadCodebase().commit,
	reviewers: reviewers.map(reviewer => reviewer.name),
	provisional: unresolved > 0,
	unresolvedDisagreements: unresolved,
	adjudicators,
	agreement,
	// Each concept maps every line, in file and line order, to its sorted line kinds.
	concepts: Object.fromEntries(concepts.map(concept => {
		const kindsByLine = new Map([...nameLines.get(concept.id)].map(([line, kinds]) => [line, new Set(kinds)]));
		for (const line of textLines.get(concept.id)) {
			kindsByLine.set(line, (kindsByLine.get(line) ?? new Set()).add(textKind.get(line)));
		}

		return [concept.id, {lines: Object.fromEntries(sortKeys(kindsByLine.keys()).map(line => [line, [...kindsByLine.get(line)].sort()]))}];
	})),
};
writeJson(path.join(truthDir, 'truth.json'), truth);

for (const concept of concepts) {
	const kinds = Object.values(truth.concepts[concept.id].lines);
	const perKind = lineKinds.kinds
		.map(kind => [kind, kinds.filter(lineKindList => lineKindList.includes(kind)).length])
		.filter(([, count]) => count > 0)
		.map(([kind, count]) => `${count} ${kind}`)
		.join(', ');
	const {kappa, disagreed} = agreement[concept.id];
	console.log(`${concept.id}: ${kinds.length} lines (${perKind}); reviewer kappa ${kappa ?? 'n/a'}, ${disagreed} disagreements`);
}

for (const [declarationKind, lines] of otherKinds) {
	console.log(`Declaration kind "${declarationKind}" maps to other on ${lines.size} lines. Add it to the line kinds table in docs/vocabulary.md if it belongs to a line kind.`);
}

console.log(truth.provisional
	? `Provisional: ${unresolved} disagreements unresolved. Decide them in truth/adjudication.csv (a duplicate of truth/disagreements.csv) and rerun.`
	: 'All disagreements resolved.');
