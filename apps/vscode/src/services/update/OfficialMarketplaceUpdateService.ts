import { readFile } from "node:fs/promises"
import path from "node:path"
import { HostProvider } from "@/hosts/host-provider"
import { fetch } from "@/shared/net"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import { ExtensionRegistryInfo } from "@/registry"
import type { StateManager } from "@/core/storage/StateManager"

const OFFICIAL_EXTENSION_ID = "saoudrizwan.claude-dev"
const MARKETPLACE_QUERY_URL = "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery"
const MARKETPLACE_CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000
const MARKETPLACE_FETCH_TIMEOUT_MS = 10_000

type InstalledExtensionManifest = {
	name: string
	publisher: string
	displayName?: string
	version?: string
}

type MarketplaceQueryResponse = {
	results?: Array<{
		extensions?: Array<{
			versions?: Array<{
				version?: string
			}>
		}>
	}>
}

function getExtensionId(extension: Pick<InstalledExtensionManifest, "publisher" | "name">): string {
	return `${extension.publisher}.${extension.name}`
}

function compareVersions(currentVersion: string, latestVersion: string): number | undefined {
	const parseVersion = (value: string) => {
		const normalized = value.trim().split("-")[0]
		const parts = normalized.split(".").map((part) => Number.parseInt(part, 10))
		return parts.every((part) => Number.isFinite(part)) ? parts : undefined
	}

	const current = parseVersion(currentVersion)
	const latest = parseVersion(latestVersion)

	if (!current || !latest) {
		return undefined
	}

	const maxLength = Math.max(current.length, latest.length)
	for (let i = 0; i < maxLength; i++) {
		const left = current[i] ?? 0
		const right = latest[i] ?? 0
		if (left !== right) {
			return left < right ? -1 : 1
		}
	}

	return 0
}

async function readInstalledExtensionManifest(): Promise<InstalledExtensionManifest | undefined> {
	try {
		const manifestPath = path.join(HostProvider.get().extensionFsPath, "package.json")
		const rawManifest = await readFile(manifestPath, "utf8")
		const parsed = JSON.parse(rawManifest) as Partial<InstalledExtensionManifest>

		if (typeof parsed.name !== "string" || typeof parsed.publisher !== "string") {
			Logger.error("[OfficialMarketplaceUpdate] Installed extension manifest is missing name/publisher")
			return undefined
		}

		return {
			name: parsed.name,
			publisher: parsed.publisher,
			displayName: typeof parsed.displayName === "string" ? parsed.displayName : undefined,
			version: typeof parsed.version === "string" ? parsed.version : undefined,
		}
	} catch (error) {
		Logger.error("[OfficialMarketplaceUpdate] Failed to read installed extension manifest:", error)
		return undefined
	}
}

async function fetchLatestOfficialMarketplaceVersion(): Promise<string | undefined> {
	const abortController = new AbortController()
	const timeout = setTimeout(() => abortController.abort(), MARKETPLACE_FETCH_TIMEOUT_MS)

	try {
		const response = await fetch(MARKETPLACE_QUERY_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json;api-version=7.2-preview.1",
				"X-Market-Client-Id": "coconut-cline-update-checker",
			},
			body: JSON.stringify({
				filters: [
					{
						criteria: [{ filterType: 7, value: OFFICIAL_EXTENSION_ID }],
						pageNumber: 1,
						pageSize: 1,
						sortBy: 0,
						sortOrder: 0,
					},
				],
				assetTypes: [],
				flags: 103,
			}),
			signal: abortController.signal,
		})

		if (!response.ok) {
			throw new Error(`Marketplace query failed with status ${response.status}`)
		}

		const data = (await response.json()) as MarketplaceQueryResponse
		const latestVersion = data.results?.[0]?.extensions?.[0]?.versions?.[0]?.version

		if (typeof latestVersion !== "string" || latestVersion.length === 0) {
			Logger.error("[OfficialMarketplaceUpdate] Marketplace response did not include a latest version")
			return undefined
		}

		return latestVersion
	} finally {
		clearTimeout(timeout)
	}
}

export async function checkOfficialMarketplaceUpdate(stateManager: StateManager): Promise<void> {
	try {
		const installedManifest = await readInstalledExtensionManifest()
		if (!installedManifest) {
			return
		}

		const installedExtensionId = getExtensionId(installedManifest)
		if (installedExtensionId === OFFICIAL_EXTENSION_ID) {
			return
		}

		const lastCheckedAt = stateManager.getGlobalStateKey("officialMarketplaceVersionLastCheckedAt") ?? 0
		if (Date.now() - lastCheckedAt < MARKETPLACE_CHECK_INTERVAL_MS) {
			return
		}

		await stateManager.setGlobalState("officialMarketplaceVersionLastCheckedAt", Date.now())

		const latestOfficialVersion = await fetchLatestOfficialMarketplaceVersion()
		if (!latestOfficialVersion) {
			return
		}

		const currentVersion = installedManifest.version || ExtensionRegistryInfo.version
		const comparison = compareVersions(currentVersion, latestOfficialVersion)
		if (comparison === undefined) {
			Logger.error(
				`[OfficialMarketplaceUpdate] Failed to compare versions: current=${currentVersion}, latest=${latestOfficialVersion}`,
			)
			return
		}

		if (comparison >= 0) {
			return
		}

		const lastNotifiedVersion = stateManager.getGlobalStateKey("lastOfficialMarketplaceVersionNotified")
		if (lastNotifiedVersion === latestOfficialVersion) {
			return
		}

		Logger.log(
			`[OfficialMarketplaceUpdate] Official Marketplace version ${latestOfficialVersion} is newer than installed ${installedExtensionId}@${currentVersion}`,
		)

		await HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: `Marketplace 的官方 Cline 已更新到 v${latestOfficialVersion}，当前自定义版为 v${currentVersion}。如需同步，请运行打包脚本重新生成 VSIX。`,
			options: {
				detail: `检测对象：${OFFICIAL_EXTENSION_ID}。该检查每 3 小时执行一次。`,
				items: [],
			},
		})

		await stateManager.setGlobalState("lastOfficialMarketplaceVersionNotified", latestOfficialVersion)
	} catch (error) {
		Logger.error("[OfficialMarketplaceUpdate] Failed to check official Marketplace update:", error)
	}
}