---
name: install-stream
description: Install or check cc-dm-stream, the live TUI viewer for cc-dm messages. Use when the user asks to install stream, install cc-dm-stream, set up stream viewer, get cc-dm-stream, or check if cc-dm-stream is installed.
---

# Install cc-dm-stream

Install or check the cc-dm-stream TUI viewer for live cc-dm message monitoring.

## Arguments (fast path)

If `--check` is passed:
1. Run `which cc-dm-stream` via Bash.
   - If found, run `cc-dm-stream --version` and report the installed version.
   - If not found, report: **"cc-dm-stream is not installed."**
2. Stop here — do not proceed to installation.

## Detection

1. Run `which cc-dm-stream` via Bash.
2. If found, run `cc-dm-stream --version` and report: **"cc-dm-stream vX.Y.Z is already installed."** Suggest: "Run `cc-dm-stream` in a separate terminal tab/pane. Use `cc-dm-stream --project <tag>` to filter by project." Stop here.
3. If not found, proceed to install.

## Install method selection

1. Check each tool individually via Bash: run `command -v curl`, `command -v cargo`, `command -v npm`, `command -v brew`. Note which tools are available.
2. Present the available methods as a numbered list, with the shell installer as default:

   - **Shell installer** (default): `curl -sSL https://raw.githubusercontent.com/Akram012388/cc-dm-stream/main/install.sh | sh`
   - **cargo**: `cargo install cc-dm-stream`
   - **npm**: `npm install -g cc-dm-stream`
   - **Homebrew**: `brew tap Akram012388/cc-dm-stream && brew install cc-dm-stream`

   Only show methods whose prerequisite tool was found. Always show the shell installer if `curl` is available. If no methods are available (no curl, cargo, npm, or brew on PATH), report: **"No supported install method found. Install curl or download a binary from https://github.com/Akram012388/cc-dm-stream/releases"** and stop.

3. Ask the user: **"Which install method would you like to use?"** Default to the shell installer if the user just confirms or presses enter.
4. Wait for their response.
5. Run the selected install command via Bash.

## Post-install verification

1. Run `cc-dm-stream --version` via Bash.
   - If successful, confirm: **"cc-dm-stream vX.Y.Z installed successfully."**
   - If the command fails, report the error and suggest the user check their PATH.
2. Suggest: "Run `cc-dm-stream` in a separate terminal tab/pane. Use `cc-dm-stream --project <tag>` to filter by project."
