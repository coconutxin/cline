@echo off
setlocal

chcp 65001 >nul

set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%" || (
	echo Failed to enter repository root: "%SCRIPT_DIR%"
	exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
	echo Node.js was not found in PATH. Please install Node.js or add it to PATH.
	popd
	exit /b 1
)

node package-vscode-coconut.mjs %*
set "EXIT_CODE=%ERRORLEVEL%"

popd
exit /b %EXIT_CODE%