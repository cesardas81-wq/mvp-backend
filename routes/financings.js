// ============================================
// Rotas: financiamentos e parcelas (básico — v1)
// ============================================
const express = require("express");
const router = express.Router();
const db = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const valorValido = require("../utils/valorValido");
const isValidUUID = require("../utils/isValidUUID");

// POST /financings — cadastra um financiamento e já gera todas as parcelas
// Tudo dentro de uma transação atômica: se qualquer parcela falhar ao ser
// criada, o financiamento inteiro é revertido, evitando registros parciais.
router.post("/", asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { name, total_installments, installment_value, start_date } = req.body;

  if (typeof name !== "string" || !name.trim() || !start_date) {
    return res.status(400).json({ erro: "Nome e data de início são obrigatórios." });
  }
  const parcelas = parseInt(total_installments, 10);
  if (!Number.isInteger(parcelas) || parcelas <= 0 || parcelas > 600) {
    return res.status(400).json({ erro: "Número de parcelas inválido." });
  }
  if (!valorValido(installment_value)) {
    return res.status(400).json({ erro: "O valor da parcela precisa ser maior que zero." });
  }
  if (isNaN(new Date(start_date).getTime())) {
    return res.status(400).json({ erro: "Data de início inválida." });
  }

  const financingId = await db.transaction(async (client) => {
    const financing = await client.query(
      `INSERT INTO financings (user_id, name, total_installments, installment_value, start_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, name, parcelas, installment_value, start_date]
    );
    const id = financing.rows[0].id;

    for (let i = 1; i <= parcelas; i++) {
      const dueDate = new Date(start_date);
      dueDate.setMonth(dueDate.getMonth() + (i - 1));
      await client.query(
        `INSERT INTO installments (financing_id, number, due_date) VALUES ($1, $2, $3)`,
        [id, i, dueDate]
      );
    }

    return id;
  });

  res.json({ sucesso: true, financing_id: financingId });
}));

router.get("/", asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT f.*, COUNT(i.id) FILTER (WHERE i.paid) AS parcelas_pagas
     FROM financings f
     LEFT JOIN installments i ON i.financing_id = f.id
     WHERE f.user_id = $1
     GROUP BY f.id`,
    [req.user.id]
  );
  res.json(result.rows);
}));

// GET /financings/proximos-vencimentos — usado na janela do Painel
router.get("/proximos-vencimentos", asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT f.name, i.number, i.due_date, f.installment_value
     FROM installments i
     JOIN financings f ON f.id = i.financing_id
     WHERE f.user_id = $1 AND i.paid = false AND i.due_date <= CURRENT_DATE + INTERVAL '30 days'
     ORDER BY i.due_date ASC`,
    [req.user.id]
  );
  res.json(result.rows);
}));

// PATCH /financings/installments/:id/pagar — marca uma parcela como paga
router.patch("/installments/:id/pagar", asyncHandler(async (req, res) => {
  if (!isValidUUID(req.params.id)) {
    return res.status(400).json({ erro: "Identificador inválido." });
  }

  // Só marca como paga se a parcela pertencer a um financiamento deste usuário
  const result = await db.query(
    `UPDATE installments SET paid = true, paid_at = now()
     WHERE id = $1
       AND financing_id IN (SELECT id FROM financings WHERE user_id = $2)`,
    [req.params.id, req.user.id]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ erro: "Parcela não encontrada." });
  }
  res.json({ sucesso: true });
}));

module.exports = router;
