/** Read-only protocol preflight. Never logs raw config, account data, prompts or credentials.
 * node daemon/providers/probe.ts ABS_CODEX_EXE ABS_DEDICATED_HOME ABS_WORKSPACE
 */
import { pathToFileURL } from 'node:url';
import { launchProvider } from './runtime.ts';
import { inspectAppServer, PINNED_CODEX_VERSION } from './preflight.ts';
import { initializeMcp } from './mcp-server.ts';

export async function probe(executable: string, codexHome: string, workspace: string) {
  const app = await launchProvider('app-server', { executable, codexHome, workspace });
  let summary;
  try {
    const audit = await inspectAppServer(app, workspace, codexHome);
    summary = { version: PINNED_CODEX_VERSION, appServer: 'initialized', dedicatedHomeConfirmed: true,
      account: (audit.account as { account?: unknown })?.account ? 'present-not-runtime-verified' : 'signed-out',
      configRead: true, requirementsRead: true, skillsRead: true,
      mcpServerCount: audit.mcpServers.length, featureCount: audit.features.length,
      completeModelToolCatalog: false, modelCallMade: false, isolation: 'unverified' };
  } finally { app.close(); }
  const mcp = await launchProvider('mcp-server', { executable, codexHome, workspace });
  try {
    const tools = await initializeMcp(mcp);
    return { ...summary, mcpServer: 'initialized', mcpTools: tools.map(tool => tool.name),
      mcpSchemaEnforced: false, mcpInterrupt: 'abandon-and-tombstone', mcpRecovery: 'unsupported' };
  } finally { mcp.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [executable, home, workspace] = process.argv.slice(2);
  if (!executable || !home || !workspace) throw new Error('Usage: probe.ts ABS_CODEX_EXE ABS_DEDICATED_HOME ABS_WORKSPACE');
  probe(executable, home, workspace).then(value => console.log(JSON.stringify(value, null, 2)), () => {
    console.error('Provider preflight failed; no runtime capability verified.'); process.exitCode = 1;
  });
}
