import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { WorkspacePathAdapter } from "@core/workspace/WorkspacePathAdapter"
import { showApprovalNotification, showSystemNotification } from "@integrations/notifications"
import { COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import { ClineAsk } from "@shared/ExtensionMessage"
import { arePathsEqual } from "@utils/path"
import { telemetryService } from "@/services/telemetry"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { applyModelContentFixes } from "../utils/ModelContentProcessor"
import { ToolResultUtils } from "../utils/ToolResultUtils"

// Default idle timeout for command execution. The timer resets whenever output is received.
const DEFAULT_COMMAND_TIMEOUT_SECONDS = 30
const LONG_RUNNING_COMMAND_TIMEOUT_SECONDS = 300

const LONG_RUNNING_COMMAND_PATTERNS: RegExp[] = [
	/\b(npm|pnpm|yarn|bun)\s+(install|ci|build|test)\b/i,
	/\b(npm|pnpm|yarn|bun)\s+run\s+(build|test|lint|typecheck|check)\b/i,
	/\b(pip|pip3|uv)\s+install\b/i,
	/\b(poetry|pipenv)\s+install\b/i,
	/\b(cargo|go|mvn|gradle|gradlew)\s+(build|test|check|install)\b/i,
	/\b(make|cmake|ctest)\b/i,
	/\b(pytest|tox|nox|jest|vitest|mocha)\b/i,
	/\b(docker|podman)\s+build\b/i,
	/\b(torchrun|deepspeed|accelerate\s+launch)\b/i,
	/\bffmpeg\b/i,
	/\bpython(?:\d+(?:\.\d+)?)?\s+.*\b(train|finetune)\b/i,
]

export function isLikelyLongRunningCommand(command: string): boolean {
	const normalized = command.trim().replace(/\s+/g, " ")
	return LONG_RUNNING_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))
}

function splitCommandSegments(command: string): string[] {
	return command
		.split(/\s*(?:&&|\|\||[;&])\s*/)
		.map((segment) => segment.trim())
		.filter(Boolean)
}

function stripWrappers(segment: string): string {
	let stripped = segment.trim()
	while (stripped.startsWith("(") && stripped.endsWith(")")) {
		stripped = stripped.slice(1, -1).trim()
	}
	return stripped
}

