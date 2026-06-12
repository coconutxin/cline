import type { Empty, EmptyRequest } from "@shared/proto/cline/common";
import { ShowMessageType } from "@shared/proto/host/window";
import { HostProvider } from "@/hosts/host-provider";
import {
	OPENAI_CODEX_OAUTH_CONFIG,
	openAiCodexOAuthManager,
} from "@/integrations/openai-codex/oauth";
import { Logger } from "@/shared/services/Logger";
import { openExternal } from "@/utils/env";
import type { Controller } from "..";

const PASTE_CALLBACK_URL_OPTION = "Paste Callback URL";

/**
 * Initiates OpenAI Codex OAuth authentication flow
 * Opens the authorization URL in the user's browser
 */
export async function openAiCodexSignIn(
	controller: Controller,
	_: EmptyRequest,
): Promise<Empty> {
	try {
		// Start the authorization flow and get the auth URL
		const authUrl = openAiCodexOAuthManager.startAuthorizationFlow();
		let callbackPromiseFailed = false;

		// Start listening before opening the browser to avoid missing fast redirects.
		const callbackPromise = openAiCodexOAuthManager.waitForCallback();

		// Open the auth URL in the browser
		await openExternal(authUrl);

		// Wait for the OAuth callback in the background
		// The callback will save credentials when complete
		callbackPromise
			.then(async () => {
				callbackPromiseFailed = false;
				HostProvider.window.showMessage({
					type: ShowMessageType.INFORMATION,
					message: "Successfully signed in to OpenAI Codex",
				});
				await controller.postStateToWebview();
			})
			.catch((error) => {
				callbackPromiseFailed = true;
				Logger.error("[openAiCodexSignIn] OAuth callback failed:", error);
				// Don't show notification for timeouts (user likely just abandoned)
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				const canStillCompleteManually = errorMessage.includes(
					`Port ${OPENAI_CODEX_OAUTH_CONFIG.callbackPort} is already in use`,
				);
				if (!canStillCompleteManually) {
					openAiCodexOAuthManager.cancelAuthorizationFlow();
				}
				if (!errorMessage.includes("timed out")) {
					HostProvider.window.showMessage({
						type: ShowMessageType.ERROR,
						message: `OpenAI Codex sign in failed: ${errorMessage}`,
					});
				}
			});

		void offerManualCallbackCompletionForRemote(
			controller,
			() => callbackPromiseFailed,
		);
	} catch (error) {
		Logger.error("[openAiCodexSignIn] Failed to start OAuth flow:", error);
		openAiCodexOAuthManager.cancelAuthorizationFlow();
		throw error;
	}

	return {};
}

async function offerManualCallbackCompletionForRemote(
	controller: Controller,
	didCallbackPromiseFail: () => boolean,
): Promise<void> {
	let remoteName: string | undefined;
	try {
		remoteName = (await HostProvider.env.getHostVersion({})).remoteName;
	} catch (error) {
		Logger.warn("[openAiCodexSignIn] Failed to detect remote host:", error);
	}

	if (!remoteName) {
		return;
	}

	try {
		const response = await HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message:
				"OpenAI Codex sign-in is running in a remote VS Code environment.",
			options: {
				items: [PASTE_CALLBACK_URL_OPTION],
				detail:
					`If the browser cannot reach localhost:${OPENAI_CODEX_OAUTH_CONFIG.callbackPort}, ` +
					`forward port ${OPENAI_CODEX_OAUTH_CONFIG.callbackPort} to the remote host or copy the full failed callback URL from the browser address bar and paste it here.`,
			},
		});

		if (response.selectedOption !== PASTE_CALLBACK_URL_OPTION) {
			return;
		}

		await promptForManualCallbackUrl(controller, didCallbackPromiseFail);
	} catch (error) {
		Logger.error(
			"[openAiCodexSignIn] Failed during remote callback guidance:",
			error,
		);
	}
}

async function promptForManualCallbackUrl(
	controller: Controller,
	didCallbackPromiseFail: () => boolean,
): Promise<void> {
	const input = await HostProvider.window.showInputBox({
		title: "Complete OpenAI Codex Sign In",
		prompt:
			"After authorizing in your browser, paste the full localhost callback URL from the address bar (it should include code=... and state=...).",
		value: OPENAI_CODEX_OAUTH_CONFIG.redirectUri,
	});

	const callbackUrl = input.response?.trim();
	if (!callbackUrl || callbackUrl === OPENAI_CODEX_OAUTH_CONFIG.redirectUri) {
		return;
	}

	try {
		await openAiCodexOAuthManager.completeAuthorizationFromCallbackUrl(
			callbackUrl,
		);
		if (didCallbackPromiseFail()) {
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "Successfully signed in to OpenAI Codex",
			});
		}
		await controller.postStateToWebview();
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		Logger.error(
			"[openAiCodexSignIn] Manual callback completion failed:",
			error,
		);
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: `OpenAI Codex sign in failed: ${errorMessage}`,
		});
	}
}
