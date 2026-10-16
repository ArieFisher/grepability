// Pure helpers with no TypeScript dependency: keys, shuffling, diff and reply parsing, statistics, CSV.
import crypto from 'node:crypto';
import path from 'node:path';

export const key = (file, line) => `${file}:${line}`;

// The inverse of key: a file:line key back into its file and its line number.
export const splitKey = fileLine => {
	const colon = fileLine.lastIndexOf(':');
	return {file: fileLine.slice(0, colon), line: Number(fileLine.slice(colon + 1))};
};

// The value after `--name` in an argument list, or the fallback when the flag is absent.
export const option = (argv, name, fallback) => {
	const index = argv.indexOf(`--${name}`);
	return index === -1 ? fallback : argv[index + 1];
};

// A whole number option of at least `minimum`. Text, fractions, and small values stop the script,
// because Number() turns them into NaN or a value that makes a loop run nothing or run forever.
export const integerOption = (argv, name, fallback, minimum) => {
	const value = Number(option(argv, name, fallback));
	if (!Number.isInteger(value) || value < minimum) {
		throw new Error(`--${name} must be a whole number of at least ${minimum}`);
	}

	return value;
};

// Test results from TAP output: title to pass or fail. SKIP and TODO results carry no verdict.
export const parseTap = output => {
	const tests = {};
	for (const line of output.split('\n')) {
		const match = /^(not ok|ok) \d+ - (.+?)(?: # (SKIP|TODO).*)?$/.exec(line);
		if (match && !match[3]) {
			tests[match[2]] = match[1] === 'ok';
		}
	}

	return tests;
};

// Renamed tests read from a run's diff, as a map from new test title to old test title. The diff must have zero
// context lines, so each hunk holds only changed lines. In each hunk of a test file, the test declarations it
// removes pair in order with the test declarations it adds, when the two counts are equal; a pair whose titles
// match is no rename. `tests` is the tests section of the codebase configuration: its declaration pattern
// captures the title a test declaration declares. A title holding a template expression is skipped, because the
// test command prints the expression's value, and so is a title holding an escape other than a quote or a
// backslash. A file header with a quoted path under the test directory throws, because the script reads no quoted path.
export const renamedTitles = (diff, tests) => {
	const declaration = new RegExp(tests.declaration);
	const testFilePrefix = file => {
		const relative = path.posix.relative(tests.directory, file);
		const isTestFile = !relative.startsWith('..') && relative.endsWith(tests.extension) && !tests.skip.includes(relative);
		return isTestFile ? relative.slice(0, -tests.extension.length).split('/').join(tests.titleSeparator) : undefined;
	};

	const headerPrefix = line => {
		const value = line.slice(4).replace(/\t$/, '');
		if (value === '/dev/null') {
			return undefined;
		}

		const file = /^[ab]\/(.+)$/.exec(value)?.[1];
		if (file !== undefined) {
			return testFilePrefix(file);
		}

		// Git quotes a path that holds an unusual character. One outside the test directory holds no test.
		const isTestPath = /^"[ab]\/(.+)"$/.exec(value)?.[1].startsWith(`${tests.directory}/`) ?? true;
		if (isTestPath) {
			throw new Error(`renamedTitles cannot read the file header "${line}".`);
		}

		return undefined;
	};

	const titleOf = (prefix, line) => {
		const title = declaration.exec(line.slice(1))?.groups.title;
		const isReadable = title !== undefined && !title.includes('${') && !/\\[^'"`\\]/.test(title);
		return isReadable ? `${prefix}${tests.titleSeparator}${title.replaceAll(/\\(.)/g, '$1')}` : undefined;
	};

	const renames = new Map();
	const pairHunk = (oldPrefix, newPrefix, lines) => {
		const removed = oldPrefix === undefined ? [] : lines.filter(line => line.startsWith('-')).map(line => titleOf(oldPrefix, line)).filter(Boolean);
		const added = newPrefix === undefined ? [] : lines.filter(line => line.startsWith('+')).map(line => titleOf(newPrefix, line)).filter(Boolean);
		if (removed.length === added.length) {
			for (const [index, title] of added.entries()) {
				if (title !== removed[index]) {
					renames.set(title, removed[index]);
				}
			}
		}
	};

	const lines = diff.split('\n');
	let oldPrefix;
	let newPrefix;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		if (line.startsWith('diff --git ')) {
			[oldPrefix, newPrefix] = [undefined, undefined];
		} else if (line.startsWith('--- ')) {
			oldPrefix = headerPrefix(line);
		} else if (line.startsWith('+++ ')) {
			newPrefix = headerPrefix(line);
		}

		const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
		if (hunk) {
			// The body ends when its removed and added lines reach the hunk's counts; a no-newline marker counts as neither.
			let [removedLeft, addedLeft] = [Number(hunk[1] ?? 1), Number(hunk[2] ?? 1)];
			const body = [];
			while ((removedLeft > 0 || addedLeft > 0) && index + 1 < lines.length) {
				const bodyLine = lines[++index];
				removedLeft -= bodyLine.startsWith('-') ? 1 : 0;
				addedLeft -= bodyLine.startsWith('+') ? 1 : 0;
				body.push(bodyLine);
			}

			pairHunk(oldPrefix, newPrefix, body);
		}
	}

	return renames;
};

// Tests that may be regressions, matched by test title within each test file (the title up to the first
// separator). `renames` maps a renamed test's new title to its old title, so a renamed test is judged by its
// own result. rerun: run titles of tests that passed in the baseline and fail in the run; each needs a rerun to
// rule out flakiness. files: each test file with baseline-passing tests the run's results lack, as lostTitles
// under their run title, so a rerun finds a renamed test under its new title.
export const regressionCandidates = (baselineTests, runTests, renames, separator) => {
	const fileOf = title => title.split(separator)[0];
	const newTitles = new Map([...renames].map(([newTitle, oldTitle]) => [oldTitle, newTitle]));
	const runTitleOf = title => newTitles.get(title) ?? title;
	const passing = Object.entries(baselineTests).filter(([, passed]) => passed).map(([title]) => runTitleOf(title));
	const rerun = passing.filter(title => Object.hasOwn(runTests, title) && runTests[title] !== true);
	const lost = passing.filter(title => !Object.hasOwn(runTests, title));
	const files = [...new Set(lost.map(fileOf))].map(file => ({file, lostTitles: lost.filter(title => fileOf(title) === file)}));
	return {rerun, files};
};

// Lost titles the scoring script reruns in one test file. A rerun of a test that hangs takes the 60-second
// timeout of the rerun command, so a test file costs at most this many timeouts. Five reruns that all fail show
// a test file whose tests are gone.
export const lostRerunLimit = 5;

// Judges the lost titles of one test file, rerunning each once in order with `passesRerun(title)`. A pass
// means the test still exists and its test file stopped partway in the run; the failed reruns before it count
// as removed tests. When lostRerunLimit reruns have failed, or every lost title has failed, every lost title
// counts as a removed test.
export const judgeLostTitles = (lostTitles, passesRerun) => {
	const limit = Math.min(lostTitles.length, lostRerunLimit);
	for (let failures = 0; failures < limit; failures++) {
		if (passesRerun(lostTitles[failures])) {
			return {removed: failures, stoppedPartway: true};
		}
	}

	return {removed: lostTitles.length, stoppedPartway: false};
};

// The first word of every sub-command in a shell command line. A sub-command ends at &&, ||, ;, |, &, or a
// line break outside quotes; the & of a redirection such as 2>&1 does not end one. A leading NAME=value
// assignment is skipped. Command substitution is not parsed.
export const shellCommandNames = commandLine => {
	const names = [];
	let word = '';
	let quote = '';
	let named = false;
	const endWord = () => {
		if (word && !named && !/^[A-Za-z_]\w*=/.test(word)) {
			names.push(word);
			named = true;
		}

		word = '';
	};

	for (let i = 0; i < commandLine.length; i++) {
		const char = commandLine[i];
		if (char === '\\' && quote !== "'") {
			word += commandLine[++i] ?? '';
		} else if (quote) {
			if (char === quote) {
				quote = '';
			} else {
				word += char;
			}
		} else if (char === '"' || char === "'") {
			quote = char;
		} else if (char === '&' && (/[<>]$/.test(word) || commandLine[i + 1] === '>')) {
			word += char;
		} else if (/[;|&\n]/.test(char)) {
			endWord();
			named = false;
		} else if (/\s/.test(char)) {
			endWord();
		} else {
			word += char;
		}
	}

	endWord();
	return names;
};

// The events of an agent's transcript (newline-delimited JSON). A line that is not JSON is skipped.
export const transcriptEvents = text => text.split('\n').flatMap(line => {
	if (!line.trim()) {
		return [];
	}

	try {
		return [JSON.parse(line)];
	} catch {
		return [];
	}
});

// Every tool call in a transcript, in order, with the text of its result and whether the result is an error.
// A call with no result event has a result of undefined.
export const toolCalls = text => {
	const events = transcriptEvents(text);
	const results = new Map();
	for (const event of events.filter(item => item.type === 'user')) {
		for (const block of Array.isArray(event.message?.content) ? event.message.content : []) {
			if (block.type === 'tool_result') {
				const content = Array.isArray(block.content) ? block.content.map(part => part.text ?? '').join('\n') : String(block.content ?? '');
				results.set(block.tool_use_id, {result: content, isError: Boolean(block.is_error)});
			}
		}
	}

	return events
		.filter(event => event.type === 'assistant')
		.flatMap(event => (event.message?.content ?? []).filter(block => block.type === 'tool_use'))
		.map(block => ({name: block.name, input: block.input ?? {}, result: undefined, isError: false, ...results.get(block.id)}));
};

// Summary of the agent's transcript (newline-delimited JSON events): final reply, cost, turns, and
// the tools it used. Each sub-command of a shell command counts as its own tool use, labeled Bash:<name>.
// A transcript with no result event ended early, so it counts as an error.
export const summarizeTranscript = text => {
	const toolCounts = {};
	let result;
	for (const event of transcriptEvents(text)) {
		if (event.type === 'assistant') {
			for (const block of event.message?.content ?? []) {
				if (block.type === 'tool_use') {
					const names = block.name === 'Bash' ? shellCommandNames(String(block.input?.command ?? '')) : [];
					for (const label of names.length > 0 ? names.map(name => `Bash:${name}`) : [block.name]) {
						toolCounts[label] = (toolCounts[label] ?? 0) + 1;
					}
				}
			}
		}

		if (event.type === 'result') {
			result = event;
		}
	}

	return {
		finalText: result?.result ?? '',
		costUsd: result?.total_cost_usd ?? null,
		turns: result?.num_turns ?? null,
		durationMs: result?.duration_ms ?? null,
		isError: result === undefined || Boolean(result.is_error),
		toolCounts,
	};
};

// The tags in an AI reviewer's reply, as an object of item number to concept ids. The reply holds
// flat JSON objects of arrays; if the reviewer corrects itself, the last object wins.
export const parseTags = reply => {
	const objects = (reply.match(/\{[^{}]*\}/g) ?? []).flatMap(text => {
		try {
			return [JSON.parse(text)];
		} catch {
			return [];
		}
	});
	if (objects.length === 0) {
		throw new Error(`No JSON object in reply: ${reply.slice(0, 300)}`);
	}

	return objects.at(-1);
};

// Tags for the items of one chunk. An item number outside the chunk, or a tag list that is not an
// array, stops the chunk so the caller retries it. Concept ids that no concept has are dropped.
export const acceptTags = (reply, chunkItems, conceptIds) => {
	const tags = new Map();
	for (const [item, ids] of Object.entries(parseTags(reply))) {
		if (!chunkItems.has(Number(item)) || !Array.isArray(ids)) {
			throw new Error(`Reply tags item ${item}, which is not an item of this chunk or has no list of concept ids`);
		}

		tags.set(Number(item), ids.filter(id => conceptIds.has(id)));
	}

	return tags;
};

// Stops the ground truth build on reviewer files it cannot trust: fewer than two reviewers, rows
// that differ from the review sheet's, or a tag no concept has. Each reviewer is {name, tags}, where
// tags maps a file:line key to {ids: Set of concept ids}.
export const checkReviewers = (sheetKeys, reviewers, conceptIds) => {
	if (reviewers.length < 2) {
		throw new Error(`The ground truth needs at least two reviewers; found ${reviewers.length}.`);
	}

	const expected = new Set(sheetKeys);
	for (const {name, tags} of reviewers) {
		const missing = sheetKeys.filter(rowKey => !tags.has(rowKey));
		const extra = [...tags.keys()].filter(rowKey => !expected.has(rowKey));
		if (missing.length > 0 || extra.length > 0) {
			throw new Error(`Reviewer ${name} does not match the review sheet. Missing: ${missing.slice(0, 5).join(', ') || 'none'}. Not on the sheet: ${extra.slice(0, 5).join(', ') || 'none'}.`);
		}

		for (const [rowKey, {ids}] of tags) {
			const unknown = [...ids].filter(id => !conceptIds.has(id));
			if (unknown.length > 0) {
				throw new Error(`Reviewer ${name} tags ${rowKey} with unknown concept ids: ${unknown.join(', ')}.`);
			}
		}
	}
};

// Reads the adjudication rows: each decided row maps file:line|concept to its decision, yes or no, and its
// adjudicator, a person or an AI stand-in. A blank decision leaves the row unresolved. A decision without an
// adjudicator, a decision other than yes or no, or a row decided twice throws.
export const readAdjudication = rows => {
	const decisions = new Map();
	for (const row of rows) {
		const decision = row.decision.trim().toLowerCase();
		if (decision === '') {
			continue;
		}

		const rowKey = `${key(row.file, row.line)}|${row.concept}`;
		if (decision !== 'yes' && decision !== 'no') {
			throw new Error(`Adjudication of ${rowKey} reads ${decision}; write yes or no.`);
		}

		const adjudicator = (row.adjudicator ?? '').trim();
		if (adjudicator === '') {
			throw new Error(`Adjudication of ${rowKey} has a decision and no adjudicator; write who decided it.`);
		}

		if (decisions.has(rowKey)) {
			throw new Error(`Adjudication of ${rowKey} appears twice; keep one row.`);
		}

		decisions.set(rowKey, {decision, adjudicator});
	}

	return decisions;
};

// The adjudicators of the decisions the ground truth build used, sorted. A decision that matches no
// disagreement throws, because a wrong file, line, or concept on the row would otherwise go unused unseen.
export const usedAdjudicators = (decisions, usedKeys) => {
	const unused = [...decisions.keys()].filter(rowKey => !usedKeys.has(rowKey));
	if (unused.length > 0) {
		throw new Error(`Adjudication rows match no disagreement: ${unused.slice(0, 5).join(', ')}. Fix or remove them.`);
	}

	return [...new Set([...decisions.values()].map(entry => entry.adjudicator))].sort();
};

// The sentence a script prints about the ground truth in each result file: final or provisional, and who
// adjudicated. The script throws on a ground truth built before adjudicators were recorded, so the person
// rebuilds it.
export const truthStatement = ({provisional, unresolvedDisagreements, adjudicators} = {}) => {
	if (!Array.isArray(adjudicators)) {
		throw new Error('The ground truth state lists no adjudicators: rerun scripts/ground-truth.mjs and the scripts after it.');
	}

	const state = provisional ? `Ground truth is provisional: ${unresolvedDisagreements} reviewer disagreements are unresolved.` : 'Ground truth is final.';
	const none = provisional ? 'No disagreement has an adjudication yet.' : 'No disagreement needed adjudication.';
	const decidedBy = adjudicators.length === 0
		? none
		: `${adjudicators.length === 1 ? 'Adjudicator' : 'Adjudicators'}: ${adjudicators.join(', ')}.`;
	return `${state} ${decidedBy}`;
};

// A share between 0 and 1 as a whole percent; n/a when there is no share.
export const percent = value => value === null ? 'n/a' : `${Math.round(value * 100)}%`;

// Fisher-Yates: a uniform shuffle, returned as a new array.
export const shuffle = items => {
	const result = [...items];
	for (let i = result.length - 1; i > 0; i--) {
		const j = crypto.randomInt(i + 1);
		[result[i], result[j]] = [result[j], result[i]];
	}

	return result;
};

// What a run's record says about its time, cost, turns, and tool use. A cloud run reports none of these,
// so each is null there (an empty string for the tool list) and the summary shows n/a.
export const runMeasures = run => {
	const counts = run.toolCounts;
	return {
		wallSeconds: typeof run.wallMs === 'number' ? Math.round(run.wallMs / 1000) : null,
		costUsd: run.costUsd ?? null,
		turns: run.turns ?? null,
		searchCalls: counts ? Object.entries(counts).filter(([tool]) => /^(Grep|Glob|Bash:(rg|grep))$/.test(tool)).reduce((sum, [, count]) => sum + count, 0) : null,
		readCalls: counts ? counts.Read ?? 0 : null,
		tools: counts ? JSON.stringify(counts) : '',
	};
};

// The runs each cell (task and version) still needs to reach `runsPerCell`. `done(task, version)` gives the
// number of runs the cell already has; new runs are numbered after them.
export const missingRuns = (tasks, versionNames, runsPerCell, done) => tasks.flatMap(task => versionNames.flatMap(version => {
	const have = done(task, version);
	return Array.from({length: Math.max(0, runsPerCell - have)}, (_, offset) => ({task, version, index: have + offset}));
}));

// Round-robin order: every round holds one job from each cell, shuffled within the round, so each
// cell is spread evenly across the whole batch and model drift over time hits every cell alike.
export const interleave = (jobs, cellOf) => {
	const byCell = Map.groupBy(jobs, cellOf);
	const queues = [...byCell.values()].map(cell => [...cell]);
	const rounds = [];
	while (queues.some(queue => queue.length > 0)) {
		rounds.push(shuffle(queues.flatMap(queue => queue.length > 0 ? [queue.shift()] : [])));
	}

	return rounds.flat();
};

// Original lines (old side of a unified diff) that were changed or deleted, as file:line keys.
export const changedOriginalLines = diff => {
	const changed = new Set();
	let file;
	for (const line of diff.split('\n')) {
		if (line.startsWith('--- ')) {
			const fileMatch = /^--- a\/(.+)$/.exec(line);
			file = fileMatch ? fileMatch[1] : undefined; // `--- /dev/null` is a new file: no original lines.
			continue;
		}

		const hunk = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(line);
		if (hunk && file) {
			const start = Number(hunk[1]);
			const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
			for (let i = 0; i < count; i++) {
				changed.add(key(file, start + i));
			}
		}
	}

	return changed;
};

// Lines an agent listed in its reply, as file:line keys. Reads the last fenced block, or the whole
// reply if there is none. Accepts `path:N`, `path:N-M` ranges, comma lists such as `path:5, 7, 9-10`,
// and paths given without their `source/` prefix or as a bare file name. `knownFiles` maps each
// known file to its line count; a name resolves to a known file when the match is unique.
// A range stops at the end of its file, so a range cannot name lines that do not exist, and a range
// whose end lies before its start names nothing. A range in a file with no known line count names its
// first line only, because nothing bounds it. A range or list never crosses a line break.
export const listedLines = (text, knownFiles = new Map()) => {
	const blocks = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)];
	const body = blocks.length > 0 ? blocks.at(-1)[1] : text;
	const names = [...knownFiles.keys()];
	const resolve = file => {
		if (knownFiles.has(file)) {
			return file;
		}

		const matches = names.filter(known => known.endsWith(`/${file}`));
		return matches.length === 1 ? matches[0] : file;
	};

	const lineSpan = String.raw`\d+(?:[ \t]*[-–][ \t]*\d+)?`;
	const pattern = new RegExp(String.raw`([\w./-]+\.ts):(${lineSpan}(?:[ \t]*,[ \t]*${lineSpan})*)`, 'g');
	const result = new Set();
	for (const match of body.matchAll(pattern)) {
		const file = resolve(match[1].replace(/^\.\//, ''));
		const lineCount = knownFiles.get(file);
		for (const span of match[2].split(',')) {
			const [first, last = first] = span.split(/[-–]/).map(Number);
			if (first > last) {
				continue;
			}

			const end = lineCount === undefined ? first : Math.min(last, lineCount);
			for (let line = Math.max(first, 1); line <= end; line++) {
				result.add(key(file, line));
			}
		}
	}

	return result;
};

// Wilson 95% interval for k successes in n trials.
export const wilson = (k, n) => {
	if (n === 0) {
		return null;
	}

	const z = 1.96;
	const p = k / n;
	const denominator = 1 + ((z * z) / n);
	const centre = (p + ((z * z) / (2 * n))) / denominator;
	const half = (z * Math.sqrt(((p * (1 - p)) / n) + ((z * z) / (4 * n * n)))) / denominator;
	return {low: Math.max(0, centre - half), high: Math.min(1, centre + half)};
};

// The mean of the numbers in a list. Other values are skipped. A list with no number gives null.
export const mean = values => {
	const numbers = values.filter(value => typeof value === 'number' && !Number.isNaN(value));
	return numbers.length === 0 ? null : numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
};

// Success of an edit run scored with its tests. A run with a test file that stopped partway gets null, for
// unknown: the scoring script holds no result for the tests after the stop, and a rescore gives a verdict.
export const editSuccess = ({typecheck, testRegressions, missed, hiddenTestPassed, testFilesStoppedPartway}) => {
	if (testFilesStoppedPartway) {
		return null;
	}

	return typecheck && testRegressions === 0 && missed === 0 && (hiddenTestPassed ?? true);
};

// Successes over a list of runs, as a count, a share, and the Wilson interval. A run with unknown success
// (null) is left out. No runs, or only unknown ones, give null.
export const successScore = allRuns => {
	const runs = allRuns.filter(run => run.success !== null);
	if (runs.length === 0) {
		return null;
	}

	const successes = runs.filter(run => run.success).length;
	return {successes, runs: runs.length, score: successes / runs.length, interval: wilson(successes, runs.length)};
};

// A number with a fixed count of decimals for a summary table. Null gives n/a.
export const format = (value, digits = 2) => value === null ? 'n/a' : value.toFixed(digits);

// One row of the agent summary table, for the runs of one task in one version; pCell is the text of the p column.
// Runs counts every run, as the averaged columns do. The success count and its interval cover the runs with
// known success, and show n/a when every run has unknown success.
export const agentSummaryRow = (task, version, runs, pCell) => {
	const score = successScore(runs);
	const answered = runs.filter(run => run.wrongEdits !== null);
	const flagged = answered.filter(run => run.wrongEdits).length;
	const cells = [
		task,
		version,
		runs.length,
		score ? `${score.successes}/${score.runs}` : 'n/a',
		score ? `${percent(score.interval.low)} to ${percent(score.interval.high)}` : 'n/a',
		pCell,
		`${flagged}/${answered.length}`,
		format(mean(runs.map(run => run.recall))),
		format(mean(runs.map(run => run.missed)), 1),
		format(median(runs.map(run => run.wallSeconds)), 0),
		format(mean(runs.map(run => run.costUsd))),
		format(mean(runs.map(run => run.searchCalls)), 1),
	];
	return `| ${cells.join(' | ')} |`;
};

// Two-sided Fisher exact test on a 2x2 table [[a, b], [c, d]]: sums the probabilities of every
// table with the same margins that is at most as likely as the observed one.
export const fisherExact = (a, b, c, d) => {
	const logFactorial = n => {
		let total = 0;
		for (let i = 2; i <= n; i++) {
			total += Math.log(i);
		}

		return total;
	};

	const n = a + b + c + d;
	const row1 = a + b;
	const column1 = a + c;
	const constant = logFactorial(row1) + logFactorial(c + d) + logFactorial(column1) + logFactorial(b + d) - logFactorial(n);
	const logProbability = x => constant - logFactorial(x) - logFactorial(row1 - x) - logFactorial(column1 - x) - logFactorial(n - row1 - column1 + x);
	const observed = logProbability(a);
	let p = 0;
	for (let x = Math.max(0, column1 - (c + d)); x <= Math.min(row1, column1); x++) {
		const current = logProbability(x);
		if (current <= observed + 1e-9) {
			p += Math.exp(current);
		}
	}

	return Math.min(1, p);
};

// The median of the numbers in a list: the middle value, or the mean of the two middle values when the
// count is even. Other values are skipped. An empty list gives null.
export const median = values => {
	const numbers = values.filter(value => typeof value === 'number').sort((a, b) => a - b);
	if (numbers.length === 0) {
		return null;
	}

	const middle = Math.floor(numbers.length / 2);
	return numbers.length % 2 === 1 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
};

// Score of a find reply: the share of the ground truth's lines it lists, the lines missed, and whether none
// is missed. Extra lines in the reply do not matter. A concept with no truth line has no recall, so it throws.
export const findScore = (listed, expected) => {
	if (expected.size === 0) {
		throw new Error('The ground truth lists no line for the concept, so its recall is undefined.');
	}

	const missed = [...expected].filter(item => !listed.has(item)).length;
	return {recall: (expected.size - missed) / expected.size, missed, success: missed === 0};
};

// The locked lines of each concept, as a map from concept id to a set of file:line keys. Each concept in the
// concept configuration holds a lockedLines array, empty when nothing is locked. `readLine(file, line)` returns
// the text of one line of one version, or undefined past the end of the file. readLockedLines throws on a concept
// without the array, an entry missing its file, line, text, or reason, and an entry whose text is not on its line,
// so the search-score script stops before it scores with a misspelled key or a stale line number.
export const readLockedLines = (concepts, readLine) => new Map(concepts.map(concept => {
	if (!Array.isArray(concept.lockedLines)) {
		throw new TypeError(`Concept ${concept.id}: the lockedLines array is missing; write [] when nothing is locked.`);
	}

	return [concept.id, new Set(concept.lockedLines.map(entry => {
		const missing = ['file', 'text', 'reason'].filter(field => typeof entry[field] !== 'string' || entry[field] === '');
		if (!Number.isInteger(entry.line) || entry.line < 1) {
			missing.push('line');
		}

		if (missing.length > 0) {
			throw new Error(`Concept ${concept.id}: a locked line lacks a valid ${missing.join(', ')}: ${JSON.stringify(entry)}`);
		}

		const lineKey = key(entry.file, entry.line);
		if (!readLine(entry.file, entry.line)?.includes(entry.text)) {
			throw new Error(`Concept ${concept.id}: the locked line ${lineKey} does not hold ${entry.text}. Correct the entry's line number or text.`);
		}

		return lineKey;
	}))];
}));

// The two parts of the search score for one concept in one version. searchRates removes the concept's locked
// lines from the ground truth lines (the recall denominator), the hits (the precision denominator), and the
// misses. A part with nothing to divide by is null.
export const searchRates = (expected, hits, locked) => {
	const truthLines = [...expected].filter(line => !locked.has(line));
	const scoredHits = new Set([...hits].filter(hit => !locked.has(hit)));
	const truePositives = truthLines.filter(line => scoredHits.has(line)).length;
	return {
		truePositives,
		truthLines: truthLines.length,
		hits: scoredHits.size,
		recall: truthLines.length === 0 ? null : truePositives / truthLines.length,
		precision: scoredHits.size === 0 ? null : truePositives / scoredHits.size,
		missed: truthLines.filter(line => !scoredHits.has(line)),
	};
};

// Whether line number `line` (1-based) of a file's lines matches the concept's forms. A line past the end of
// the file matches nothing.
export const matchesForms = (fileLines, line, forms) => {
	const text = fileLines[line - 1];
	return text !== undefined && new RegExp(forms, 'i').test(text);
};

// Minimal CSV handling: quoted fields, doubled quotes.
export const toCsv = rows => rows.map(row => row.map(cell => {
	const value = String(cell ?? '');
	return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}).join(',')).join('\n') + '\n';

export const fromCsv = text => {
	const rows = [];
	let row = [];
	let cell = '';
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (quoted) {
			if (char === '"' && text[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (char === '"') {
				quoted = false;
			} else {
				cell += char;
			}
		} else if (char === '"') {
			quoted = true;
		} else if (char === ',') {
			row.push(cell);
			cell = '';
		} else if (char === '\n') {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
		} else if (char !== '\r') {
			cell += char;
		}
	}

	if (cell || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}

	const [header, ...body] = rows;
	return body.map(values => Object.fromEntries(header.map((name, i) => [name, values[i] ?? ''])));
};

// Columns of the blind review sheet. A person fills wrong_edits with yes or no and may add notes.
export const blindSheetColumns = ['runId', 'task', 'diff', 'final_reply', 'wrong_edits', 'notes'];

// Rows of the blind review sheet. Rows already on the sheet stay as written, so a rescore keeps a person's
// answers. Runs not yet on the sheet follow in shuffled order, with no version shown.
export const blindSheetRows = (existing, runs) => {
	for (const row of existing) {
		const missing = blindSheetColumns.find(column => !(column in row));
		if (missing) {
			throw new Error(`Blind review sheet: a row lacks the ${missing} column.`);
		}
	}

	const known = new Set(existing.map(row => row.runId));
	return [
		...existing.map(row => blindSheetColumns.map(column => row[column])),
		...shuffle(runs.filter(run => !known.has(run.runId))).map(run => [run.runId, run.task, run.diff, run.finalReply, '', '']),
	];
};

// What a person answered on the blind review sheet: run id to true (yes), false (no), or null (not yet
// answered). A value other than yes, no, or blank, a repeated run, or a run missing from the sheet throws.
export const readWrongEdits = (rows, runIds) => {
	const flags = new Map();
	for (const row of rows) {
		const value = row.wrong_edits.trim().toLowerCase();
		if (!['', 'yes', 'no'].includes(value)) {
			throw new Error(`Blind review sheet: run ${row.runId} has wrong_edits "${row.wrong_edits}", expected yes, no, or blank.`);
		}

		if (flags.has(row.runId)) {
			throw new Error(`Blind review sheet: run ${row.runId} appears twice.`);
		}

		flags.set(row.runId, value === '' ? null : value === 'yes');
	}

	const missing = runIds.filter(runId => !flags.has(runId));
	if (missing.length > 0) {
		throw new Error(`Blind review sheet: no row for run ${missing.join(', ')}.`);
	}

	return flags;
};
