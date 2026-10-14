// Agent score: runs an AI coding agent on each task in each version, in fresh, identical-looking copies.
// Same tools and no user settings in every run. Each run gets a random id; the id-to-version key is kept in work/runs/key.json so scoring can be blind.
// The run copy stays under work/runs/<id>/ so scoring can run its tests later.
// Usage: node run-agents.mjs [--runs 10] [--tasks find-all,rename,retry-count-start] [--versions published,proposed] [--parallel 2] [--model sonnet]
import {execFileSync, spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {copyCodebase, interleave, loadCodebase, loadTasks, maxOutputBytes, option, readJson, versionDir, versions, workDir, writeJson} from './lib.mjs';

const argv = process.argv.slice(2);
const config = loadTasks();
const runsPerCell = Number(option(argv, 'runs', 10));
const taskIds = option(argv, 'tasks', config.tasks.map(task => task.id).join(',')).split(',');
const selectedVersions = option(argv, 'versions', versions.join(',')).split(',');
const parallel = Number(option(argv, 'parallel', 2));
const model = option(argv, 'model', config.agent.model);
const runsDir = path.join(workDir, 'runs');
const keyFile = path.join(runsDir, 'key.json');
fs.mkdirSync(runsDir, {recursive: true});
const key = fs.existsSync(keyFile) ? readJson(keyFile) : {};

// Every copy looks the same from inside: same folder name (the repository's own), one fresh commit, shared dependencies.
// Returns the copy's path and the snapshot commit, which the diff after the run is taken against.
const copyName = path.basename(loadCodebase().repository, '.git');
const makeCopy = (version, runId) => {
	const directory = path.join(runsDir, runId, copyName);
	copyCodebase(versionDir(version), directory);
	const git = (...args) => execFileSync('git', args, {cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});
	git('init', '-q');
	git('add', '-A');
	git('-c', 'user.name=snapshot', '-c', 'user.email=snapshot@example.invalid', 'commit', '-q', '-m', 'Snapshot');
	return {directory, snapshot: git('rev-parse', 'HEAD').trim()};
};

// Everything the agent changed since the snapshot, whether it left the change unstaged, staged it,
// committed it, or wrote a new file. Staging first brings new files into the diff.
const diffSinceSnapshot = (directory, snapshot) => {
	execFileSync('git', ['add', '-A'], {cwd: directory, stdio: 'ignore'});
	return execFileSync('git', ['diff', '--cached', '--unified=0', '--no-color', snapshot], {cwd: directory, encoding: 'utf8', maxBuffer: maxOutputBytes});
};

const runAgent = (task, directory, logFile) => new Promise(resolve => {
	const args = [
		'-p', task.prompt,
		'--model', model,
		'--output-format', 'stream-json', '--verbose',
		'--permission-mode', 'acceptEdits',
		'--tools', config.agent.tools,
		'--allowedTools', ...config.agent.allowedTools,
		'--setting-sources', 'project',
		'--strict-mcp-config',
		'--no-session-persistence',
		'--max-budget-usd', String(config.agent.maxBudgetUsd),
	];
	const started = Date.now();
	const log = fs.createWriteStream(logFile);
	const child = spawn(config.agent.command, args, {cwd: directory, stdio: ['ignore', 'pipe', 'pipe']});
	child.stdout.pipe(log);
	let stderr = '';
	child.stderr.on('data', data => {
		stderr += data;
	});
	child.on('close', code => {
		log.end();
		resolve({exitCode: code, wallMs: Date.now() - started, stderr: stderr.slice(0, 2000)});
	});
});

// Summarizes the agent's transcript: final reply, cost, turns, and which tools it used.
const summarizeTranscript = logFile => {
	const toolCounts = {};
	let result = {};
	for (const line of fs.readFileSync(logFile, 'utf8').split('\n')) {
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
		finalText: result.result ?? '',
		costUsd: result.total_cost_usd ?? null,
		turns: result.num_turns ?? null,
		durationMs: result.duration_ms ?? null,
		isError: Boolean(result.is_error),
		toolCounts,
	};
};

const jobs = [];
for (const taskId of taskIds) {
	const task = config.tasks.find(item => item.id === taskId);
	if (!task) {
		throw new Error(`Unknown task ${taskId}`);
	}

	for (const version of selectedVersions) {
		const done = Object.values(key).filter(entry => entry.task === taskId && entry.version === version).length;
		for (let index = done; index < runsPerCell; index++) {
			jobs.push({task, version, index});
		}
	}
}

// Round-robin over cells (task x version), shuffled within each round, so drift in the model service
// over time hits every cell alike.
const queue = interleave(jobs, job => `${job.task.id}|${job.version}`);
console.log(`${queue.length} runs to do (${runsPerCell} per task per version, existing runs kept).`);

const worker = async () => {
	while (queue.length > 0) {
		const {task, version, index} = queue.shift();
		const runId = crypto.randomBytes(4).toString('hex');
		const runDir = path.join(runsDir, runId);
		fs.mkdirSync(runDir, {recursive: true});
		const {directory, snapshot} = makeCopy(version, runId);
		// eslint-disable-next-line no-await-in-loop
		const outcome = await runAgent(task, directory, path.join(runDir, 'transcript.jsonl'));
		const summary = summarizeTranscript(path.join(runDir, 'transcript.jsonl'));
		fs.writeFileSync(path.join(runDir, 'diff.patch'), diffSinceSnapshot(directory, snapshot));
		fs.writeFileSync(path.join(runDir, 'final.md'), summary.finalText);
		writeJson(path.join(runDir, 'run.json'), {runId, task: task.id, directory, snapshot, model, ...outcome, ...summary, finalText: undefined});
		key[runId] = {version, task: task.id, index};
		writeJson(keyFile, key);
		console.log(`${runId}: ${task.id} done in ${Math.round(outcome.wallMs / 1000)}s, $${summary.costUsd?.toFixed(2) ?? '?'}${outcome.exitCode === 0 ? '' : `, exit ${outcome.exitCode}`}`);
	}
};

await Promise.all(Array.from({length: parallel}, worker));
console.log('Done. Next: node scripts/score-agents.mjs');
