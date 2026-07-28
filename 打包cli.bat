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
	echo Node.js was not found in PATH. Please install Node.js 22 or add it to PATH.
	popd
	exit /b 1
)

set "BUN_WINGET_DIR=%LOCALAPPDATA%\Microsoft\WinGet\Packages\Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe\bun-windows-x64"
if exist "%BUN_WINGET_DIR%\bun.exe" (
	set "PATH=%BUN_WINGET_DIR%;%PATH%"
)

where bun >nul 2>nul
if errorlevel 1 (
	echo Bun was not found in PATH. Please install Bun 1.3.13 first.
	echo Suggested command: winget install --id Oven-sh.Bun -e --version 1.3.13
	popd
	exit /b 1
)

set "DEFAULT_SYNC_TAG=v4.0.11"
node package-cli-coconut.mjs --sync-tag "%DEFAULT_SYNC_TAG%" %*
set "EXIT_CODE=%ERRORLEVEL%"

popd
exit /b %EXIT_CODE%