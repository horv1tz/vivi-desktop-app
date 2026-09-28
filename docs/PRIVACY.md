# Privacy and data handling

- **Where your data goes.** Text and voice transcripts you send to Vivi are forwarded to Anthropic's
  API by the Claude Code process (`api.anthropic.com`, optionally through your proxy). Files the
  agent reads, screenshots it takes and tool results become part of that conversation.
- **Voice is local by default.** Wake-word detection, speech recognition and synthesis run offline
  with sherpa-onnx models stored in the app data folder. Cloud voice (OpenAI) is opt-in.
- **Secrets.** API keys, OAuth tokens, proxy passwords and integration environment variables (e.g.
  a GitHub personal access token given to an MCP server in the Workshop screen) are encrypted with
  Electron `safeStorage` (Keychain / DPAPI / Secret Service) and stored in `secrets.json` in the
  app data folder — never in `settings.json` alongside everything else.
- **Sessions.** Conversation transcripts are stored by Claude Code under `<app data>/claude/projects`.
  Delete a session from the sidebar to remove its transcript.
- **Memory.** `~/Vivi/memory/VIVI.md` holds facts Vivi remembers about you; edit or delete it freely.
- **Logs.** `vivi.log` in the OS logs folder (Settings → About → Open logs) contains diagnostics,
  never message contents unless SDK debug logging is enabled.
- **Claude subscription sign-in.** Signing in with a Claude.ai subscription is intended for personal
  use with your own subscription only. It is not a way to distribute the app; use an API key otherwise.

## ACP mode

When the ACP backend is selected, Vivi runs the agent as a separate local process and serves its own tools to it over
HTTP on `127.0.0.1` at a random port. The endpoint accepts only requests carrying a bearer token generated for that
process and is closed when the agent stops; nothing listens on external interfaces. For the bundled Claude adapter the
token travels through the agent's environment (`VIVI_MCP_TOKEN`, expanded by Claude Code), not the command line.
A third-party ACP agent configured in Settings receives the proxy variables but **not** Vivi's Claude credentials
(API key / OAuth token); it does receive the MCP token that unlocks Vivi's computer-control tools, so only run agents
you trust.
