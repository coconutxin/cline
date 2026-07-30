interface StateUpdateCoordinatorOptions<State> {
	readState: () => Promise<State>
	publishState: (state: State) => Promise<void>
}

interface StateUpdateWaiter {
	version: number
	resolve: () => void
	reject: (error: unknown) => void
}

/**
 * Serializes full-state reads and publications while coalescing overlapping
 * requests. This prevents a slow, older state read from being published after
 * a newer state snapshot.
 */
export class StateUpdateCoordinator<State> {
	private requestedVersion = 0
	private settledVersion = 0
	private isDraining = false
	private waiters: StateUpdateWaiter[] = []

	constructor(private readonly options: StateUpdateCoordinatorOptions<State>) {}

	requestUpdate(): Promise<void> {
		const version = ++this.requestedVersion
		const completion = new Promise<void>((resolve, reject) => {
			this.waiters.push({ version, resolve, reject })
		})

		this.startDrain()
		return completion
	}

	private startDrain(): void {
		if (this.isDraining) {
			return
		}

		this.isDraining = true
		void this.drain()
	}

	private async drain(): Promise<void> {
		// Retry one stale read before publishing. The bound prevents continuous
		// task updates from starving full-state delivery indefinitely.
		let didRetryStaleRead = false

		try {
			while (this.settledVersion < this.requestedVersion) {
				const snapshotVersion = this.requestedVersion

				try {
					const state = await this.options.readState()

					if (snapshotVersion < this.requestedVersion && !didRetryStaleRead) {
						didRetryStaleRead = true
						continue
					}

					await this.options.publishState(state)
					this.settledVersion = snapshotVersion
					this.resolveWaitersThrough(snapshotVersion)
					didRetryStaleRead = false
				} catch (error) {
					this.settledVersion = snapshotVersion
					this.rejectWaitersThrough(snapshotVersion, error)
					didRetryStaleRead = false
				}
			}
		} finally {
			this.isDraining = false

			// A request can arrive after the loop condition is checked but before
			// this async drain releases ownership.
			if (this.settledVersion < this.requestedVersion) {
				this.startDrain()
			}
		}
	}

	private resolveWaitersThrough(version: number): void {
		const pendingWaiters: StateUpdateWaiter[] = []

		for (const waiter of this.waiters) {
			if (waiter.version <= version) {
				waiter.resolve()
			} else {
				pendingWaiters.push(waiter)
			}
		}

		this.waiters = pendingWaiters
	}

	private rejectWaitersThrough(version: number, error: unknown): void {
		const pendingWaiters: StateUpdateWaiter[] = []

		for (const waiter of this.waiters) {
			if (waiter.version <= version) {
				waiter.reject(error)
			} else {
				pendingWaiters.push(waiter)
			}
		}

		this.waiters = pendingWaiters
	}
}
