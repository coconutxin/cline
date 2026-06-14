import type { ClineMessage } from "@shared/ExtensionMessage"
import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { AskResponseRequest, NewTaskRequest } from "@shared/proto/cline/task"
import { useCallback, useEffect, useRef } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { SlashServiceClient, TaskServiceClient } from "@/services/grpc-client"
import type { ButtonActionType } from "../shared/buttonConfig"
import type { ChatState, MessageHandlers } from "../types/chatTypes"

const AUTO_START_NEW_TASK_WITH_CONTEXT_STORAGE_KEY = "cline.autoStartNewTaskWithContext"

function isAutoStartNewTaskWithContextEnabled(): boolean {
	try {
		return window.localStorage.getItem(AUTO_START_NEW_TASK_WITH_CONTEXT_STORAGE_KEY) !== "false"
	} catch {
		return true
	}
}

function buildAutoContinuationPrompt(context: string): string {
	return `# Auto-Continuation Task

You are continuing the same long-running task in a new task segment. The previous segment generated the handoff context below.

## Mandatory Continuation Rules

- Do not ask the user what to do next.
- Do not present multiple options for the user to choose from.
- Continue directly from the "Next Immediate Action" in the handoff context.
- If additional context is needed, read the plan files, source files, or execution ledger mentioned in the handoff context.
- Only ask the user a follow-up question if there is a real blocker that cannot be resolved from the repository, the plan file, or the handoff context.
- When this segment or batch is complete and the overall task is not complete, call the \`new_task\` tool again with an updated executable handoff context.
- If the overall task is complete, call \`attempt_completion\` with a final report.

## Next Immediate Action

Start from the first concrete item under "Pending Tasks and Next Steps" in the handoff context. If that section names a specific batch, round, file, or checklist item, continue from that exact point.

## Previous Segment Handoff Context

${context}`
}

/**
 * Custom hook for managing message handlers
 * Handles sending messages, button clicks, and task management
 */
