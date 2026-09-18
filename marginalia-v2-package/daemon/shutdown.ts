import { mkdirSync } from 'node:fs';

export function ensurePrivateDataDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
}

export function shutdownSignals(platform: NodeJS.Platform): NodeJS.Signals[] {
  return platform === 'win32'
    ? ['SIGINT', 'SIGBREAK', 'SIGHUP']
    : ['SIGINT', 'SIGTERM', 'SIGHUP'];
}

export type ShutdownDependencies = {
  closeTerminal(): void;
  closeServer(): Promise<void>;
  closeSolver(): void;
  exit(code: 0 | 1): void;
};

export async function runShutdown(dependencies: ShutdownDependencies): Promise<void> {
  const deadline = setTimeout(() => dependencies.exit(1), 5_000);
  dependencies.closeTerminal();
  await dependencies.closeServer();
  dependencies.closeSolver();
  clearTimeout(deadline);
  dependencies.exit(0);
}
