// Builds the proposed codebase from the published codebase using config/proposed-edits.json:
//   nameEdits: name edits through the type checker, so every reference changes and nothing else does;
//   comments: exact wording replacements on one line each.
// Then checks that every file keeps its line count (so ground-truth lines map 1:1) and that type checks and the
// codebase verification suite give the same results as the published codebase.
// Usage: node build-proposed.mjs
import fs from 'node:fs';
import path from 'node:path';
import {codebaseVersionDir, compareVerificationSuiteResults, compileCodebase, copyCodebase, corpusFiles, createService, positionInText, projectRoot, proposedCodebaseVersion, publishedCodebaseVersion, readJson, relative, runChecked, workDir} from './lib.mjs';

const source = codebaseVersionDir(publishedCodebaseVersion);
const target = codebaseVersionDir(proposedCodebaseVersion);
const edits = readJson(path.join(projectRoot, 'config', 'proposed-edits.json'));

fs.rmSync(target, {recursive: true, force: true});
copyCodebase(source, target);

const texts = new Map(corpusFiles(target).map(file => [path.join(target, file), fs.readFileSync(path.join(target, file), 'utf8')]));
const log = [];

for (const nameEdit of edits.nameEdits) {
	const absolute = path.join(target, nameEdit.file);
	const position = positionInText(texts.get(absolute), nameEdit.file, nameEdit.line, nameEdit.name, nameEdit.nth ?? 0);
	const service = createService(target, texts);
	const info = service.getRenameInfo(absolute, position, {allowRenameOfImportPath: false});
	if (!info.canRename) {
		throw new Error(`Cannot apply the name edit to ${nameEdit.name} at ${nameEdit.file}:${nameEdit.line}: ${info.localizedErrorMessage}`);
	}

	const locations = service.findRenameLocations(absolute, position, false, false, {providePrefixAndSuffixTextForRename: true});
	if (!locations || locations.length === 0) {
		throw new Error(`The name edit of ${nameEdit.name} at ${nameEdit.file}:${nameEdit.line} has no locations.`);
	}

	const byFile = Map.groupBy(locations, location => location.fileName);
	for (const [file, fileLocations] of byFile) {
		if (!texts.has(file)) {
			throw new Error(`The name edit of ${nameEdit.name} reaches outside the corpus: ${file}`);
		}

		let text = texts.get(file);
		for (const location of fileLocations.sort((a, b) => b.textSpan.start - a.textSpan.start)) {
			const replacement = `${location.prefixText ?? ''}${nameEdit.newName}${location.suffixText ?? ''}`;
			text = text.slice(0, location.textSpan.start) + replacement + text.slice(location.textSpan.start + location.textSpan.length);
		}

		texts.set(file, text);
	}

	log.push(`name edit ${nameEdit.name} -> ${nameEdit.newName}: ${locations.length} locations in ${[...byFile.keys()].map(file => relative(target, file)).join(', ')}`);
}

for (const edit of edits.comments) {
	const absolute = path.join(target, edit.file);
	const lines = texts.get(absolute).split('\n');
	const line = lines[edit.line - 1];
	const count = line.split(edit.from).length - 1;
	if (count !== 1) {
		throw new Error(`Expected "${edit.from}" once at ${edit.file}:${edit.line}, found ${count} times in: ${line.trim()}`);
	}

	lines[edit.line - 1] = line.replace(edit.from, () => edit.to); // A function keeps `$&` and `$1` in `to` literal.
	texts.set(absolute, lines.join('\n'));
}

log.push(`wording edits: ${edits.comments.length}`);

// Every file keeps its line count, or nothing is written: the ground truth maps lines 1:1.
for (const [file, text] of texts) {
	const original = fs.readFileSync(path.join(source, relative(target, file)), 'utf8');
	if (original.split('\n').length !== text.split('\n').length) {
		throw new Error(`Line count changed in ${relative(target, file)}`);
	}
}

for (const [file, text] of texts) {
	fs.writeFileSync(file, text);
}

console.log(log.join('\n'));

// The copied compile output still holds the published names. The proposed codebase compiles from its own source.
compileCodebase(target);

// Same type check and codebase verification suite results as the published codebase?
// execute-verification-suite.mjs exits 1 after a failed type check and still writes its result, so only a missing
// file is a failure.
const executeVerificationSuite = codebaseVersion => {
	const resultPath = path.join(workDir, `pre-edit-results-${codebaseVersion}.json`);
	fs.rmSync(resultPath, {force: true});
	runChecked('node', [path.join(projectRoot, 'scripts', 'execute-verification-suite.mjs'), codebaseVersion], {stdio: 'inherit'});
	if (!fs.existsSync(resultPath)) {
		throw new Error(`The codebase verification suite execution of ${codebaseVersion} wrote no result in ${resultPath}.`);
	}

	return readJson(resultPath);
};

const proposed = executeVerificationSuite(proposedCodebaseVersion);
const publishedResultsPath = path.join(workDir, `pre-edit-results-${publishedCodebaseVersion}.json`);
const published = fs.existsSync(publishedResultsPath) ? readJson(publishedResultsPath) : executeVerificationSuite(publishedCodebaseVersion);
if (!published.typecheck) {
	throw new Error(`The published codebase fails its type check, so the proposed codebase has no results to match:\n${published.typecheckErrors}`);
}

if (proposed.typecheck) {
	const {differences, flakyVerifications} = compareVerificationSuiteResults(published, proposed);
	if (flakyVerifications.length > 0) {
		console.log(`Flaky verifications in both codebase versions, ignored: ${flakyVerifications.join('; ')}`);
	}

	if (differences.length > 0) {
		console.log(`Individual codebase verifications differ from the published codebase:\n${differences.map(item => `  ${item.title}: published ${item.a}, proposed ${item.b}`).join('\n')}`);
		process.exitCode = 1;
	} else {
		console.log('The proposed codebase matches the published codebase: type checks pass and every individual codebase verification has the same result.');
	}
} else {
	console.log(`Proposed codebase type check FAILED:\n${proposed.typecheckErrors}`);
	process.exitCode = 1;
}
