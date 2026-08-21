import { Pool, QueryResult } from 'pg';

const isProduction =
  process.env.NODE_ENV === 'production' ||
  (!!process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost'));

if (isProduction && !process.env.DATABASE_URL && !process.env.DB_PASS) {
  throw new Error('DB_PASS (o DATABASE_URL) no configurado. Revisa las variables de entorno en producción.');
}

const sslConfig = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined;

const config = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      max: 10,
      ...(sslConfig ? { ssl: sslConfig } : {}),
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER || 'communicator',
      password: process.env.DB_PASS || '',
      database: process.env.DB_NAME || 'communicator_db',
      max: 10,
      ...(sslConfig ? { ssl: sslConfig } : {}),
    };

const rawPool = new Pool(config as any);

// Traduce los placeholders `?` de MySQL a `$1, $2, ...` de PostgreSQL.
function toPgParams(sql: string): { text: string; count: number } {
  let i = 0;
  const text = sql.replace(/\?/g, () => `$${++i}`);
  return { text, count: i };
}

function assertParamCount(sql: string, count: number, params?: any[]): void {
  if (params && params.length !== count) {
    throw new Error(`Placeholder mismatch: la query tiene ${count} '?' pero se pasaron ${params.length} params`);
  }
}

// Compat con mysql2: SELECT → [rows, meta]; INSERT/UPDATE/DELETE → [header, null]
// donde header expone insertId/affectedRows como el ResultSetHeader de mysql2.
function buildResult(result: QueryResult): [any, any] {
  const rowCount = result.rowCount ?? 0;
  if (result.command === 'SELECT' || result.command === 'SHOW' || result.command === 'EXPLAIN') {
    return [result.rows, { affectedRows: rowCount, rowCount }];
  }
  const insertId = result.rows.length ? (result.rows[0] as any)?.id ?? null : null;
  return [{ affectedRows: rowCount, rowCount, insertId }, null];
}

async function runQuery(clientOrPool: { query(text: string, values?: any[]): Promise<QueryResult> }, text: string, params?: any[]) {
  const { text: pgText, count } = toPgParams(text);
  assertParamCount(text, count, params);
  const result = await clientOrPool.query({ text: pgText, values: params || [] } as any);
  return buildResult(result);
}

const pool = {
  async query(text: string, params?: any[]) {
    return runQuery(rawPool, text, params);
  },
  async getConnection() {
    const client = await rawPool.connect();
    return {
      query: (text: string, params?: any[]) => runQuery(client, text, params),
      beginTransaction: () => client.query('BEGIN'),
      commit: () => client.query('COMMIT'),
      rollback: () => client.query('ROLLBACK'),
      release: () => client.release(),
    };
  },
};

export default pool;
