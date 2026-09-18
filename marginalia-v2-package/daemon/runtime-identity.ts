import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export function dedicatedRuntimeIdentity() {
  const executable = process.env.MARGINALIA_CODEX_EXECUTABLE, home = process.env.MARGINALIA_CODEX_HOME;
  if (!executable || !home || !isAbsolute(executable) || !isAbsolute(home) ||
    (process.platform === 'win32' && !/\.exe$/i.test(executable))) return undefined;
  try {
    const identity = { executable: realpathSync(executable), codexHome: realpathSync(home) };
    if (!statSync(identity.executable).isFile() || !statSync(identity.codexHome).isDirectory()) return undefined;
    const ambient = [join(homedir(), '.codex'), process.env.CODEX_HOME].filter((v): v is string => !!v);
    const nested = (a: string, b: string) => { const r = relative(a, b); return !r || (!isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`)); };
    if (ambient.some(value => {
      let actual: string; try { actual = realpathSync(value); } catch { actual = resolve(value); }
      return nested(actual, identity.codexHome) || nested(identity.codexHome, actual);
    })) return undefined;
    return identity;
  } catch { return undefined; }
}
