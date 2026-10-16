// The per-concept sections of the search score file: for each concept, its proposed search pattern, its published
// search pattern, and the name edits and wording edits that the proposed codebase build makes for it.

// Text as a code span. A backtick run one longer than any in the text fences it, and a space pads each side so a
// leading or trailing backtick or space survives.
const codeSpan = text => {
	const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length));
	const fence = '`'.repeat(longestRun + 1);
	return `${fence} ${text} ${fence}`;
};

// A code span for a table cell, with each pipe escaped so the table keeps its columns.
export const codeCell = text => codeSpan(text.replaceAll('|', String.raw`\|`));

const requiredFields = {nameEdits: ['concept', 'file', 'line', 'name', 'newName'], wordingEdits: ['concept', 'file', 'line', 'from', 'to']};

// Throws on a missing list, an entry missing a field, or an entry whose concept the concept configuration lacks.
const checkEdits = (concepts, edits) => {
	const ids = new Set(concepts.map(concept => concept.id));
	for (const [list, fields] of Object.entries(requiredFields)) {
		if (!Array.isArray(edits[list])) {
			throw new TypeError(`The proposed edits lack the ${list} list.`);
		}

		for (const edit of edits[list]) {
			const missing = fields.filter(field => edit[field] === undefined);
			if (missing.length > 0) {
				throw new TypeError(`A ${list} entry lacks ${missing.join(', ')}: ${JSON.stringify(edit)}`);
			}

			if (!ids.has(edit.concept)) {
				throw new Error(`A ${list} entry refers to a concept missing from the concept configuration: ${edit.concept}`);
			}
		}
	}
};

const where = group => group.map(edit => `${edit.file}:${edit.line}`).join(', ');

// One row per distinct edit, so identical edits share a row. A name edit changes every reference to the name, so its
// row gives the declarations, not a line count.
const editRows = (kind, edits) => Map.groupBy(edits, edit => JSON.stringify(kind === 'Name edit' ? [edit.name, edit.newName] : [edit.from, edit.to]))
	.values()
	.map(group => kind === 'Name edit'
		? `| ${kind} | ${codeCell(group[0].name)} | ${codeCell(group[0].newName)} | every reference | declared at ${where(group)} |`
		: `| ${kind} | ${codeCell(group[0].from)} | ${codeCell(group[0].to)} | ${group.length} | ${where(group)} |`)
	.toArray();

export const conceptEdits = (concepts, edits) => {
	checkEdits(concepts, edits);
	return concepts.flatMap(concept => {
		const rows = [
			...editRows('Name edit', edits.nameEdits.filter(edit => edit.concept === concept.id)),
			...editRows('Wording edit', edits.wordingEdits.filter(edit => edit.concept === concept.id)),
		];
		const table = rows.length > 0
			? ['| Edit | Published wording | Proposed wording | Lines | Where |', '|---|---|---|---|---|', ...rows]
			: ['The proposed codebase build makes no edit for this concept.'];
		return [
			'',
			`## ${concept.name}`,
			'',
			`Proposed search pattern: ${codeSpan(concept.proposedSearchPattern)}`,
			'',
			`Published search pattern: ${concept.publishedSearchPattern ? codeSpan(concept.publishedSearchPattern) : 'not recorded.'}`,
			'',
			...table,
		];
	});
};
