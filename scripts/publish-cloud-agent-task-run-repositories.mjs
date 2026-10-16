// Cloud agent task runs, step 1: builds the cloud agent task run repository of each codebase version (the codebase
// version's files and the start files, one commit) in work/cloud/, and with --push replaces the contents of the
// private repository named in the routine file with it. Without --push the script builds and prints what it would
// push, and sends nothing. A push replaces the repository's history, so point it only at the two repositories made
// for cloud agent task runs.
// Git uses your own GitHub login (gh auth setup-git); the script reads and prints no token.
// Usage: node publish-cloud-agent-task-run-repositories.mjs [--push]
import fs from 'node:fs';
import path from 'node:path';
import {buildCloudAgentTaskRunRepository, loadCloud, loadRoutines} from './cloud.mjs';
import {codebaseVersionDir, codebaseVersions, runChecked, workDir} from './lib.mjs';

const push = process.argv.includes('--push');
const cloud = loadCloud();
const {repositories} = loadRoutines([]);
const stagingRoot = path.join(workDir, 'cloud');

for (const codebaseVersion of codebaseVersions) {
	const directory = path.join(stagingRoot, `staging-${codebaseVersion}`);
	if (path.dirname(directory) !== stagingRoot) {
		throw new Error(`Refusing to clear ${directory}: it is outside ${stagingRoot}.`);
	}

	fs.rmSync(directory, {recursive: true, force: true});
	fs.mkdirSync(stagingRoot, {recursive: true});
	const head = buildCloudAgentTaskRunRepository(codebaseVersionDir(codebaseVersion), directory, cloud);
	if (!push) {
		console.log(`${codebaseVersion}: built ${directory} at ${head.slice(0, 10)}; would push to ${repositories[codebaseVersion]} (${cloud.defaultBranch}). Add --push to send it.`);
		continue;
	}

	const result = runChecked('git', ['push', '--force', repositories[codebaseVersion], `HEAD:refs/heads/${cloud.defaultBranch}`], {cwd: directory});
	if (result.status !== 0) {
		throw new Error(`git push of ${codebaseVersion} to ${repositories[codebaseVersion]} failed: ${result.stderr.slice(-500)}`);
	}

	console.log(`${codebaseVersion}: pushed ${head.slice(0, 10)} to ${repositories[codebaseVersion]} (${cloud.defaultBranch}).`);
}
