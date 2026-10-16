// The concept wordings section of the search score file: for each concept, its proposed search pattern, its published
// search pattern, and the name edits and wording edits that the proposed codebase build makes for it.

// One table cell holding text as a code span. A backtick run one longer than any in the text fences it, and a pipe is
// escaped so the table keeps its columns.
const codeCell = text => {
	const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length));
	const fence = '`'.repeat(longestRun + 1);
	const padding = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
	return `${fence}${padding}${text.replaceAll('|', String.raw`\|`)}${padding}${fence}`;
};

// One row per distinct edit: identical edits on several lines share a row, with their count and their lines.
const editRows = (kind, edits, fromField, toField) => Map.groupBy(edits, edit => JSON.stringify([edit[fromField], edit[toField]]))
	.values()
	.map(group => `| ${kind} | ${codeCell(group[0][fromField])} | ${codeCell(group[0][toField])} | ${group.length} | ${group.map(edit => `${edit.file}:${edit.line}`).join(', ')} |`)
	.toArray();

export const conceptWordings = (concepts, edits) => {
	for (const list of ['nameEdits', 'comments']) {
		if (!Array.isArray(edits[list])) {
			throw new TypeError(`The proposed edits lack the ${list} list.`);
		}
	}

	const ids = new Set(concepts.map(concept => concept.id));
	const unknown = [...edits.nameEdits, ...edits.comments].filter(edit => !ids.has(edit.concept));
	if (unknown.length > 0) {
		throw new Error(`Proposed edits name concepts missing from the concept configuration: ${[...new Set(unknown.map(edit => edit.concept))].join(', ')}`);
	}

	return concepts.flatMap(concept => {
		const rows = [
			...editRows('Name edit', edits.nameEdits.filter(edit => edit.concept === concept.id), 'name', 'newName'),
			...editRows('Wording edit', edits.comments.filter(edit => edit.concept === concept.id), 'from', 'to'),
		];
		const table = rows.length > 0
			? ['| Edit | Published wording | Proposed wording | Edits | Where |', '|---|---|---|---|---|', ...rows]
			: ['The proposed codebase build makes no edit for this concept.'];
		const published = concept.publishedSearchPattern ? `\`${concept.publishedSearchPattern}\`` : 'not recorded.';
		return [
			'',
			`## ${concept.name}`,
			'',
			`Proposed search pattern: \`${concept.proposedSearchPattern}\``,
			'',
			`Published search pattern: ${published}`,
			'',
			...table,
		];
	});
};