export function useMessageHandlers(messages: ClineMessage[], chatState: ChatState): MessageHandlers {
	const { backgroundCommandRunning } = useExtensionState()
	const {
		setInputValue,
		activeQuote,
		setActiveQuote,
		setSelectedImages,
		setSelectedFiles,
		setSendingDisabled,
		setEnableButtons,
		clineAsk,
		lastMessage,
	} = chatState
	const cancelInFlightRef = useRef(false)
	const autoStartedNewTaskWithContextRef = useRef<number | null>(null)

	// Handle sending a message
	const handleSendMessage = useCallback(
		async (text: string, images: string[], files: string[]) => {
			let messageToSend = text.trim()
			const hasContent = messageToSend || images.length > 0 || files.length > 0

			// Prepend the active quote if it exists
			if (activeQuote && hasContent) {
				const prefix = "[context] \n> "
				const formattedQuote = activeQuote
				const suffix = "\n[/context] \n\n"
				messageToSend = `${prefix} ${formattedQuote} ${suffix} ${messageToSend}`
			}

			if (hasContent) {
				console.log("[ChatView] handleSendMessage - Sending message:", messageToSend)
				let messageSent = false

				if (messages.length === 0) {
					await TaskServiceClient.newTask(
						NewTaskRequest.create({
							text: messageToSend,
							images,
							files,
						}),
					)
					messageSent = true
				} else if (clineAsk) {
					// For resume_task and resume_completed_task, use yesButtonClicked to match Resume button behavior
					// This ensures Enter key and Resume button work identically
					if (clineAsk === "resume_task" || clineAsk === "resume_completed_task") {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
								text: messageToSend,
								images,
								files,
							}),
						)
						messageSent = true
					} else {
						// All other ask types use messageResponse
						switch (clineAsk) {
							case "followup":
							case "plan_mode_respond":
							case "tool":
							case "browser_action_launch":
							case "command":
							case "command_output":
							case "use_mcp_server":
							case "use_subagents":
							case "completion_result":
							case "mistake_limit_reached":
							case "api_req_failed":
							case "new_task":
							case "condense":
							case "report_bug":
								await TaskServiceClient.askResponse(
									AskResponseRequest.create({
										responseType: "messageResponse",
										text: messageToSend,
										images,
										files,
									}),
								)
								messageSent = true
								break
						}
					}
				} else if (messages.length > 0) {
					// No clineAsk set - check if task is actively running
					// If so, allow interrupting it with feedback
					const lastMessage = messages[messages.length - 1]
					const isTaskRunning =
						lastMessage.partial === true || (lastMessage.type === "say" && lastMessage.say === "api_req_started")

					if (isTaskRunning) {
						// Task is running - send message as interruption/feedback
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "messageResponse",
								text: messageToSend,
								images,
								files,
							}),
						)
						messageSent = true
					}
				}

				// Only clear input and disable UI if message was actually sent
				if (messageSent) {
					setInputValue("")
					setActiveQuote(null)
					setSendingDisabled(true)
					setSelectedImages([])
					setSelectedFiles([])
					setEnableButtons(false)

					// Reset auto-scroll
					if ("disableAutoScrollRef" in chatState) {
						;(chatState as any).disableAutoScrollRef.current = false
					}
				}
			}
		},
		[
			messages.length,
			clineAsk,
			activeQuote,
			setInputValue,
			setActiveQuote,
			setSendingDisabled,
			setSelectedImages,
			setSelectedFiles,
			setEnableButtons,
			chatState,
		],
	)

	// Start a new task
	const startNewTask = useCallback(async () => {
		setActiveQuote(null)
		await TaskServiceClient.clearTask(EmptyRequest.create({}))
	}, [setActiveQuote])

	const startNewTaskWithContext = useCallback(
		async (context?: string, wrapForAutoContinuation = false) => {
			const taskText = context?.trim()
			if (!taskText) {
				return
			}

			await TaskServiceClient.newTask(
				NewTaskRequest.create({
					text: wrapForAutoContinuation ? buildAutoContinuationPrompt(taskText) : taskText,
					images: [],
					files: [],
				}),
			)
		},
		[],
	)

	useEffect(() => {
		if (!isAutoStartNewTaskWithContextEnabled()) {
			return
		}
		if (clineAsk !== "new_task") {
			return
		}
		if (lastMessage?.type !== "ask" || lastMessage.ask !== "new_task") {
			return
		}
		if (lastMessage.partial === true) {
			return
		}

		const context = lastMessage.text?.trim()
		if (!context || autoStartedNewTaskWithContextRef.current === lastMessage.ts) {
			return
		}

		autoStartedNewTaskWithContextRef.current = lastMessage.ts
		startNewTaskWithContext(context, true).catch((err) => {
			console.error("Failed to auto-start new task with context:", err)
			autoStartedNewTaskWithContextRef.current = null
		})
	}, [clineAsk, lastMessage, startNewTaskWithContext])

	// Clear input state helper
	const clearInputState = useCallback(() => {
		setInputValue("")
		setActiveQuote(null)
		setSelectedImages([])
		setSelectedFiles([])
	}, [setInputValue, setActiveQuote, setSelectedImages, setSelectedFiles])

	// Execute button action based on type
	const executeButtonAction = useCallback(
		async (actionType: ButtonActionType, text?: string, images?: string[], files?: string[]) => {
			const trimmedInput = text?.trim()
			const hasContent = trimmedInput || (images && images.length > 0) || (files && files.length > 0)

			switch (actionType) {
				case "retry":
					// For API retry (api_req_failed), always send simple approval without content
					await TaskServiceClient.askResponse(
						AskResponseRequest.create({
							responseType: "yesButtonClicked",
						}),
					)
					clearInputState()
					break
				case "approve":
					if (hasContent) {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
								text: trimmedInput,
								images: images,
								files: files,
							}),
						)
					} else {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
							}),
						)
					}
					clearInputState()
					break

				case "reject":
					if (hasContent) {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "noButtonClicked",
								text: trimmedInput,
								images: images,
								files: files,
							}),
						)
					} else {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "noButtonClicked",
							}),
						)
					}
					clearInputState()
					break

				case "proceed":
					if (hasContent) {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
								text: trimmedInput,
								images: images,
								files: files,
							}),
						)
					} else {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
							}),
						)
					}
					clearInputState()
					break

				case "new_task":
					if (clineAsk === "new_task") {
						await startNewTaskWithContext(lastMessage?.text)
					} else {
						await startNewTask()
					}
					break

				case "cancel": {
					if (cancelInFlightRef.current) {
						return
					}
					cancelInFlightRef.current = true
					setSendingDisabled(true)
					setEnableButtons(false)
					try {
						if (backgroundCommandRunning) {
							await TaskServiceClient.cancelBackgroundCommand(EmptyRequest.create({})).catch((err) =>
								console.error("Failed to cancel background command:", err),
							)
						}
						await TaskServiceClient.cancelTask(EmptyRequest.create({}))
					} finally {
						cancelInFlightRef.current = false
						// Clear any pending state that might interfere with resume
						setSendingDisabled(false)
						setEnableButtons(true)
					}
					break
				}

				case "utility":
					switch (clineAsk) {
						case "condense":
							await SlashServiceClient.condense(StringRequest.create({ value: lastMessage?.text })).catch((err) =>
								console.error(err),
							)
							break
						case "report_bug":
							await SlashServiceClient.reportBug(StringRequest.create({ value: lastMessage?.text })).catch((err) =>
								console.error(err),
							)
							break
					}
					break
			}

			if ("disableAutoScrollRef" in chatState) {
				;(chatState as any).disableAutoScrollRef.current = false
			}
		},
		[
			clineAsk,
			lastMessage,
			messages,
			clearInputState,
			handleSendMessage,
			startNewTask,
			startNewTaskWithContext,
			chatState,
			backgroundCommandRunning,
			setSendingDisabled,
			setEnableButtons,
		],
	)

	// Handle task close button click
	const handleTaskCloseButtonClick = useCallback(() => {
		startNewTask()
	}, [startNewTask])

	return {
		handleSendMessage,
		executeButtonAction,
		handleTaskCloseButtonClick,
		startNewTask,
	}
}
