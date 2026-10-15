// Scores agent runs.
//   find tasks: find rate of the listed lines against the ground truth.
//   edit tasks: which concept lines (or required lines) the agent changed, which other lines it changed,
//               type checks, test regressions, and the hidden test if the task has one.
// Writes work/runs/scores.json (no version) and results/blind-review.csv (no version column; a person marks
// wrong edits on it before looking at the key). An existing sheet keeps its rows and answers; only new runs are added.
// Next: summarize-agents.mjs joins the scores to the key, after the sheet is answered.
// Without --skip-tests, every run copy and both versions' baseline test results must be present;
// a missing one stops the script rather than scoring the run on find rate alone.
// Usage: node score-agents.mjs [--skip-tests]
import fs from 'node:fs';
import path from 'node:path';
import {blindSheetColumns, blindSheetRows, changedOriginalLines, corpusFiles, findScore, fromCsv, hiddenTestPath, inCorpus, isHiddenTest, listedLines, loadCodebase, loadConcepts, loadTasks, matchesForms, projectRoot, publishedVersion, judgeLostTitles, readJson, regressionCandidates, renamedRegressions, rerunTest, runChecked, runMeasures, splitKey, toCsv, versionDir, versions, workDir, writeJson} from './lib.mjs';

const skipTests = process.argv.includes('--skip-tests');
const config = loadTasks();
const {concepts} = loadConcepts();
const truth = readJson(path.join(projectRoot, 'truth', 'truth.json'));
const runsDir = path.join(workDir, 'runs');
const runKey = readJson(path.join(runsDir, 'key.json'));
const resultsDir = path.join(projectRoot, 'results');
fs.mkdirSync(resultsDir, {recursive: true});

// Files an agent may name in a find reply, each with its line count: the published codebase's corpus
// when present. Without the checkout, every file in the truth, counted up to its highest truth line;
// a range past that line holds no truth line, so clipping it loses nothing.
const publishedRoot = versionDir(publishedVersion);
const knownFiles = new Map();
if (fs.existsSync(path.join(publishedRoot, loadCodebase().corpus.directory))) {
	for (const file of corpusFiles(publishedRoot)) {
		knownFiles.set(file, fs.readFileSync(path.join(publishedRoot, file), 'utf8').split('\n').length);
	}
} else {
	for (const entry of Object.values(truth.concepts)) {
		for (const line of entry.all) {
			const {file, line: number} = splitKey(line);
			knownFiles.set(file, Math.max(knownFiles.get(file) ?? 0, number));
		}
	}
}

const baseline = Object.fromEntries(versions.map(version => {
	const file = path.join(workDir, `tests-${version}.json`);
	if (fs.existsSync(file)) {
		return [version, readJson(file)];
	}

	if (!skipTests) {
		throw new Error(`Missing baseline ${file}: run scripts/run-tests.mjs ${version}, or pass --skip-tests to score find rate only.`);
	}

	return [version, {tests: {}}];
}));

