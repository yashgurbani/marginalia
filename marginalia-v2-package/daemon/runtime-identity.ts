import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export type RuntimeIdentity = { executable: string; codexHome: string; homeMode?: 'dedicated' | 'ordinary' };
export type RuntimeDiscovery = { env?: NodeJS.ProcessEnv; userHome?: string };

/** Resolve known native npm layouts without running a PATH shim or reading home contents. */
function installedExecutable(env: NodeJS.ProcessEnv): string | undefined {
  const platform = process.platform, arch = process.arch;
  const target = platform === 'win32' ? `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`
    : `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-${platform === 'darwin' ? 'apple-darwin' : 'unknown-linux-musl'}`;
  const binary = platform === 'win32' ? 'codex.exe' : 'codex';
  const packageName = `codex-${platform}-${arch}`;
  for (const entry of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    const directory = entry.replace(/^"(.*)"$/, '$1');
    if (!isAbsolute(directory)) continue;
    const roots = [join(directory, 'node_modules', '@openai', 'codex'), join(directory, '..', 'lib', 'node_modules', '@openai', 'codex')];
    try { roots.push(resolve(dirname(realpathSync(join(directory, 'codex'))), '..')); } catch { /* No POSIX npm shim. */ }
    const candidates = [join(directory, binary), ...roots.flatMap(root => [
      join(root, 'node_modules', '@openai', packageName, 'vendor', target, 'bin', binary),
      join(root, 'vendor', target, 'bin', binary),
    ])];
    for (const candidate of candidates) {
      try {
        const actual = realpathSync(candidate);
        if (statSync(actual).isFile() && (platform !== 'win32' || /\.exe$/i.test(actual)) && !/\.(?:js|mjs|cjs)$/i.test(actual)) return actual;
      } catch { /* Try the next installed native binary. */ }
    }
  }
  return undefined;
}

/** Historical export retained for main/solver callers. Explicit configuration stays strict. */
export function dedicatedRuntimeIdentity({ env = process.env, userHome = homedir() }: RuntimeDiscovery = {}): RuntimeIdentity | undefined {
  const explicit = env.MARGINALIA_CODEX_EXECUTABLE !== undefined || env.MARGINALIA_CODEX_HOME !== undefined;
  const executable = explicit ? env.MARGINALIA_CODEX_EXECUTABLE : installedExecutable(env);
  // Never adopt an arbitrary inherited CODEX_HOME (for example an agent's managed account).
  const home = explicit ? env.MARGINALIA_CODEX_HOME : join(userHome, '.codex');
  if (!executable || !home || !isAbsolute(executable) || !isAbsolute(home) ||
    (process.platform === 'win32' && !/\.exe$/i.test(executable))) return undefined;
  try {
    const identity = { executable: realpathSync(executable), codexHome: realpathSync(home) };
    if (!statSync(identity.executable).isFile() || !statSync(identity.codexHome).isDirectory()) return undefined;
    if (!explicit) return { ...identity, homeMode: 'ordinary' };
    const ambient = [join(userHome, '.codex'), env.CODEX_HOME].filter((v): v is string => !!v);
    const nested = (a: string, b: string) => { const r = relative(a, b); return !r || (!isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`)); };
    if (ambient.some(value => {
      let actual: string; try { actual = realpathSync(value); } catch { actual = resolve(value); }
      return nested(actual, identity.codexHome) || nested(identity.codexHome, actual);
    })) return undefined;
    return identity;
  } catch { return undefined; }
}
