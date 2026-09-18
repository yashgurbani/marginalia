// Frozen read-only preflight from main 89a633583906600c114c63c843aeadaa1b34f470.
// Full original store SHA256: 799e09a6310de36c06ca454afeb94c500c164ba1183412848cbd3d698cde31fd
import Database from 'better-sqlite3';
const READER_MIGRATIONS = [1, 2, 4, 7001, 7002, 7004] as const;
const KNOWN_MIGRATIONS = new Set<number>([...READER_MIGRATIONS, 3, 13]);
type ReaderSchema = { versions: number[]; hasSchema: boolean };
class UnsupportedReaderSchemaError extends Error { override name = 'UnsupportedReaderSchema'; }
function inspectReaderSchema(db: Database.Database): ReaderSchema {
  // These product-owned pragma markers are unused (zero) in this build. SQLite's
  // automatic schema_version counter is deliberately NOT a product version marker.
  if (db.pragma('user_version', { simple: true }) !== 0 || db.pragma('application_id', { simple: true }) !== 0) {
    throw new UnsupportedReaderSchemaError('This database has an unsupported schema marker. Open it with the matching newer build. Nothing was migrated.');
  }
  const objects = db.prepare("SELECT name,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all() as { name: string; type: string }[];
  const hasSchema = objects.length > 0;
  if (!objects.some(object => object.name === 'migrations' && object.type === 'table')) {
    if (hasSchema) throw new UnsupportedReaderSchemaError('This database has no recognized migration history. Nothing was migrated.');
    return { versions: [], hasSchema: false };
  }
  const columns = db.prepare('PRAGMA table_info(migrations)').all() as { name: string; type: string; pk: number }[];
  if (columns.length !== 1 || columns[0].name !== 'version' || columns[0].type.toUpperCase() !== 'INTEGER' || columns[0].pk !== 1) {
    throw new UnsupportedReaderSchemaError('The migration history has an unsupported shape. Nothing was migrated.');
  }
  const versions = (db.prepare('SELECT version FROM migrations ORDER BY version').all() as { version: number }[]).map(row => row.version);
  if (versions.some(version => !Number.isSafeInteger(version) || !KNOWN_MIGRATIONS.has(version)) || (!versions.length && objects.some(object => object.name !== 'migrations'))) {
    throw new UnsupportedReaderSchemaError('This database contains a newer or unknown migration. Open it with a compatible build. Nothing was migrated.');
  }
  return { versions, hasSchema };
}

export function oldReaderPreflight(filename: string) {
  const preflight = new Database(filename, { readonly: true, fileMustExist: true });
  try { return inspectReaderSchema(preflight); } finally { preflight.close(); }
}
