// ============================================
// Rotas: transações manuais, listagem, edição e correção
// ============================================
const express = require("express");
const router = express.Router();
const db = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const valorValido = require("../utils/valorValido");
const isValidUUID = require("../utils/isValidUUID");

// Confere que a categoria informada pertence a este usuário ou é uma categoria
// padrão do sistema (user_id NULL) — evita que um usuário associe seu lançamento
// à categoria privada de outra pessoa
async function categoriaValida(categoryId, userId) {
  if (!categoryId) return true; // categoria é opcional
  if (!isValidUUID(categoryId)) return false;
  const result = await db.query(
    "SELECT id FROM categories WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)",
    [categoryId, userId]
  );
  return !!result.rows[0];
}

// POST /transactions — lançamento manual
router.post("/", asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { account_id, category_id, description, amount, type, transaction_date } = req.body;

  if (
    !isValidUUID(account_id) ||
    typeof description !== "string" ||
    !description.trim() ||
    !valorValido(amount) ||
    !["entrada", "saida"].includes(type)
  ) {
    return res.status(400).json({ erro: "Dados obrigatórios ausentes ou inválidos." });
  }
  if (transaction_date !== undefined && isNaN(new Date(transaction_date).getTime())) {
    return res.status(400).json({ erro: "Data da transação inválida." });
  }

  // Confere que a conta informada realmente pertence a este usuário, antes de gravar
  const conta = await db.query("SELECT id FROM accounts WHERE id = $1 AND user_id = $2", [
    account_id,
    userId,
  ]);
  if (!conta.rows[0]) {
    return res.status(403).json({ erro: "Conta inválida para este usuário." });
  }

  if (!(await categoriaValida(category_id, userId))) {
    return res.status(403).json({ erro: "Categoria inválida para este usuário." });
  }

  const result = await db.query(
    `INSERT INTO transactions
      (user_id, account_id, category_id, description, amount, type, source, transaction_date)
     VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7) RETURNING id`,
    [userId, account_id, category_id || null, description, amount, type, transaction_date || new Date()]
  );

  res.json({ sucesso: true, transaction_id: result.rows[0].id });
}));

// GET /transactions — últimas movimentações (usado no Painel)
router.get("/", asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100); // trava um teto sensato

  const result = await db.query(
    `SELECT t.id, t.description, t.amount, t.type, t.source, t.transaction_date, c.name AS category
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.user_id = $1
     ORDER BY t.transaction_date DESC, t.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  res.json(result.rows);
}));

// GET /transactions/resumo-categorias — para o gráfico de rosca do Painel
router.get("/resumo-categorias", asyncHandler(async (req, res) => {
  const userId = req.user.id;

  // LEFT JOIN (não INNER) — um lançamento sem categoria não pode sumir do
  // resumo silenciosamente, senão o total do gráfico de rosca fica menor
  // que o total real de gastos do mês, sem nenhum aviso disso ao usuário
  const result = await db.query(
    `SELECT COALESCE(c.name, 'Sem categoria') AS category, SUM(t.amount) AS total
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.user_id = $1 AND t.type = 'saida'
       AND date_trunc('month', t.transaction_date) = date_trunc('month', CURRENT_DATE)
     GROUP BY COALESCE(c.name, 'Sem categoria')
     ORDER BY total DESC`,
    [userId]
  );

  res.json(result.rows);
}));

// GET /transactions/:id — busca um lançamento específico (usado na edição)
router.get("/:id", asyncHandler(async (req, res) => {
  if (!isValidUUID(req.params.id)) {
    return res.status(400).json({ erro: "Identificador inválido." });
  }
  const result = await db.query(
    `SELECT id, description, amount, type, transaction_date FROM transactions WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (!result.rows[0]) {
    return res.status(404).json({ erro: "Lançamento não encontrado." });
  }
  res.json(result.rows[0]);
}));

// PATCH /transactions/:id — edição manual (corrige tipo, valor, descrição ou data)
// Toda correção é registrada em correction_history para alimentar o aprendizado da IA
router.patch("/:id", asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const { category_id, amount, description, type, transaction_date } = req.body;

  if (!isValidUUID(id)) {
    return res.status(400).json({ erro: "Identificador inválido." });
  }

  // Busca já filtrando pelo dono — impede que um usuário edite lançamento de outro
  const original = await db.query(
    `SELECT description, amount, category_id, source, type, transaction_date FROM transactions WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  const antes = original.rows[0];

  if (!antes) {
    return res.status(404).json({ erro: "Lançamento não encontrado." });
  }
  if (amount !== undefined && !valorValido(amount)) {
    return res.status(400).json({ erro: "O valor precisa ser maior que zero." });
  }
  if (description !== undefined && (typeof description !== "string" || description.trim() === "")) {
    return res.status(400).json({ erro: "A descrição não pode ficar vazia." });
  }
  if (type !== undefined && !["entrada", "saida"].includes(type)) {
    return res.status(400).json({ erro: "Tipo inválido." });
  }
  if (transaction_date !== undefined && isNaN(new Date(transaction_date).getTime())) {
    return res.status(400).json({ erro: "Data inválida." });
  }
  if (category_id && !(await categoriaValida(category_id, userId))) {
    return res.status(403).json({ erro: "Categoria inválida para este usuário." });
  }

  await db.query(
    `UPDATE transactions SET
       category_id = COALESCE($1, category_id),
       amount = COALESCE($2, amount),
       description = COALESCE($3, description),
       type = COALESCE($4, type),
       transaction_date = COALESCE($5, transaction_date)
     WHERE id = $6 AND user_id = $7`,
    [category_id, amount, description, type, transaction_date, id, userId]
  );

  // Registra a correção no histórico apenas para lançamentos originados por voz —
  // é isso que usamos para medir a taxa de acerto da IA; correções em lançamentos
  // manuais não dizem nada sobre a qualidade da IA, então não entram nessa métrica
  if (antes.source === "voz") {
    if (category_id && category_id !== antes.category_id) {
      await db.query(
        `INSERT INTO correction_history (transaction_id, field_corrected, original_value, corrected_value)
         VALUES ($1, 'categoria', $2, $3)`,
        [id, antes.category_id, category_id]
      );
    }
    if (amount && Number(amount) !== Number(antes.amount)) {
      await db.query(
        `INSERT INTO correction_history (transaction_id, field_corrected, original_value, corrected_value)
         VALUES ($1, 'valor', $2, $3)`,
        [id, antes.amount, amount]
      );
    }
    if (description && description !== antes.description) {
      await db.query(
        `INSERT INTO correction_history (transaction_id, field_corrected, original_value, corrected_value)
         VALUES ($1, 'descricao', $2, $3)`,
        [id, antes.description, description]
      );
    }
  }

  res.json({ sucesso: true });
}));

// DELETE /transactions/:id
router.delete("/:id", asyncHandler(async (req, res) => {
  if (!isValidUUID(req.params.id)) {
    return res.status(400).json({ erro: "Identificador inválido." });
  }

  const result = await db.query(`DELETE FROM transactions WHERE id = $1 AND user_id = $2`, [
    req.params.id,
    req.user.id,
  ]);
  if (result.rowCount === 0) {
    return res.status(404).json({ erro: "Lançamento não encontrado." });
  }
  res.json({ sucesso: true });
}));

module.exports = router;
