// ============================================
// Conexão com o banco de dados (Postgres)
// ============================================
const { Pool } = require("pg");

// Supabase, Neon e a maioria dos provedores de Postgres em nuvem exigem SSL
// sempre, independente de NODE_ENV — só desativamos para um Postgres rodando
// em localhost (desenvolvimento 100% local, sem provedor externo)
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

/**
 * Executa uma sequência de operações dentro de uma transação atômica —
 * se qualquer passo falhar, tudo é revertido (ex: criar um financiamento
 * e suas parcelas precisa ser tudo ou nada, nunca parcial).
 * @param {(client: import('pg').PoolClient) => Promise<any>} callback
 */
async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await callback(client);
    await client.query("COMMIT");
    return resultado;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  transaction,
};
