// Agent score: runs the agent on each task in each version, in fresh, identical-looking run copies.
// Same tools and no user settings in every run. Each run gets a random id; the id-to-version key is kept in work/runs/key.json so scoring can be blind.
// Each run starts in a run slot (see agent-runner.mjs), then its run copy moves to work/runs/<id>/ so scoring can run its tests later.
// Usage: node run-agents.mjs [--runs 10] [--tasks find-all,rename,retry-count-start] [--versions published,proposed] [--parallel 2] [--model sonnet]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {copyIntoSlot, copyName, loadAgent, runAgent} from './agent-runner.mjs';
import {diffSinceSnapshot, integerOption, interleave, loadTasks, missingRuns, option, readJson, summarizeTranscript, versions, workDir, writeJson} from './lib.mjs';

const argv = process.argv.slice(2);
const config = loadTasks();
const agent = loadAgent();
const runsPerCell = integerOption(argv, 'runs', 10, 1);
const taskIds = option(argv, 'tasks', config.tasks.map(task => task.id).join(',')).split(',');
const selectedVersions = option(argv, 'versions', versions.join(',')).split(',');
const parallel = integerOption(argv, 'parallel', 2, 1);
const model = option(argv, 'model', agent.model);
const runsDir = path.join(workDir, 'runs');
const keyFile = path.join(runsDir, 'key.json');
fs.mkdirSync(runsDir, {recursive: true});
const key = fs.existsSync(keyFile) ? readJson(keyFile) : {};

const selectedTasks = taskIds.map(taskId => {
	const task = config.tasks.find(item => item.id === taskId);
	if (!task) {
		throw new Error(`Unknown task ${taskId}`);
	}

	return task;
});
const jobs = missingRuns(selectedTasks, selectedVersions, runsPerCell, (task, version) => Object.values(key).filter(entry => entry.task === task.id && entry.version === version).length);

// Round-robin over cells (task x version), shuffled within each round, so drift in the model service
// over time hits every cell alike.
const queue = interleave(jobs, job => `${job.task.id}|${job.version}`);
console.log(`${queue.length} runs to do (${runsPerCell} per task per version, existing runs kept).`);

// Each worker runs in its own slot, one run at a time.
const worker = async slot => {
	while (queue.length > 0) {
		const {task, version, index} = queue.shift();
		const runId = crypto.randomBytes(4).toString('hex');
		const runDir = path.join(runsDir, runId);
		const tmpDir = path.join(runDir, 'tmp');
		fs.mkdirSync(tmpDir, {recursive: true});
		const {directory: slotCopy, snapshot} = copyIntoSlot(slot, version);
		const transcript = path.join(runDir, 'transcript.jsonl');
		// eslint-disable-next-line no-await-in-loop
		const outcome = await runAgent({prompt: task.prompt, directory: slotCopy, logFile: transcript, tmpDir, model, agent});
		const summary = summarizeTranscript(fs.readFileSync(transcript, 'utf8'));
		// An agent that deleted the run copy's .git leaves no diff to take. The run is recorded as an error with an empty diff.
		let diff = '';
		let diffError;
		try {
			diff = diffSinceSnapshot(slotCopy, snapshot);
		} catch (error) {
			diffError = `diff failed: ${error.message.split('\n')[0]}`;
		}

		const directory = path.join(runDir, copyName());
		fs.renameSync(slotCopy, directory);
		fs.rmSync(tmpDir, {recursive: true, force: true});
		fs.writeFileSync(path.join(runDir, 'diff.patch'), diff);
		fs.writeFileSync(path.join(runDir, 'final.md'), summary.finalText);
		const runError = [outcome.runError, diffError].filter(Boolean).join('; ') || undefined;
		writeJson(path.join(runDir, 'run.json'), {runId, task: task.id, directory, snapshot, model, ...outcome, ...summary, runError, finalText: undefined});
		key[runId] = {version, task: task.id, index};
		writeJson(keyFile, key);
		console.log(`${runId}: ${task.id} done in ${Math.round(outcome.wallMs / 1000)}s, $${summary.costUsd?.toFixed(2) ?? '?'}${outcome.exitCode === 0 ? '' : `, exit ${outcome.exitCode}`}${runError ? `, ${runError}` : ''}`);
	}
};

await Promise.all(Array.from({length: parallel}, (_, index) => worker(index + 1)));
console.log('Done. Next: node scripts/score-agents.mjs');
