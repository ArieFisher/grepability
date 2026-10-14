// Shared helpers: codebase configuration, file lists, TypeScript language service, comment lines, test reruns.
import {execFileSync, spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

export * from './helpers.mjs';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const workDir = path.join(projectRoot, 'work');
// The two versions of the codebase: the published codebase and the proposed codebase. Each lives in work/<version>.
export const publishedVersion = 'published';
export const proposedVersion = 'proposed';
export const versions = [publishedVersion, proposedVersion];
export const versionDir = version => path.join(workDir, version);
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const writeJson = (file, data) => {
	fs.mkdirSync(path.dirname(file), {recursive: true});
	fs.writeFileSync(file, JSON.stringify(data, null, '\t') + '\n');
};

export const loadConcepts = () => readJson(path.join(projectRoot, 'config', 'concepts.json'));
export const loadTasks = () => readJson(path.join(projectRoot, 'config', 'tasks.json'));

// Cap on the output a child process may print to a script: 256 MiB, far above the diff or test
// output of the Ky codebase. A child that prints more fails with an error.
export const maxOutputBytes = 1 << 28;

// Everything the agent changed since the snapshot, whether it left the change unstaged, staged it,
// committed it, or wrote a new file. Staging first brings new files into the diff. The a/ and b/ prefixes
// are set here because a git configuration of diff.noprefix drops them, and the diff parser needs them.
export const diffSinceSnapshot = (directory, snapshot) => {
	execFileSync('git', ['add', '-A'], {cwd: directory, stdio: 'ignore'});
	return execFileSync('git', ['diff', '--cached', '--unified=0', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', snapshot], {cwd: directory, encoding: 'utf8', maxBuffer: maxOutputBytes});
};

// Writes a version's files to a new directory without node_modules and .git, and links node_modules
// to the dependencies that every version and run copy shares (work/deps, installed by setup.sh).
export const copyCodebase = (source, destination) => {
	fs.mkdirSync(path.dirname(destination), {recursive: true});
	fs.cpSync(source, destination, {recursive: true, filter: from => !/[/\\](?:node_modules|\.git)$/.test(from)});
	fs.symlinkSync(path.join(workDir, 'deps', 'node_modules'), path.join(destination, 'node_modules'), 'dir');
};

// The codebase: which repository and commit the experiment runs on, which files form the corpus,
// and how to type-check and test it. Every field is required, so a missing one fails here rather
// than as an undefined deep inside a script.
const codebaseFile = path.join(projectRoot, 'config', 'codebase.json');
let codebaseCache;
export const loadCodebase = () => {
	if (codebaseCache) {
		return codebaseCache;
	}

	const codebase = readJson(codebaseFile);
	const required = ['repository', 'commit', 'corpus.directory', 'corpus.extension', 'install', 'compile', 'typecheck', 'tests.directory', 'tests.extension', 'tests.skip', 'tests.command', 'tests.rerun', 'tests.titleSeparator'];
	const missing = required.filter(field => field.split('.').reduce((value, part) => value?.[part], codebase) === undefined);
	if (missing.length > 0) {
		throw new Error(`${codebaseFile} is missing: ${missing.join(', ')}`);
	}

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

// Runs a command and returns its result. A command that cannot start (missing program, no
// permission, output past the cap) throws, because a null exit status reads as "no output" otherwise.
// A command that runs and exits non-zero returns normally; the caller reads `status`.
export const runChecked = (command, args, options = {}) => {
	const result = spawnSync(command, args, {encoding: 'utf8', maxBuffer: maxOutputBytes, ...options});
	if (result.error || result.status === null) {
		throw new Error(`${command} did not run to the end: ${result.error?.message ?? `signal ${result.signal}`}`);
	}

	return result;
};

// Runs the codebase's own compile step in one directory, so its type tests see the declarations of
// that directory's source. A failed step throws.
export const compileCodebase = (root, command = loadCodebase().compile) => {
	const [program, ...args] = command;
	const result = runChecked(program, args, {cwd: root});
	if (result.status !== 0) {
		throw new Error(`The compile command ${command.join(' ')} exited with status ${result.status} in ${root}:\n${(result.stdout + result.stderr).slice(-2000)}`);
	}
};

// Language service over the project's own tsconfig.json, so references match what the compiler sees.
// Files can be overridden in memory (used when applying renames). A tsconfig that is missing or has
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

// The hidden test's file name inside a run copy. The name is fixed so scoring can pick its results out of the test run.
const hiddenTestName = 'hidden-acceptance';

export const hiddenTestPath = root => {
	const {directory, extension} = loadCodebase().tests;
	return path.join(root, directory, `${hiddenTestName}${extension}`);
};

export const isHiddenTest = title => title.startsWith(hiddenTestName);

// How often a differing test reruns. Three reruns in one directory show whether the test is steady
// (all agree) or flaky (they differ), at the cost of three test-file runs per differing test.
export const rerunCount = 3;

// Reruns one test a few times by its TAP title; returns how many runs passed. The codebase's rerun
// command is a template: {file} is the test file the title starts with, {name} the rest of the title.
// A `*` in the name is escaped so a runner that matches names as globs takes it literally.
export const rerunTest = (root, title, times = rerunCount, tests = loadCodebase().tests) => {
	const [file, ...nameParts] = title.split(tests.titleSeparator);
	const name = nameParts.join(tests.titleSeparator).replaceAll('*', String.raw`\*`);
	const [command, ...args] = tests.rerun.map(part => part
		.replaceAll('{file}', `${tests.directory}/${file}${tests.extension}`)
		.replaceAll('{name}', name));
	let passed = 0;
	for (let i = 0; i < times; i++) {
		const result = runChecked(command, args, {cwd: root});
		if (result.status === 0 && /^ok \d+ /m.test(result.stdout)) {
			passed++;
		}
	}

	return passed;
};

// Compares two test-result files. A test whose result differs is rerun in both copies;
// if it both passes and fails across reruns it is reported as flaky, not as a difference.
export const compareTests = (resultA, resultB) => {
	const names = Object.keys({...resultA.tests, ...resultB.tests});
	const changed = names.filter(name => resultA.tests[name] !== resultB.tests[name]);
	const differences = [];
	const flaky = [];
	for (const name of changed) {
		if (resultA.tests[name] === undefined || resultB.tests[name] === undefined) {
			differences.push({name, a: resultA.tests[name], b: resultB.tests[name]});
			continue;
		}

		const passesA = rerunTest(resultA.directory, name);
		const passesB = rerunTest(resultB.directory, name);
		if ((passesA > 0 && passesA < rerunCount) || (passesB > 0 && passesB < rerunCount) || (passesA > 0) === (passesB > 0)) {
			flaky.push(name);
		} else {
			differences.push({name, a: passesA === rerunCount, b: passesB === rerunCount});
		}
	}

	return {differences, flaky};
};
