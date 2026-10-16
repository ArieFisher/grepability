// Shared helpers: codebase configuration, file lists, TypeScript language service, comment lines, individual
// codebase verification re-executions.
import {execFileSync, spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {containedEnv} from './containment.mjs';
import {parseTap} from './helpers.mjs';

export * from './helpers.mjs';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const workDir = path.join(projectRoot, 'work');
// The two codebase versions: the published codebase and the proposed codebase. Each lives in work/<codebase version>.
export const publishedCodebaseVersion = 'published';
export const proposedCodebaseVersion = 'proposed';
export const codebaseVersions = [publishedCodebaseVersion, proposedCodebaseVersion];
export const codebaseVersionDir = codebaseVersion => path.join(workDir, codebaseVersion);
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const writeJson = (file, data) => {
	fs.mkdirSync(path.dirname(file), {recursive: true});
	fs.writeFileSync(file, JSON.stringify(data, null, '\t') + '\n');
};

export const loadConcepts = () => readJson(path.join(projectRoot, 'config', 'concepts.json'));
export const loadTasks = () => readJson(path.join(projectRoot, 'config', 'tasks.json'));
export const loadProposedEdits = () => readJson(path.join(projectRoot, 'config', 'proposed-edits.json'));

// Cap on the output a child process may print to a script: 256 MiB, far above the diff or codebase verification suite
// output of the Ky codebase. A child that prints more fails with an error.
export const maxOutputBytes = 1 << 28;

// A fresh agent task run copy of a codebase version: the files in a new directory, one commit named Snapshot, shared
// dependencies linked. The diff after an agent task run is taken against that snapshot commit.
export const makeAgentTaskRunCopy = (source, directory) => {
	copyCodebase(source, directory);
	const git = (...args) => execFileSync('git', args, {cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});
	git('init', '-q');
	git('add', '-A');
	git('-c', 'user.name=snapshot', '-c', 'user.email=snapshot@example.invalid', 'commit', '-q', '-m', 'Snapshot');
	return {directory, snapshot: git('rev-parse', 'HEAD').trim()};
};

// Everything the agent changed since the snapshot, whether it left the change unstaged, staged it,
// committed it, or wrote a new file. Staging first brings new files into the diff. The a/ and b/ prefixes
// are set here because a git configuration of diff.noprefix drops them, and the diff parser needs them.
export const diffSinceSnapshot = (directory, snapshot) => {
	execFileSync('git', ['add', '-A'], {cwd: directory, stdio: 'ignore'});
	return execFileSync('git', ['diff', '--cached', '--unified=0', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', snapshot], {cwd: directory, encoding: 'utf8', maxBuffer: maxOutputBytes});
};

// Writes a codebase version's files to a new directory without node_modules and .git, and links node_modules
// to the dependencies that every codebase version and agent task run copy shares (work/deps, installed by setup.sh).
export const copyCodebase = (source, destination) => {
	fs.mkdirSync(path.dirname(destination), {recursive: true});
	fs.cpSync(source, destination, {recursive: true, filter: from => !/[/\\](?:node_modules|\.git)$/.test(from)});
	fs.symlinkSync(path.join(workDir, 'deps', 'node_modules'), path.join(destination, 'node_modules'), 'dir');
};

// The install command must skip the dependencies' own install scripts, which would otherwise run code from
// every dependency on this machine. A command without the flag throws.
export const checkInstallCommand = command => {
	if (!command.includes('--ignore-scripts')) {
		throw new Error(`The install command ${command.join(' ')} must contain --ignore-scripts, so dependency install scripts never run.`);
	}
};

// The codebase: which repository and commit the experiment studies, which files form the corpus,
// and how to type-check and verify it. Every script reads the codebase from here, so no script holds a fact about
// the codebase itself. Every field is required, so a missing one fails here rather
// than as an undefined deep inside a script.
const codebaseFile = path.join(projectRoot, 'config', 'codebase.json');
let codebaseCache;
export const loadCodebase = () => {
	if (codebaseCache) {
		return codebaseCache;
	}

	const codebase = readJson(codebaseFile);
	const required = ['repository', 'commit', 'corpus.directory', 'corpus.extension', 'install', 'compile', 'typecheck', 'verificationSuite.directory', 'verificationSuite.extension', 'verificationSuite.skip', 'verificationSuite.command', 'verificationSuite.reexecution', 'verificationSuite.verificationTitleSeparator', 'verificationSuite.declaration'];
	const missing = required.filter(field => field.split('.').reduce((value, part) => value?.[part], codebase) === undefined);
	if (missing.length > 0) {
		throw new Error(`${codebaseFile} is missing: ${missing.join(', ')}`);
	}

	checkInstallCommand(codebase.install);
	codebaseCache = codebase;
	return codebase;
};

// Corpus: every file with the corpus extension under the corpus directory, as repo-relative paths.
export const corpusFiles = root => {
	const {directory, extension} = loadCodebase().corpus;
	return fs.readdirSync(path.join(root, directory), {recursive: true})
		.filter(file => file.endsWith(extension))
		.map(file => path.join(directory, file).split(path.sep).join('/'))
		.sort();
};

// Whether a repo-relative file:line key or path lies in the corpus.
export const inCorpus = fileOrKey => fileOrKey.startsWith(`${loadCodebase().corpus.directory}/`);

// The temporary folder and npm cache of every command runChecked starts, inside the project (see containment.mjs).
export const commandTmpDir = path.join(workDir, 'tmp');

// Runs a command and returns its result. A command that cannot start (missing program, no
// permission, output past the cap) throws, because a null exit status reads as "no output" otherwise.
// A command that runs and exits non-zero returns normally; the caller reads `status`.
export const runChecked = (command, args, options = {}) => {
	fs.mkdirSync(commandTmpDir, {recursive: true});
	const result = spawnSync(command, args, {encoding: 'utf8', maxBuffer: maxOutputBytes, env: containedEnv(process.env, commandTmpDir), ...options});
	if (result.error || result.status === null) {
		throw new Error(`${command} did not run to the end: ${result.error?.message ?? `signal ${result.signal}`}`);
	}

	return result;
};

// Runs one configured command in a directory, as an argument list so no shell reads it. A command that
// cannot start or exits non-zero throws.
const runStep = (label, command, root) => {
	const [program, ...args] = command;
	const result = runChecked(program, args, {cwd: root});
	if (result.status !== 0) {
		throw new Error(`The ${label} command ${command.join(' ')} exited with status ${result.status} in ${root}:\n${(result.stdout + result.stderr).slice(-2000)}`);
	}
};

// Installs the codebase's dependencies in one directory with the configured install command.
export const installCodebase = (root, command = loadCodebase().install) => {
	checkInstallCommand(command);
	runStep('install', command, root);
};

// Runs the codebase's own compile step in one directory, so its type checks see the declarations of
// that directory's source. A failed step throws.
export const compileCodebase = (root, command = loadCodebase().compile) => runStep('compile', command, root);

// Language service over the project's own tsconfig.json, so references match what the compiler sees.
// Files can be overridden in memory (used when applying name edits). A tsconfig that is missing or has
// errors stops here, because a service over the wrong file list finds the wrong references.
export const createService = (root, overrides = new Map()) => {
	const configPath = path.join(root, 'tsconfig.json');
	const config = ts.readConfigFile(configPath, ts.sys.readFile);
	const parsed = ts.parseJsonConfigFileContent(config.config ?? {}, ts.sys, root, {noEmit: true}, configPath);
	const errors = [config.error, ...parsed.errors].filter(Boolean);
	if (errors.length > 0) {
		throw new Error(`tsconfig ${configPath} has errors: ${errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('; ')}`);
	}

	const files = parsed.fileNames;
	const host = {
		getScriptFileNames: () => files,
		// Version by content, so an override that keeps the length still invalidates the snapshot.
		getScriptVersion: file => overrides.has(file) ? crypto.createHash('sha1').update(overrides.get(file)).digest('hex') : '0',
		getScriptSnapshot(file) {
			if (overrides.has(file)) {
				return ts.ScriptSnapshot.fromString(overrides.get(file));
			}

			if (!fs.existsSync(file)) {
				return undefined;
			}

			return ts.ScriptSnapshot.fromString(fs.readFileSync(file, 'utf8'));
		},
		getCurrentDirectory: () => root,
		getCompilationSettings: () => parsed.options,
		getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
		fileExists: ts.sys.fileExists,
		readFile: ts.sys.readFile,
		readDirectory: ts.sys.readDirectory,
		directoryExists: ts.sys.directoryExists,
		getDirectories: ts.sys.getDirectories,
	};
	return ts.createLanguageService(host, ts.createDocumentRegistry());
};

export const relative = (root, file) => path.relative(root, file).split(path.sep).join('/');

// Character offset of `name` on a 1-based line; `nth` picks a later occurrence on the same line.
export const positionOf = (root, file, line, name, nth = 0) =>
	positionInText(fs.readFileSync(path.join(root, file), 'utf8'), file, line, name, nth);

export const positionInText = (text, file, line, name, nth = 0) => {
	const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const lineStart = sf.getPositionOfLineAndCharacter(line - 1, 0);
	const lineText = text.slice(lineStart).split('\n')[0];
	let column = -1;
	for (let i = 0; i <= nth; i++) {
		column = findName(lineText, name, column + 1);
		if (column === -1) {
			throw new Error(`Name ${name} (occurrence ${nth}) not found at ${file}:${line}`);
		}
	}

	return lineStart + column;
};

const findName = (lineText, name, from) => {
	const pattern = new RegExp(`(?<![\\w$#])${name.replaceAll(/[$#]/g, String.raw`\$&`)}(?![\\w$])`, 'g');
	pattern.lastIndex = from;
	const match = pattern.exec(lineText);
	return match ? match.index : -1;
};

export const lineOf = (root, file, position) => {
	const text = fs.readFileSync(path.join(root, file), 'utf8');
	return text.slice(0, position).split('\n').length;
};

// Every comment line (1-based) of one file's text, with its text. The parser decides what is a
// comment, so a template tail or a regular expression that holds `//` or `/*` is not one. Comments
// are the trivia before and after each token of the tree; JSDoc nodes are skipped because the
// comment that holds them is already covered.
export const commentLinesOfText = (file, text) => {
	const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const ranges = new Map();
	const addRanges = found => {
		for (const range of found ?? []) {
			ranges.set(range.pos, range.end);
		}
	};

	const visit = node => {
		addRanges(ts.getLeadingCommentRanges(text, node.getFullStart()));
		addRanges(ts.getTrailingCommentRanges(text, node.getEnd()));
		for (const child of node.getChildren(sf)) {
			if (child.kind < ts.SyntaxKind.FirstJSDocNode || child.kind > ts.SyntaxKind.LastJSDocNode) {
				visit(child);
			}
		}
	};

	visit(sf);
	const lines = new Set();
	for (const [start, end] of ranges) {
		const first = sf.getLineAndCharacterOfPosition(start).line;
		const last = sf.getLineAndCharacterOfPosition(end).line;
		for (let line = first; line <= last; line++) {
			lines.add(line + 1);
		}
	}

	const textLines = text.split('\n');
	const result = [];
	for (const line of [...lines].sort((a, b) => a - b)) {
		const lineText = textLines[line - 1].trim();
		if (/^(?:\/\*\*?|\*\/|\*|\/\/)?$/.test(lineText)) {
			continue; // Comment delimiters and blank comment lines carry no words.
		}

		result.push({file, line, text: lineText});
	}

	return result;
};

// Every comment line of every corpus file under root.
export const commentLines = root => corpusFiles(root)
	.flatMap(file => commentLinesOfText(file, fs.readFileSync(path.join(root, file), 'utf8')));

// The withheld acceptance test's file name inside an agent task run copy. The name is fixed so scoring can pick its
// results out of the codebase verification suite execution.
const withheldAcceptanceTestName = 'withheld-acceptance';

export const withheldAcceptanceTestPath = root => {
	const {directory, extension} = loadCodebase().verificationSuite;
	return path.join(root, directory, `${withheldAcceptanceTestName}${extension}`);
};

export const isWithheldAcceptanceTest = verificationTitle => verificationTitle.startsWith(withheldAcceptanceTestName);

// How often a differing individual codebase verification re-executes. Three re-executions in one directory show
// whether the individual codebase verification is steady (all agree) or a flaky verification (they differ), at the
// cost of three verification file executions per differing individual codebase verification.
export const reexecutionCount = 3;

// Re-executes one individual codebase verification a few times by its verification title; returns how many
// re-executions passed. The codebase's re-execution command is a template: {file} is the verification file the
// title starts with, {name} the rest of the title. A `*` in the name is escaped so a runner that matches names as
// globs takes it literally. A runner that matches names in any letter case also executes an individual codebase
// verification whose name differs only in case, so a re-execution counts as passed only when parseTap reads the
// exact name as passing; a runner executing one verification file prints names with no file.
export const reexecuteVerification = (root, verificationTitle, times = reexecutionCount, verificationSuite = loadCodebase().verificationSuite) => {
	const separator = verificationSuite.verificationTitleSeparator;
	const [file, ...nameParts] = verificationTitle.split(separator);
	const name = nameParts.join(separator);
	const [command, ...args] = verificationSuite.reexecution.map(part => part
		.replaceAll('{file}', `${verificationSuite.directory}/${file}${verificationSuite.extension}`)
		.replaceAll('{name}', name.replaceAll('*', String.raw`\*`)));
	let passed = 0;
	for (let i = 0; i < times; i++) {
		const result = runChecked(command, args, {cwd: root});
		if (parseTap(result.stdout)[name] === true) {
			passed++;
		}
	}

	return passed;
};

// Compares two codebase verification suite result files. An individual codebase verification whose result
// differs re-executes in both directories; one that both passes and fails across re-executions is a flaky
// verification, not a difference.
export const compareVerificationSuiteResults = (resultA, resultB) => {
	const titles = Object.keys({...resultA.verifications, ...resultB.verifications});
	const changed = titles.filter(title => resultA.verifications[title] !== resultB.verifications[title]);
	const differences = [];
	const flakyVerifications = [];
	for (const title of changed) {
		if (resultA.verifications[title] === undefined || resultB.verifications[title] === undefined) {
			differences.push({title, a: resultA.verifications[title], b: resultB.verifications[title]});
			continue;
		}

		const passesA = reexecuteVerification(resultA.directory, title);
		const passesB = reexecuteVerification(resultB.directory, title);
		if ((passesA > 0 && passesA < reexecutionCount) || (passesB > 0 && passesB < reexecutionCount) || (passesA > 0) === (passesB > 0)) {
			flakyVerifications.push(title);
		} else {
			differences.push({title, a: passesA === reexecutionCount, b: passesB === reexecutionCount});
		}
	}

	return {differences, flakyVerifications};
};
