// Entry for the bundled ACP adapter when it runs inside Electron-as-Node.
// It hides the run-as-node switch from everything the agent spawns (the Claude CLI, shell commands,
// GUI apps it opens) and then hands control to the adapter script given as the first argument.
import { pathToFileURL } from 'node:url'

delete process.env.ELECTRON_RUN_AS_NODE
const entry = process.argv[2]
if (!entry) {
  console.error('usage: acp-bootstrap <adapter entry> [adapter args…]')
  process.exit(2)
}
// Make argv look like `node <entry> …args` for the adapter's own argv handling (--cli, --version).
process.argv.splice(1, 2, entry)
await import(pathToFileURL(entry).href)
