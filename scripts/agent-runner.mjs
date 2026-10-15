// Starts agent runs: a fresh run copy in a fixed run slot, then claude in that copy, contained as
// containment.mjs describes. run-agents.mjs and check-fence.mjs both start agents through here.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {agentArgs, agentEnv} from './containment.mjs';
import {loadCodebase, loadTasks, makeRunCopy, versionDir, workDir} from './lib.mjs';

// The agent configuration from config/tasks.json. The time cap per run bounds a hung process, which the
// budget cap does not: at the cap runAgent kills the agent and records the run as an error.
export const loadAgent = () => {
	const {agent} = loadTasks();
	if (!Number.isInteger(agent.timeoutMinutes) || agent.timeoutMinutes < 1) {
		throw new Error('config/tasks.json: agent.timeoutMinutes must be a whole number of at least 1');
	}

	return agent;
};

// The run slots: fixed folders that agents run in, one per parallel worker. Claude Code records every
// working directory it starts in under the Claude folder in the home directory, so fixed folders keep
// that record to one entry per slot. After a run, the run copy moves to the run's own folder under work/runs.
export const slotDir = slot => path.join(workDir, 'run-slots', String(slot));

// Every run copy has the same folder name, the codebase repository's own, so all copies look alike from inside.
export const copyName = () => path.basename(loadCodebase().repository, '.git');

// A fresh run copy of a version in a slot, with its snapshot commit. A slot that still holds a copy
// is from a run that stopped before its copy moved out, so the script stops instead of overwriting it.
export const copyIntoSlot = (slot, version) => {
	const directory = path.join(slotDir(slot), copyName());
	if (fs.existsSync(directory)) {
		throw new Error(`Run slot ${directory} still holds a run copy from a run that did not finish. Remove it, then start again.`);
	}

	return makeRunCopy(versionDir(version), directory);
};

// Runs claude on one prompt in a run copy and writes its transcript to logFile. tmpDir must exist; it
// holds the run's temporary files and npm cache. Resolves with the exit code, wall time, the start of
// stderr, and a run error when the agent did not start or hit the time cap.
export const runAgent = ({prompt, directory, logFile, tmpDir, model, agent}) => new Promise(resolve => {
	const started = Date.now();
	const log = fs.createWriteStream(logFile);
	const child = spawn(agent.command, agentArgs({prompt, model, agent, tmpDir}), {cwd: directory, env: agentEnv(process.env, tmpDir), stdio: ['ignore', 'pipe', 'pipe']});
	child.stdout.pipe(log, {end: false});
	let stderr = '';
	let runError;
	child.stderr.on('data', data => {
		stderr += data;
	});
	log.on('error', error => {
		runError = `transcript write failed: ${error.message}`;
	});
	const timer = setTimeout(() => {
		runError = `killed after ${agent.timeoutMinutes} minutes`;
		child.kill('SIGKILL');
	}, agent.timeoutMinutes * 60_000);
	// The result goes out once the transcript file has closed, so a reader of the transcript sees the last event.
	let finished = false;
	const finish = exitCode => {
		if (finished) {
			return;
		}

		finished = true;
		clearTimeout(timer);
		log.end(() => resolve({exitCode, wallMs: Date.now() - started, stderr: stderr.slice(0, 2000), runError}));
	};

	child.on('error', error => {
		runError = `agent did not start: ${error.message}`;
		finish(null);
	});
	child.on('close', code => finish(code));
});
