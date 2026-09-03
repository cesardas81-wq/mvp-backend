// ============================================
// Serviço: resolução de categoria (cria se não existir, de forma atômica)
// ============================================
const db = require("../db");

/**
 * Garante que a categoria exista para o usuário (ou como categoria padrão do
 * sistema) e devolve o id dela. Usa INSERT ... ON CONFLICT DO NOTHING, que é
 * atômico no banco — evita duplicatas mesmo com duas chamadas simultâneas
 * tentando criar a mesma categoria ao mesmo tempo (ex: dois registros de voz
 * muito próximos), diferente de um "verificar e depois inserir" manual.
 * @param {string} userId
 * @param {string} nomeCategoria
 * @returns {Promise<string>} id da categoria
 */
async function resolverCategoria(userId, nomeCategoria) {
  const nome = nomeCategoria.trim();

  // Só insere se realmente não existir NENHUMA categoria com esse nome — nem
  // específica do usuário, nem padrão do sistema (ex: "Alimentação" já vem
  // pré-carregada; sem essa checagem, cada usuário acabaria com uma cópia
  // duplicada dela assim que a IA a reconhecesse pela primeira vez).
  // O ON CONFLICT DO NOTHING continua garantindo segurança em caso de duas
  // chamadas simultâneas passarem pela checagem NOT EXISTS ao mesmo tempo.
  await db.query(
    `INSERT INTO categories (user_id, name, created_by_ai)
     SELECT $1, $2, true
     WHERE NOT EXISTS (
       SELECT 1 FROM categories
       WHERE LOWER(name) = LOWER($2) AND (user_id = $1 OR user_id IS NULL)
     )
     ON CONFLICT DO NOTHING`,
    [userId, nome]
  );

  // Busca o id de qualquer forma — seja a que acabou de ser criada, seja uma
  // já existente (do usuário tem prioridade sobre a padrão do sistema, caso
  // exista uma categoria com o mesmo nome nos dois escopos)
  const result = await db.query(
    `SELECT id FROM categories
     WHERE LOWER(name) = LOWER($1) AND (user_id = $2 OR user_id IS NULL)
     ORDER BY user_id NULLS LAST
     LIMIT 1`,
    [nome, userId]
  );

  return result.rows[0].id;
}

module.exports = { resolverCategoria };
