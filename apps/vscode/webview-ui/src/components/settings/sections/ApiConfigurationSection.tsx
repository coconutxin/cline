import { ApiProvider } from "@shared/api"
import { UpdateSettingsRequest } from "@shared/proto/cline/state"
import PROVIDERS from "@shared/providers/providers.json"
import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { TabButton } from "../../mcp/configuration/McpConfigurationView"
import ApiOptions from "../ApiOptions"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { DropdownContainer } from "../common/ModelSelector"
import Section from "../Section"
import { getModelsForProvider, syncModeConfigurations } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface ApiConfigurationSectionProps {
	renderSectionHeader?: (tabId: string) => JSX.Element | null
	initialModelTab?: "recommended" | "free"
}

const ApiConfigurationSection = ({ renderSectionHeader, initialModelTab }: ApiConfigurationSectionProps) => {
	const { planActSeparateModelsSetting, mode, apiConfiguration, remoteConfigSettings } = useExtensionState()
	const [currentTab, setCurrentTab] = useState<Mode>(mode)
	const { handleFieldsChange } = useApiConfigurationHandlers()
	const fallbackProvider = apiConfiguration?.toolUseFailureFallbackApiProvider
	const fallbackModels = fallbackProvider ? getModelsForProvider(fallbackProvider, apiConfiguration) : undefined
	const fallbackModelId = apiConfiguration?.toolUseFailureFallbackApiModelId || ""
	const remoteProviders: string[] = remoteConfigSettings?.remoteConfiguredProviders || []
	const fallbackProviderOptions = PROVIDERS.list.filter(
		(option) => remoteProviders.length === 0 || remoteProviders.includes(option.value),
	)

	return (
		<div>
			{renderSectionHeader?.("api-config")}
			<Section>
				{/* Tabs container */}
				{planActSeparateModelsSetting ? (
					<div className="rounded-md mb-5">
						<div className="flex gap-px mb-[10px] -mt-2 border-0 border-b border-solid border-(--vscode-panel-border)">
							<TabButton
								disabled={currentTab === "plan"}
								isActive={currentTab === "plan"}
								onClick={() => setCurrentTab("plan")}
								style={{
									opacity: 1,
									cursor: "pointer",
								}}>
								Plan Mode
							</TabButton>
							<TabButton
								disabled={currentTab === "act"}
								isActive={currentTab === "act"}
								onClick={() => setCurrentTab("act")}
								style={{
									opacity: 1,
									cursor: "pointer",
								}}>
								Act Mode
							</TabButton>
						</div>

						{/* Content container */}
						<div className="-mb-3">
							<ApiOptions currentMode={currentTab} initialModelTab={initialModelTab} showModelOptions={true} />
						</div>
					</div>
				) : (
					<ApiOptions currentMode={mode} initialModelTab={initialModelTab} showModelOptions={true} />
				)}

				<div className="mb-[5px]">
					<VSCodeCheckbox
						checked={planActSeparateModelsSetting}
						className="mb-[5px]"
						onChange={async (e: any) => {
							const checked = e.target.checked === true
							try {
								// If unchecking the toggle, wait a bit for state to update, then sync configurations
								if (!checked) {
									await syncModeConfigurations(apiConfiguration, currentTab, handleFieldsChange)
								}
								await StateServiceClient.updateSettings(
									UpdateSettingsRequest.create({
										planActSeparateModelsSetting: checked,
									}),
								)
							} catch (error) {
								console.error("Failed to update separate models setting:", error)
							}
						}}>
						Use different models for Plan and Act modes
					</VSCodeCheckbox>
					<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
						Switching between Plan and Act mode will persist the API and model used in the previous mode. This may be
						helpful e.g. when using a strong reasoning model to architect a plan for a cheaper coding model to act on.
					</p>
				</div>

				<div className="mt-4 pt-3 border-0 border-t border-solid border-(--vscode-panel-border)">
					<VSCodeCheckbox
						checked={apiConfiguration?.toolUseFailureFallbackEnabled === true}
						className="mb-[5px]"
						onChange={(e: any) => {
							void handleFieldsChange({
								toolUseFailureFallbackEnabled: e.target.checked === true,
							})
						}}>
						Use fallback model for tool-use failures
					</VSCodeCheckbox>
					<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
						When enabled, Act mode can temporarily switch the current task to a fallback model if the primary model
						repeatedly fails to use required tools or call attempt_completion. This does not apply to API/network
						errors and does not change your primary model settings.
					</p>

					{apiConfiguration?.toolUseFailureFallbackEnabled === true && (
						<div className="mt-3 flex flex-col gap-3">
							<DropdownContainer className="dropdown-container" zIndex={900}>
								<label htmlFor="tool-use-failure-fallback-provider">
									<span className="font-medium">Fallback Provider</span>
								</label>
								<VSCodeDropdown
									className="w-full"
									id="tool-use-failure-fallback-provider"
									onChange={(event: any) => {
										const provider = event.target.value as ApiProvider | ""
										void handleFieldsChange({
											toolUseFailureFallbackApiProvider: provider || undefined,
											toolUseFailureFallbackApiModelId: undefined,
										})
									}}
									value={fallbackProvider || ""}>
									<VSCodeOption value="">Select fallback provider...</VSCodeOption>
									{fallbackProviderOptions.map((option) => (
										<VSCodeOption key={option.value} value={option.value}>
											{option.label}
										</VSCodeOption>
									))}
								</VSCodeDropdown>
							</DropdownContainer>

							{fallbackProvider && fallbackModels && (
								<DropdownContainer className="dropdown-container" zIndex={899}>
									<label htmlFor="tool-use-failure-fallback-model">
										<span className="font-medium">Fallback Model</span>
									</label>
									<VSCodeDropdown
										className="w-full"
										id="tool-use-failure-fallback-model"
										onChange={(event: any) => {
											const modelId = event.target.value as string
											void handleFieldsChange({
												toolUseFailureFallbackApiModelId: modelId || undefined,
											})
										}}
										value={fallbackModelId}>
										<VSCodeOption value="">Use provider default</VSCodeOption>
										{Object.keys(fallbackModels).map((modelId) => (
											<VSCodeOption
												className="break-words whitespace-normal max-w-full"
												key={modelId}
												value={modelId}>
												{modelId}
											</VSCodeOption>
										))}
									</VSCodeDropdown>
								</DropdownContainer>
							)}

							{fallbackProvider && !fallbackModels && (
								<div>
									<DebouncedTextField
										className="w-full"
										id="tool-use-failure-fallback-model-id"
										initialValue={fallbackModelId}
										key={fallbackProvider}
										onChange={(value) => {
											void handleFieldsChange({
												toolUseFailureFallbackApiModelId: value.trim() || undefined,
											})
										}}
										placeholder="Enter fallback model ID">
										Fallback Model ID
									</DebouncedTextField>
									<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
										For providers with dynamic model catalogs, enter the exact model ID. Leave blank to use
										the provider default when available.
									</p>
								</div>
							)}
						</div>
					)}
				</div>
			</Section>
		</div>
	)
}

export default ApiConfigurationSection
