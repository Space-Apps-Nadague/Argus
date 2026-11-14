/**
 * Resolves the database URL (specs/05-data-platform.md §2).
 *
 * Order:
 *   1. DATABASE_URL                                   postgres://… or pglite:… (local dev, teammates)
 *   2. AZURE_POSTGRESQL_CONNECTIONSTRING              App Service app setting / Service Connector
 *   3. CUSTOMCONNSTR_AZURE_POSTGRESQL_CONNECTIONSTRING App Service "Connection strings" (type Custom) on Linux
 *   4. POSTGRESQLCONNSTR_AZURE_POSTGRESQL_CONNECTIONSTRING (type PostgreSQL)
 * Azure values use the ADO.NET format: "Database=…;Server=…;User Id=…;Password=…" and are converted to a URL.
 */

type Env = Record<string, string | undefined>;

export const AZURE_CONNECTION_STRING_VARS = [
  'AZURE_POSTGRESQL_CONNECTIONSTRING',
  'CUSTOMCONNSTR_AZURE_POSTGRESQL_CONNECTIONSTRING',
  'POSTGRESQLCONNSTR_AZURE_POSTGRESQL_CONNECTIONSTRING',
];

/** Splits "k=v;k2=v2" honouring double/single-quoted values (which may contain ';'). */
export function parseKeyValueConnectionString(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < input.length) {
    while (input[i] === ';' || input[i] === ' ') i++;
    const eq = input.indexOf('=', i);
    if (eq < 0) break;
    const key = input.slice(i, eq).trim().toLowerCase();
    i = eq + 1;
    let value = '';
    const q = input[i];
    if (q === '"' || q === "'") {
      i++;
      while (i < input.length) {
        if (input[i] === q && input[i + 1] === q) {
          value += q;
          i += 2;
        } else if (input[i] === q) {
          i++;
          break;
        } else value += input[i++];
      }
      while (i < input.length && input[i] !== ';') i++;
    } else {
      const end = input.indexOf(';', i);
      value = (end < 0 ? input.slice(i) : input.slice(i, end)).trim();
      i = end < 0 ? input.length : end;
    }
    if (key) out[key] = value;
  }
  return out;
}

/** ADO.NET / libpq key-value string → postgres:// URL (TLS required, as Azure enforces). */
export function adoToPostgresUrl(input: string): string {
  const kv = parseKeyValueConnectionString(input);
  const host = kv.server ?? kv.host ?? kv['data source'];
  const database = kv.database ?? kv['initial catalog'] ?? kv.dbname ?? 'postgres';
  const user = kv['user id'] ?? kv.userid ?? kv.username ?? kv.user ?? kv.uid;
  const password = kv.password ?? kv.pwd ?? '';
  const port = kv.port ?? '5432';
  const sslRaw = (kv['ssl mode'] ?? kv.sslmode ?? 'require').toLowerCase();
  const sslmode = sslRaw === 'disable' ? 'disable' : sslRaw.includes('verify') ? sslRaw.replace(/\s/g, '-') : 'require';
  if (!host || !user) throw new Error('Azure PostgreSQL connection string is missing Server or User Id');
  const enc = encodeURIComponent;
  return `postgres://${enc(user)}:${enc(password)}@${host}:${port}/${enc(database)}?sslmode=${sslmode}`;
}

/** The database URL to use, or undefined for stateless mode. Never logs the value. */
export function resolveDatabaseUrl(env: Env = process.env): string | undefined {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  for (const name of AZURE_CONNECTION_STRING_VARS) {
    const value = env[name]?.trim();
    if (!value) continue;
    return /^postgres(ql)?:\/\//i.test(value) ? value : adoToPostgresUrl(value);
  }
  return undefined;
}
