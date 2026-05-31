const MAX_PARSE_WARNINGS = 20

let parseWarningCount = 0

/**
 * Parses JSON for webview render paths without allowing malformed task data to
 * crash the entire chat UI. Keep logging intentionally small: never log the raw
 * payload because task messages can be large and retained by DevTools.
 */
export function safeJsonParse<T>(value: string | null | undefined, fallback: T, context?: string): T {
	if (value == null || value === "") {
		return fallback
	}

	try {
		return JSON.parse(value) as T
	} catch (error) {
		if (context && parseWarningCount < MAX_PARSE_WARNINGS) {
			parseWarningCount += 1
			console.warn(
				`[safeJsonParse] Failed to parse ${context}:`,
				error instanceof Error ? error.message : String(error),
			)
		}

		return fallback
	}
}