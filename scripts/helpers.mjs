// Pure helpers with no TypeScript dependency: keys, shuffling, diff and reply parsing, statistics, CSV.
import crypto from 'node:crypto';

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

// Summary of the agent's transcript (newline-delimited JSON events): final reply, cost, turns, and
// the tools it used. A transcript with no result event ended early, so it counts as an error.
export const summarizeTranscript = text => {
	const toolCounts = {};
	let result;
	for (const line of text.split('\n')) {
		if (!line.trim()) {
			continue;
		}

		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}

		if (event.type === 'assistant') {
			for (const block of event.message?.content ?? []) {
				if (block.type === 'tool_use') {
					const command = block.name === 'Bash' ? String(block.input?.command ?? '').trim().split(/\s+/)[0] : '';
					const label = command ? `Bash:${command}` : block.name;
					toolCounts[label] = (toolCounts[label] ?? 0) + 1;
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
// reply if there is none. Accepts `path:N`, `path:N-M` ranges, and paths given without their
// `source/` prefix or as a bare file name, resolved against `knownFiles` when the match is unique.
export const listedLines = (text, knownFiles = []) => {
	const blocks = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)];
	const body = blocks.length > 0 ? blocks.at(-1)[1] : text;
	const resolve = file => {
		if (knownFiles.includes(file)) {
			return file;
		}

		const matches = knownFiles.filter(known => known.endsWith(`/${file}`));
		return matches.length === 1 ? matches[0] : file;
	};

	const result = new Set();
	for (const match of body.matchAll(/([\w./-]+\.ts):(\d+)(?:\s*[-–]\s*(\d+))?/g)) {
		const file = resolve(match[1].replace(/^\.\//, ''));
		const first = Number(match[2]);
		const last = match[3] === undefined ? first : Number(match[3]);
		for (let line = first; line <= last; line++) {
			result.add(key(file, line));
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
