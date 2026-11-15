import { describe, expect, it } from 'vitest';
import { adoToPostgresUrl, parseKeyValueConnectionString, resolveDatabaseUrl } from '../db/connectionString';

describe('Azure PostgreSQL connection string (spec 05 §2)', () => {
  const ado = 'Database=argus-space-database;Server=argus-space-server.postgres.database.azure.com;User Id=uixpvwsweg;Password=p@ss;w0rd=x';

  it('parses ADO.NET key-value pairs, case-insensitively', () => {
    expect(parseKeyValueConnectionString('Server=h;User Id=u;Password="a;b""c"')).toEqual({ server: 'h', 'user id': 'u', password: 'a;b"c' });
  });

  it('converts to a TLS postgres URL and encodes special characters', () => {
    expect(adoToPostgresUrl('Database=db;Server=h.example;User Id=u;Password="p@ss;w0rd"')).toBe(
      'postgres://u:p%40ss%3Bw0rd@h.example:5432/db?sslmode=require'
    );
  });

  it('prefers DATABASE_URL, then the App Service variables', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: 'pglite:memory', AZURE_POSTGRESQL_CONNECTIONSTRING: ado })).toBe('pglite:memory');
    expect(resolveDatabaseUrl({ CUSTOMCONNSTR_AZURE_POSTGRESQL_CONNECTIONSTRING: 'Server=h;User Id=u;Password=p;Database=d' })).toBe(
      'postgres://u:p@h:5432/d?sslmode=require'
    );
    expect(resolveDatabaseUrl({ AZURE_POSTGRESQL_CONNECTIONSTRING: 'postgres://x@y/z' })).toBe('postgres://x@y/z');
    expect(resolveDatabaseUrl({})).toBeUndefined();
  });

  it('rejects strings without a server or user', () => {
    expect(() => adoToPostgresUrl('Database=d;Password=p')).toThrow(/Server or User Id/);
  });
});
