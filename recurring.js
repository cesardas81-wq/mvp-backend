// ============================================
// Rotas: despesas recorrentes (ex: pensão, Netflix, academia)
// ============================================
const express = require("express");
const router = express.Router();
const db = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const valorValido = require("../utils/valorValido");
const isValidUUID = require("../utils/isValidUUID");
const {
  calcularVencimentos,
  calcularOcorrenciaAtualIndefinida,
} = require("../services/dateService");

function validarDados(body) {
  const { description, amount, due_day, start_date } = body;

  if (typeof description !== "string" || !description.trim()) {
    return { erro: "Descrição é obrigatória." };
  }
  if (!valorValido(amount)) {
    return { erro: "O valor precisa ser maior que zero." };
  }
  const dia = parseInt(due_day, 10);
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
    return { erro: "Dia de vencimento inválido (use um número de 1 a 31)." };
  }
  if (!start_date || isNaN(new Date(start_date).getTime())) {
    return { erro: "Data de início inválida." };
  }

  return { dados: { description: description.trim(), amount, dia, start_date } };
}

// POST /recurring
router.post("/", asyncHandler(async (req, res) => {
  const { erro, dados } = validarDados(req.body);
  if (erro) return res.status(400).json({ erro });

  const result = await db.query(
    `INSERT INTO recurring_expenses (user_id, description, amount, due_day, start_date)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [req.user.id, dados.description, dados.amount, dados.dia, dados.start_date]
  );

  res.json({ sucesso: true, id: result.rows[0].id });
}));

// GET /recurring — lista com a ocorrência atual calculada (mês corrente)
router.get("/", asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT * FROM recurring_expenses WHERE user_id = $1 AND active = true ORDER BY created_at DESC`,
    [req.user.id]
  );

  const lista = result.rows.map((r) => ({
    ...r,
    ocorrencia_atual: calcularOcorrenciaAtualIndefinida(r.start_date, r.due_day),
  }));

  res.json(lista);
}));

// GET /recurring/:id/ocorrencias — janela de 7 (3 passadas, atual, 3 futuras)
router.get("/:id/ocorrencias", asyncHandler(async (req, res) => {
  if (!isValidUUID(req.params.id)) {
    return res.status(400).json({ erro: "Identificador inválido." });
  }
  const existente = await db.query(
    `SELECT * FROM recurring_expenses WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (!existente.rows[0]) {
    return res.status(404).json({ erro: "Não encontrado." });
  }
  const r = existente.rows[0];
  const atual = calcularOcorrenciaAtualIndefinida(r.start_date, r.due_day);

  // Gera até (atual + 3) datas — o suficiente para pegar as 3 futuras também
  const vencimentos = calcularVencimentos(r.start_date, r.due_day, atual + 3);
  const inicio = Math.max(0, atual - 4);
  const janela = vencimentos.slice(inicio).map((data, i) => ({
    numero: inicio + i + 1,
    data,
    status: inicio + i + 1 < atual ? "paga" : inicio + i + 1 === atual ? "atual" : "futura",
  }));

  res.json({ nome: r.description, valor: r.amount, parcelas: janela });
}));

// PATCH /recurring/:id
router.patch("/:id", asyncHandler(async (req, res) => {
  if (!isValidUUID(req.params.id)) {
    return res.status(400).json({ erro: "Identificador inválido." });
  }
  const existente = await db.query(
    `SELECT * FROM recurring_expenses WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (!existente.rows[0]) {
    return res.status(404).json({ erro: "Não encontrado." });
  }

  const { erro, dados } = validarDados({ ...existente.rows[0], ...req.body });
  if (erro) return res.status(400).json({ erro });

  await db.query(
    `UPDATE recurring_expenses SET description = $1, amount = $2, due_day = $3, start_date = $4 WHERE id = $5`,
    [dados.description, dados.amount, dados.dia, dados.start_date, req.params.id]
  );

  res.json({ sucesso: true });
}));

// DELETE /recurring/:id
router.delete("/:id", asyncHandler(async (req, res) => {
  if (!isValidUUID(req.params.id)) {
    return res.status(400).json({ erro: "Identificador inválido." });
  }
  const result = await db.query(
    `DELETE FROM recurring_expenses WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ erro: "Não encontrado." });
  }
  res.json({ sucesso: true });
}));

module.exports = router;
