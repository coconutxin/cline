export type HistoryItem = {
	id: string
	ulid?: string // ULID for better tracking and metrics
	ts: number
	task: string
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
	durationMs?: number

	size?: number
	shadowGitConfigWorkTree?: string
	cwdOnTaskInitialization?: string
	workspaceAffinityPath?: string
	workspaceMatchStatus?: "matched" | "mismatched" | "unknown"
	conversationHistoryDeletedRange?: [number, number]
	isFavorited?: boolean
	checkpointManagerErrorMessage?: string

	modelId?: string
}
