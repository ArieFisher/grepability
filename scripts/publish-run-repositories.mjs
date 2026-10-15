// Cloud runs, step 1: builds the run repository of each version (the version's files and the start files, one
// commit) in work/cloud/, and with --push replaces the contents of the private repository named in the
// routine file with it. Without --push the script builds and prints what it would push, and sends nothing.
// A push replaces the repository's history, so point it only at the two repositories made for cloud runs.
// Git uses your own GitHub login (gh auth setup-git); the script reads and prints no token.
// Usage: node publish-run-repositories.mjs [--push]
import fs from 'node:fs';
import path from 'node:path';
import {buildRunRepository, loadCloud, loadRoutines} from './cloud.mjs';
import {runChecked, versionDir, versions, workDir} from './lib.mjs';

const push = process.argv.includes('--push');
const cloud = loadCloud();
const {repositories} = loadRoutines([]);
const stagingRoot = path.join(workDir, 'cloud');

for (const version of versions) {
	const directory = path.join(stagingRoot, `staging-${version}`);
	if (path.dirname(directory) !== stagingRoot) {
		throw new Error(`Refusing to clear ${directory}: it is outside ${stagingRoot}.`);
	}

	fs.rmSync(directory, {recursive: true, force: true});
	fs.mkdirSync(stagingRoot, {recursive: true});
	const head = buildRunRepository(versionDir(version), directory, cloud);
	if (!push) {
		console.log(`${version}: built ${directory} at ${head.slice(0, 10)}; would push to ${repositories[version]} (${cloud.defaultBranch}). Add --push to send it.`);
		continue;
	}

	const result = runChecked('git', ['push', '--force', repositories[version], `HEAD:refs/heads/${cloud.defaultBranch}`], {cwd: directory});
	if (result.status !== 0) {
		throw new Error(`git push of ${version} to ${repositories[version]} failed: ${result.stderr.slice(-500)}`);
	}

	console.log(`${version}: pushed ${head.slice(0, 10)} to ${repositories[version]} (${cloud.defaultBranch}).`);
}
