import { openAiCodexFastServiceTier, openAiCodexModels, supportsOpenAiCodexFastMode } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { normalizeApiConfiguration, supportsReasoningEffortForModelId } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface OpenAiCodexProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * OpenAI Codex (ChatGPT Plus/Pro) provider configuration component.
 * Uses OAuth authentication instead of API keys.
 */
export const OpenAiCodexProvider = ({ showModelOptions, isPopup, currentMode }: OpenAiCodexProviderProps) => {
	const { apiConfiguration, openAiCodexIsAuthenticated } = useExtensionState()
	const { handleModeFieldChange } = useApiConfigurationHandlers()

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)
	const showReasoningEffort = supportsReasoningEffortForModelId(selectedModelId, true)
	const supportsFastMode = supportsOpenAiCodexFastMode(selectedModelId)
	const serviceTier =
		currentMode === "plan"
			? apiConfiguration?.planModeOpenAiCodexServiceTier
			: apiConfiguration?.actModeOpenAiCodexServiceTier

	const handleSignIn = async () => {
		try {
			await AccountServiceClient.openAiCodexSignIn({})
		} catch (error) {
			console.error("Failed to sign in to OpenAI Codex:", error)
		}
	}

	const handleSignOut = async () => {
		try {
			await AccountServiceClient.openAiCodexSignOut({})
		} catch (error) {
			console.error("Failed to sign out of OpenAI Codex:", error)
		}
	}

	return (
		<div>
			<div style={{ marginBottom: "15px" }}>
				{openAiCodexIsAuthenticated ? (
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
						<span style={{ color: "var(--vscode-descriptionForeground)" }}>Signed in to OpenAI Codex</span>
						<VSCodeButton appearance="secondary" onClick={handleSignOut}>
							Sign Out
						</VSCodeButton>
					</div>
				) : (
					<div>
						<p
							style={{
								fontSize: "12px",
								color: "var(--vscode-descriptionForeground)",
								marginBottom: "10px",
							}}>
							Sign in with your ChatGPT Plus or Pro subscription to use GPT-5 models without an API key.
						</p>
						<VSCodeButton onClick={handleSignIn}>Sign in to OpenAI Codex</VSCodeButton>
					</div>
				)}
			</div>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={openAiCodexModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>
					{showReasoningEffort && (
						<ReasoningEffortSelector
							allowedEfforts={selectedModelInfo.reasoningEffortOptions}
							currentMode={currentMode}
						/>
					)}
					{supportsFastMode && (
						<VSCodeCheckbox
							checked={serviceTier === openAiCodexFastServiceTier}
							onChange={(event: any) =>
								handleModeFieldChange(
									{
										plan: "planModeOpenAiCodexServiceTier",
										act: "actModeOpenAiCodexServiceTier",
									},
									event.target.checked === true ? openAiCodexFastServiceTier : undefined,
									currentMode,
								)
							}>
							Fast mode — 1.5× speed, increased usage
						</VSCodeCheckbox>
					)}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
