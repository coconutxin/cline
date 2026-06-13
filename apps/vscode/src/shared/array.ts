/**
 * Returns the index of the last element in the array where predicate is true, and -1
 * otherwise.
 * @param array The source array to search in
 * @param predicate find calls predicate once for each element of the array, in descending
 * order, until it finds one where predicate returns true. If such an element is found,
 * findLastIndex immediately returns that element index. Otherwise, findLastIndex returns -1.
 */
export function findLastIndex<T>(array: Array<T>, predicate: (value: T, index: number, obj: T[]) => boolean): number {
	let l = array.length
	while (l--) {
		if (predicate(array[l], l, array)) {
			return l
		}
	}
	return -1
}

export function findLast<T>(array: Array<T>, predicate: (value: T, index: number, obj: T[]) => boolean): T | undefined {
	const index = findLastIndex(array, predicate)
	return index === -1 ? undefined : array[index]
}

/**
 * Converts a partial or complete stringified array into an actual array.
 * Handles both complete JSON strings and incomplete array strings.
 * Splits on the specific tokens: ["  ", "  "]
 * @param arrayString A string representation of an array, which may be incomplete
 * @returns Array of strings parsed from the input
 */
export function parsePartialArrayString(arrayString: string): string[] {
	try {
		// Try parsing as complete JSON first
		return JSON.parse(arrayString)
	} catch {
		// If JSON parsing fails, handle as partial string
		const trimmed = arrayString.trim()
		if (!trimmed.startsWith('["')) {
			return []
		}

		// Remove leading ["
		let content = trimmed.slice(2)
		// Remove trailing "] if it exists
		content = content.replace(/"]$/, "")
		if (!content) {
			return []
		}

		// Split on ", " token and handle the parts
		return content
			.split('", "')
			.map((item) => item.trim())
			.filter(Boolean)
	}
}

function toCleanStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return []
	}

	return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
}

function parseMarkedOptionLines(optionsString: string): string[] {
	const lines = optionsString
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)

	if (lines.length < 2 || lines.length > 5) {
		return []
	}

	const options: string[] = []
	const markedListItemPattern = /^(?:(?:\d{1,2}[.)、．])\s*|[-*•]\s+)(.+)$/

	for (const line of lines) {
		const match = line.match(markedListItemPattern)
		if (!match) {
			return []
		}

		const option = match[1].trim()
		if (!option) {
			return []
		}

		options.push(option)
	}

	return options
}

function removeDanglingPartialArrayQuote(option: string): string {
	return option.endsWith('"') ? option.slice(0, -1).trim() : option
}

/**
 * Normalizes user-selectable tool options for chat UI buttons.
 *
 * This intentionally keeps parsePartialArrayString strict for existing non-UI
 * callers such as web_search domain filters, while adding a guarded fallback
 * for models that provide options as numbered or bulleted lines.
 */
export function parseUserSelectableOptions(options: unknown): string[] {
	const directArray = toCleanStringArray(options)
	if (directArray.length > 0) {
		return directArray
	}

	if (typeof options !== "string") {
		return []
	}

	try {
		const parsedJsonArray = toCleanStringArray(JSON.parse(options))
		if (parsedJsonArray.length > 0) {
			return parsedJsonArray
		}
	} catch {
		const parsedPartialArray = toCleanStringArray(parsePartialArrayString(options)).map(removeDanglingPartialArrayQuote)
		if (parsedPartialArray.length > 0) {
			return parsedPartialArray
		}
	}

	return parseMarkedOptionLines(options)
}
