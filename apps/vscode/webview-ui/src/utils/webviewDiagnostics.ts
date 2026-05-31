const BYTES_PER_MIB = 1024 * 1024

export const WEBVIEW_DIAGNOSTIC_LOG_INTERVAL_MS = 10_000

type PerformanceWithMemory = Performance & {
	memory?: {
		usedJSHeapSize?: number
	}
}

export function getWebviewHeapUsageMb(): number | undefined {
	if (typeof performance === "undefined") {
		return undefined
	}

	const usedJSHeapSize = (performance as PerformanceWithMemory).memory?.usedJSHeapSize
	if (typeof usedJSHeapSize !== "number") {
		return undefined
	}

	return Math.round(usedJSHeapSize / BYTES_PER_MIB)
}