function tokenizeCommandSegment(segment: string): string[] {
	const tokens = segment.match(/(?:"[^"]*"|'[^']*'|\S+)/g) ?? []
	return tokens.map((token) => token.replace(/^(["'])(.*)\1$/, "$2"))
}

function normalizeExecutableName(token: string | undefined): string {
	if (!token) {
		return ""
	}

	return token
		.trim()
		.replace(/^['"]|['"]$/g, "")
		.replace(/\\/g, "/")
		.split("/")
		.pop()!
		.toLowerCase()
		.replace(/\.(exe|cmd|bat|ps1)$/i, "")
}

function hasAnyFlag(tokens: string[], flags: string[]): boolean {
	const normalizedFlags = new Set(flags)
	return tokens.some((token) => normalizedFlags.has(token.toLowerCase()))
}

function isNpmInitWithoutYes(tokens: string[]): boolean {
	if (normalizeExecutableName(tokens[0]) !== "npm" || tokens[1]?.toLowerCase() !== "init") {
		return false
	}

	return !hasAnyFlag(tokens.slice(2), ["-y", "--yes", "--force"])
}

function isGitCommitWithoutMessage(tokens: string[]): boolean {
	if (normalizeExecutableName(tokens[0]) !== "git" || tokens[1]?.toLowerCase() !== "commit") {
		return false
	}

	return !hasAnyFlag(tokens.slice(2), ["-m", "--message", "-F", "--file", "--no-edit"])
}

function isLoginLikeInteractiveCommand(executable: string, tokens: string[]): boolean {
	const loginCommandExecutables = new Set([
		"az",
		"bun",
		"docker",
		"gcloud",
		"gh",
		"huggingface-cli",
		"npm",
		"pnpm",
		"vercel",
		"wandb",
		"yarn",
	])

	if (executable === "login" || executable === "signin" || executable === "authenticate") {
		return true
	}

	if (!loginCommandExecutables.has(executable)) {
		return false
	}

	return tokens.slice(1).some((token, index, args) => {
		if (/^(login|signin|authenticate)$/i.test(token)) {
			return true
		}

		return /^auth$/i.test(token) && /^(login|signin|authenticate)$/i.test(args[index + 1] ?? "")
	})
}

function hasLikelyScriptArgument(args: string[]): boolean {
	for (let index = 0; index < args.length; index++) {
		const arg = args[index]
		const lowerArg = arg.toLowerCase()

		if (lowerArg === "--") {
			return args.length > index + 1
		}

		if (!arg.startsWith("-")) {
			return true
		}
	}

	return false
}

export function getLikelyInteractiveCommandReason(command: string): string | undefined {
	for (const rawSegment of splitCommandSegments(command)) {
		const segment = stripWrappers(rawSegment)
		const lowerSegment = segment.toLowerCase()
		const tokens = tokenizeCommandSegment(segment)
		const executable = normalizeExecutableName(tokens[0])

		if (!executable) {
			continue
		}

		if (/^(pause|choice)$/.test(executable)) {
			return `Command segment "${segment}" waits for keyboard input.`
		}

		if (/\bset\s+\/p\b/i.test(segment)) {
			return `Command segment "${segment}" reads from stdin.`
		}

		if (/^(python|python\d+(?:\.\d+)?|py)$/.test(executable)) {
			const args = tokens.slice(1).map((token) => token.toLowerCase())
			const hasNonInteractiveFlag = args.some(
				(token) =>
					token === "-c" ||
					token === "-m" ||
					token === "--version" ||
					token === "-v" ||
					token === "-h" ||
					token === "--help",
			)
			if ((!hasNonInteractiveFlag && !hasLikelyScriptArgument(args)) || args.includes("-i")) {
				return `Command segment "${segment}" is likely to start a Python REPL. Use python -c, python -m, or a script path instead.`
			}
		}

		if (executable === "node") {
			const args = tokens.slice(1).map((token) => token.toLowerCase())
			const hasNonInteractiveFlag = args.some(
				(token) =>
					token === "-e" ||
					token === "--eval" ||
					token === "-p" ||
					token === "--print" ||
					token === "-v" ||
					token === "--version" ||
					token === "-h" ||
					token === "--help",
			)
			if (
				(!hasNonInteractiveFlag && !hasLikelyScriptArgument(args)) ||
				args.includes("-i") ||
				args.includes("--interactive")
			) {
				return `Command segment "${segment}" is likely to start a Node.js REPL. Use node -e or a script path instead.`
			}
		}

		if (/^(cmd|powershell|pwsh)$/.test(executable)) {
			const args = tokens.slice(1).map((token) => token.toLowerCase())
			const hasNonInteractiveFlag =
				executable === "cmd"
					? args.some((token) => token === "/c")
					: args.some(
							(token) => token === "-command" || token === "-c" || token === "-file" || token === "-encodedcommand",
						)
			if (!hasNonInteractiveFlag) {
				return `Command segment "${segment}" is likely to start an interactive shell. Provide a non-interactive command argument instead.`
			}
		}

		if (isNpmInitWithoutYes(tokens)) {
			return `Command segment "${segment}" is likely to prompt for package metadata. Use npm init -y for non-interactive execution.`
		}

		if (isGitCommitWithoutMessage(tokens)) {
			return `Command segment "${segment}" is likely to open an editor. Use git commit -m or git commit -F for non-interactive execution.`
		}

		if (
			isLoginLikeInteractiveCommand(executable, tokens) &&
			!lowerSegment.includes("--help") &&
			!lowerSegment.includes("--version")
		) {
			return `Command segment "${segment}" appears to start an authentication flow and may require interactive input.`
		}
	}

	return undefined
}

export function resolveCommandTimeoutSeconds(
	command: string,
	timeoutParam: string | undefined,
	useManagedTimeout: boolean,
): number | undefined {
	if (!useManagedTimeout) {
		return undefined
	}

	const parsed = timeoutParam ? Number.parseInt(timeoutParam, 10) : Number.NaN
	if (Number.isFinite(parsed) && parsed > 0) {
		return parsed
	}

	return isLikelyLongRunningCommand(command) ? LONG_RUNNING_COMMAND_TIMEOUT_SECONDS : DEFAULT_COMMAND_TIMEOUT_SECONDS
}

export class ExecuteCommandToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.BASH

	constructor(_validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.command}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const command = block.params.command
		if (uiHelpers.getConfig().isSubagentExecution) {
			return
		}

		// Check if this should be auto-approved to determine UI flow
		const shouldAutoApprove = uiHelpers.shouldAutoApproveTool(this.name)

		if (shouldAutoApprove) {
			// For auto-approved commands, we can't partially stream a say prematurely
			// since it may become an ask based on the requires_approval parameter
			// So we wait for the complete block
			return
		}
		await uiHelpers
			.ask("command" as ClineAsk, uiHelpers.removeClosingTag(block, "command", command), block.partial)
			.catch(() => {})
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		let command: string | undefined = block.params.command
		const requiresApprovalRaw: string | undefined = block.params.requires_approval
		const requiresApprovalPerLLM = requiresApprovalRaw?.toLowerCase() === "true"
		const timeoutParam: string | undefined = block.params.timeout
		let timeoutSeconds: number | undefined

		// Extract provider using the proven pattern from ReportBugHandler
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

		// Validate required parameters
		if (!command) {
			config.taskState.consecutiveMistakeCount++
			await config.callbacks.say(
				"error",
				"Cline tried to use execute_command without value for required parameter 'command'. Retrying...",
			)
			return formatResponse.toolError(formatResponse.executeCommandMissingCommandError())
		}

		if (!requiresApprovalRaw) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "requires_approval")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Timeout is managed as an idle timeout (no output for N seconds), so it is safe
		// to enable for all terminal modes. Active long-running commands keep resetting it.
		timeoutSeconds = resolveCommandTimeoutSeconds(command, timeoutParam, true)

		// Pre-process command for certain models
		if (config.api.getModel().id.includes("gemini")) {
			command = applyModelContentFixes(command)
		}

		// Handle multi-workspace command execution
		let executionDir: string = config.cwd
		let actualCommand: string = command

		let workspaceHintUsed = false
		let workspaceHint: string | undefined

		if (config.isMultiRootEnabled && config.workspaceManager) {
			// Check if command has a workspace hint prefix
			// e.g., "@backend:npm install" or just "npm install"
			const commandMatch = command.match(/^@(\w+):(.+)$/)

			if (commandMatch) {
				workspaceHintUsed = true
				workspaceHint = commandMatch[1]
				actualCommand = commandMatch[2].trim()

				// Find the workspace root for this hint
				const adapter = new WorkspacePathAdapter({
					cwd: config.cwd,
					isMultiRootEnabled: true,
					workspaceManager: config.workspaceManager,
				})

				// Resolve to get the workspace directory
				executionDir = adapter.resolvePath(".", workspaceHint)

				// Update command to remove the workspace prefix for display
				command = actualCommand
			}
			// If no hint, use primary workspace (cwd)
		}

		// Check command permission validation (CLINE_COMMAND_PERMISSIONS env var)
		const permissionResult = config.services.commandPermissionController.validateCommand(actualCommand)
		if (!permissionResult.allowed) {
			let errorMessage: string
			if (permissionResult.failedSegment) {
				errorMessage =
					`Command "${actualCommand}" was denied by CLINE_COMMAND_PERMISSIONS. ` +
					`Segment "${permissionResult.failedSegment}" ${permissionResult.reason}.`
			} else {
				const matchedPattern = permissionResult.matchedPattern
					? ` (matched pattern: ${permissionResult.matchedPattern})`
					: ""
				errorMessage =
					`Command "${actualCommand}" was denied by CLINE_COMMAND_PERMISSIONS. ` +
					`Reason: ${permissionResult.reason}${matchedPattern}`
			}
			if (!config.isSubagentExecution) {
				await config.callbacks.say("command_permission_denied", errorMessage)
			}
			return formatResponse.toolError(formatResponse.permissionDeniedError(errorMessage))
		}

		const interactiveCommandReason = getLikelyInteractiveCommandReason(actualCommand)
		if (interactiveCommandReason) {
			return formatResponse.toolError(
				`Command was not executed because it appears to require interactive input or start a REPL. ${interactiveCommandReason} Please rewrite it in a non-interactive form.`,
			)
		}

		// Check clineignore validation for command
		const ignoredFileAttemptedToAccess = config.services.clineIgnoreController.validateCommand(actualCommand)
		if (ignoredFileAttemptedToAccess) {
			if (!config.isSubagentExecution) {
				await config.callbacks.say("clineignore_error", ignoredFileAttemptedToAccess)
			}
			return formatResponse.toolError(formatResponse.clineIgnoreError(ignoredFileAttemptedToAccess))
		}

		let didAutoApprove = false

		// If the model says this command is safe and auto approval for safe commands is true, execute the command
		// If the model says the command is risky, but *BOTH* auto approve settings are true, execute the command
		const autoApproveResult = config.autoApprover?.shouldAutoApproveTool(block.name)
		const [autoApproveSafe, autoApproveAll] = Array.isArray(autoApproveResult)
			? autoApproveResult
			: [autoApproveResult, false]

		// Determine workspace context for telemetry
		const resolvedToNonPrimary = !arePathsEqual(executionDir, config.cwd)
		const workspaceContext = {
			isMultiRootEnabled: config.isMultiRootEnabled || false,
			usedWorkspaceHint: workspaceHintUsed,
			resolvedToNonPrimary,
			resolutionMethod: (workspaceHintUsed ? "hint" : "primary_fallback") as "hint" | "primary_fallback",
		}

		// Capture workspace path resolution telemetry
		if (config.isMultiRootEnabled && config.workspaceManager) {
			telemetryService.captureWorkspacePathResolved(
				config.ulid,
				"ExecuteCommandToolHandler",
				workspaceHintUsed ? "hint_provided" : "fallback_to_primary",
				workspaceHintUsed ? "workspace_name" : undefined,
				resolvedToNonPrimary, // resolution success = resolved to different workspace
				undefined, // TODO: could calculate workspace index if needed
				true,
			)
		}

		if (
			config.isSubagentExecution ||
			(!requiresApprovalPerLLM && autoApproveSafe) ||
			(requiresApprovalPerLLM && autoApproveSafe && autoApproveAll)
		) {
			// Auto-approve flow
			if (!config.isSubagentExecution) {
				await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "command")
				await config.callbacks.say("command", actualCommand, undefined, undefined, false)
			}
			didAutoApprove = true
			telemetryService.captureToolUsage(
				config.ulid,
				block.name,
				config.api.getModel().id,
				provider,
				true,
				true,
				workspaceContext,
				block.isNativeToolCall,
			)
		} else {
			// Manual approval flow
			void showApprovalNotification(
				{ message: actualCommand, requiresExplicitApproval: autoApproveSafe && requiresApprovalPerLLM },
				config.autoApprovalSettings.enableNotifications,
			)

			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback(
				"command",
				actualCommand + `${autoApproveSafe && requiresApprovalPerLLM ? COMMAND_REQ_APP_STRING : ""}`,
				config,
			)
			if (!didApprove) {
				telemetryService.captureToolUsage(
					config.ulid,
					block.name,
					config.api.getModel().id,
					provider,
					false,
					false,
					workspaceContext,
					block.isNativeToolCall,
				)
				return formatResponse.toolDenied()
			}
			telemetryService.captureToolUsage(
				config.ulid,
				block.name,
				config.api.getModel().id,
				provider,
				false,
				true,
				workspaceContext,
				block.isNativeToolCall,
			)
		}

		// Run PreToolUse hook after approval but before execution
		try {
			const { ToolHookUtils } = await import("../utils/ToolHookUtils")
			await ToolHookUtils.runPreToolUseIfEnabled(config, block)
		} catch (error) {
			const { PreToolUseHookCancellationError } = await import("@core/hooks/PreToolUseHookCancellationError")
			if (error instanceof PreToolUseHookCancellationError) {
				return formatResponse.toolDenied()
			}
			throw error
		}

		// Setup timeout notification for long-running auto-approved commands
		let timeoutId: NodeJS.Timeout | undefined
		if (didAutoApprove && config.autoApprovalSettings.enableNotifications && !config.isSubagentExecution) {
			// if the command was auto-approved, and it's long running we need to notify the user after some time has passed without proceeding
			timeoutId = setTimeout(() => {
				showSystemNotification({
					subtitle: "Command is still running",
					message: "An auto-approved command has been running for 30s, and may need your attention.",
				})
			}, 30_000)
		}

		// Execute the command in the correct directory
		// If executionDir is different from cwd, prepend cd command
		let finalCommand: string = actualCommand
		if (executionDir !== config.cwd) {
			// Use && to chain commands so they run in sequence
			finalCommand = `cd "${executionDir}" && ${actualCommand}`
		}

		const [userRejected, result] = await config.callbacks.executeCommandTool(finalCommand, timeoutSeconds)

		if (timeoutId) {
			clearTimeout(timeoutId)
		}

		// Invalidate the entire file read cache after any command execution.
		// Bash commands can modify files in ways we can't predict (sed, npm install, git checkout, mv, etc.),
		// so we must clear the cache to prevent stale reads.
		// Invalidate the entire file read cache after any command execution.
		// Bash commands can modify files in ways we can't predict (sed, npm install, git checkout, mv, etc.),
		// so we must clear the cache to prevent stale reads.
		if (!userRejected) {
			config.taskState.fileReadCache.clear()
		}

		if (userRejected) {
			config.taskState.didRejectTool = true
		}

		return result
	}
}