const scored = [];
for (const [runId, {version, task: taskId}] of Object.entries(runKey)) {
	if (!versions.includes(version)) {
		throw new Error(`Run ${runId}: the key names version "${version}", expected one of ${versions.join(', ')}. A run recorded before the versions were named needs a fresh run.`);
	}

	const runDir = path.join(runsDir, runId);
	const run = readJson(path.join(runDir, 'run.json'));
	const task = config.tasks.find(item => item.id === taskId);
	const concept = concepts.find(item => item.id === task.concept);
	const expected = new Set(truth.concepts[task.concept].all);
	const diff = fs.readFileSync(path.join(runDir, 'diff.patch'), 'utf8');
	const row = {
		runId,
		version,
		task: taskId,
		agentError: run.isError || run.exitCode !== 0 || Boolean(run.runError),
		...runMeasures(run),
	};

	if (task.kind === 'find') {
		const listed = listedLines(fs.readFileSync(path.join(runDir, 'final.md'), 'utf8'), knownFiles);
		Object.assign(row, findScore(listed, expected));
	} else {
		const changed = changedOriginalLines(diff);
		const sourceChanged = [...changed].filter(item => inCorpus(item));
		// Lines the agent had to change: the task's required lines, or for a rename task, the concept's lines that
		// name it (a name the type checker found, or wording matching one of the concept's forms in that version).
		if (!task.requiredLines && !concept.forms) {
			throw new Error(`Concept ${concept.id} has no "forms" pattern in config/concepts.json, which task ${task.id} needs to pick its target lines.`);
		}

		const targets = new Set(task.requiredLines ?? [...expected].filter(item => {
			if (truth.concepts[task.concept].names.includes(item)) {
				return true;
			}

			const {file, line} = splitKey(item);
			return matchesForms(fs.readFileSync(path.join(versionDir(version), file), 'utf8').split('\n'), line, concept.forms);
		}));
		if (targets.size === 0) {
			throw new Error(`Task ${task.id} has no target lines in version ${version}.`);
		}

		row.targetLines = targets.size;
		row.missed = [...targets].filter(item => !changed.has(item)).length;
		row.otherSourceLinesChanged = sourceChanged.filter(item => !expected.has(item) && !targets.has(item)).length;
		row.findRate = (targets.size - row.missed) / targets.size;
		row.testsRun = !skipTests;

		if (!skipTests && !fs.existsSync(run.directory)) {
			throw new Error(`Run ${runId}: run copy ${run.directory} is gone, so its tests cannot run. Pass --skip-tests to score find rate only.`);
		}

		if (!skipTests) {
			// The hidden test lands in the codebase's test directory, where the test run picks it up.
			if (task.hiddenTest) {
				fs.copyFileSync(path.join(projectRoot, task.hiddenTest), hiddenTestPath(run.directory));
			}

			// An old result file is removed first, so a failed run cannot be scored from a stale one. Exit
			// status 1 with a fresh file means the type check failed, which is a result; no file means the run failed.
			const output = path.join(runDir, 'tests.json');
			fs.rmSync(output, {force: true});
			runChecked('node', [path.join(projectRoot, 'scripts', 'run-tests.mjs'), run.directory, output], {stdio: 'inherit'});
			if (!fs.existsSync(output)) {
				throw new Error(`Run ${runId}: the test run wrote no result in ${output}.`);
			}

			const tests = readJson(output);
			// A regression is a test that fails every rerun, a renamed test that fails every rerun under its new
			// title, or a removed test. A test that passes a rerun is flaky. judgeLostTitles gives each lost title
			// one rerun, up to its failure limit per test file, and reports a test file that stopped partway.
			const {rerun, files} = regressionCandidates(baseline[version].tests, tests.tests, loadCodebase().tests.titleSeparator);
			const stoppedPartway = [];
			const failing = [
				...rerun.filter(name => rerunTest(run.directory, name) === 0),
				...files.flatMap(({file, lostTitles, pairs, failingNewTitles}) => {
					const renamed = renamedRegressions(failingNewTitles.filter(title => rerunTest(run.directory, title) === 0), pairs);
					const judged = judgeLostTitles(lostTitles, pairs, title => rerunTest(run.directory, title, 1) === 1);
					if (judged.stoppedPartway) {
						stoppedPartway.push(file);
					}

					return [...renamed, ...Array.from({length: judged.removed}, () => `${file} (test removed)`)];
				}),
			];
			row.testFilesStoppedPartway = stoppedPartway.join('; ');
			row.typecheck = tests.typecheck;
			row.testRegressions = failing.length;
			row.regressedTests = failing.join('; ');
			if (task.hiddenTest) {
				const hidden = Object.entries(tests.tests).filter(([name]) => isHiddenTest(name));
				row.hiddenTestPassed = hidden.length > 0 && hidden.every(([, passed]) => passed);
			}

			row.success = row.typecheck && row.testRegressions === 0 && row.missed === 0 && (row.hiddenTestPassed ?? true);
		} else {
			row.success = row.missed === 0;
		}
	}

	scored.push(row);
}

// Scores carry no version, so nothing a person opens before the blind review shows one. summarize-agents.mjs joins them to the key.
writeJson(path.join(runsDir, 'scores.json'), scored.map(({version, ...score}) => score));

// Blind review sheet: rows already there stay as written, with their answers. New runs follow, shuffled, with no version.
const sheetFile = path.join(resultsDir, 'blind-review.csv');
const existingRows = fs.existsSync(sheetFile) ? fromCsv(fs.readFileSync(sheetFile, 'utf8')) : [];
const relativeRunFile = (runId, name) => path.relative(projectRoot, path.join(runsDir, runId, name));
const sheet = blindSheetRows(existingRows, scored.map(row => ({runId: row.runId, task: row.task, diff: relativeRunFile(row.runId, 'diff.patch'), finalReply: relativeRunFile(row.runId, 'final.md')})));
fs.writeFileSync(sheetFile, toCsv([blindSheetColumns, ...sheet]));
console.log(`Wrote ${path.relative(projectRoot, sheetFile)} (${sheet.length} runs). Fill wrong_edits with yes or no on each row, then run node scripts/summarize-agents.mjs.`);

