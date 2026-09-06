// ============================================
// Rotas: financiamentos e parcelamentos (mesma estrutura, tipos distintos)
// ============================================
const express = require("express");
const router = express.Router();
const db = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const valorValido = require("../utils/valorValido");
const isValidUUID = require("../utils/isValidUUID");
const { calcularVencimentos, calcularOcorrenciaAtual } = require("../services/dateService");

function validarDados(body) {
  const { name, tipo, total_installments, installment_value, start_date, due_day } = body;

  if (typeof name !== "string" || !name.trim()) {
    return { erro: "Nome é obrigatório." };
  }
  if (!["financiamento", "parcelamento"].includes(tipo)) {
    return { erro: "Tipo precisa ser 'financiamento' ou 'parcelamento'." };
  }
  const parcelas = parseInt(total_installments, 10);
  if (!Number.isInteger(parcelas) || parcelas <= 0 || parcelas > 600) {
    return { erro: "Número de parcelas inválido." };
  }
  if (!valorValido(installment_value)) {
    return { erro: "O valor da parcela precisa ser maior que zero." };
  }
  // Financiamento exige "início de contrato" informado; Parcelamento usa hoje
  const dataBase = tipo === "parcelamento" ? new Date().toISOString().slice(0, 10) : start_date;
  if (!dataBase || isNaN(new Date(dataBase).getTime())) {
    return { erro: "Data de início do contrato inválida." };
  }
  const dia = parseInt(due_day, 10);
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
    return { erro: "Dia de vencimento inválido (use um número de 1 a 31)." };
  }

  return { dados: { name: name.trim(), tipo, parcelas, installment_value, start_date: dataBase, dia } };
}

// POST /financings — cadastra um financiamento/parcelamento e gera as parcelas
router.post("/", asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { erro, dados } = validarDados(req.body);
  if (erro) return res.status(400).json({ erro });

  const vencimentos = calcularVencimentos(dados.start_date, dados.dia, dados.parcelas);

  const financingId = await db.transaction(async (client) => {
    const financing = await client.query(
      `INSERT INTO financings (user_id, name, tipo, total_installments, installment_value, start_date, due_day)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [userId, dados.name, dados.tipo, dados.parcelas, dados.installment_value, dados.start_date, dados.dia]
    );
    const id = financing.rows[0].id;

    for (let i = 0; i < vencimentos.length; i++) {
      await client.query(
        `INSERT INTO installments (financing_id, number, due_date) VALUES ($1, $2, $3)`,
        [id, i + 1, vencimentos[i]]
      );
    }

    return id;
  });

  res.json({ sucesso: true, financing_id: financingId });
}));

// GET /financings?tipo=financiamento|parcelamento — lista com parcela atual calculada
router.get("/", asyncHandler(async (req, res) => {
  const { tipo } = req.query;
  const params = [req.user.id];
  let query = `SELECT * FROM financings WHERE user_id = $1`;
  if (tipo && ["financiamento", "parcelamento"].includes(tipo)) {
    query += ` AND tipo = $2`;
    params.push(tipo);
  }
  query += ` ORDER BY created_at DESC`;

  const result = await db.query(query, params);

  const lista = result.rows.map((f) => {
    const vencimentos = calcularVencimentos(f.start_date, f.due_day, f.total_installments);
    return { ...f, parcela_atual: calcularOcorrenciaAtual(vencimentos) };
  });

  res.json(lista);
}));

// GET /financings/:id/parcelas — as 7 datas em destaque (3 passadas, atual, 3 futuras)
// usadas no carrossel da aba Compromissos
router.get("/:id/parcelas", asyncHandler(async (req, res) => {
  if (!isValidUUID(req.params.id)) {
    return res.status(400).json({ erro: "Identificador inválido." });
  }
  const existente = await db.query(`SELECT * FROM financings WHERE id = $1 AND user_id = $2`, [
    req.params.id,
    req.user.id,
  ]);
  if (!existente.rows[0]) {
    return res.status(404).json({ erro: "Não encontrado." });
  }
  const f = existente.rows[0];
  const vencimentos = calcularVencimentos(f.start_date, f.due_day, f.total_installments);
  const atual = calcularOcorrenciaAtual(vencimentos);

  const inicio = Math.max(0, atual - 4); // índice 0-based: 3 antes da atual
  const fim = Math.min(vencimentos.length, atual + 3); // 3 depois da atual
  const janela = vencimentos.slice(inicio, fim).map((data, i) => ({
    numero: inicio + i + 1,
    data,
    status: inicio + i + 1 < atual ? "paga" : inicio + i + 1 === atual ? "atual" : "futura",
  }));

  res.json({ nome: f.name, valor: f.installment_value, total: f.total_installments, parcelas: janela });
}));

// PATCH /financings/:id — edita; recalcula parcelas se algo que afeta datas mudar
router.patch("/:id", asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  if (!isValidUUID(id)) {
    return res.status(400).json({ erro: "Identificador inválido." });
  }

  const existente = await db.query(`SELECT * FROM financings WHERE id = $1 AND user_id = $2`, [
    id,
    userId,
  ]);
  if (!existente.rows[0]) {
    return res.status(404).json({ erro: "Financiamento não encontrado." });
  }

  const antes = existente.rows[0];
  const { erro, dados } = validarDados({ ...antes, ...req.body });
  if (erro) return res.status(400).json({ erro });

  const precisaRecalcular =
    dados.parcelas !== antes.total_installments ||
    dados.dia !== antes.due_day ||
    dados.start_date !== antes.start_date;

  await db.transaction(async (client) => {
    await client.query(
      `UPDATE financings SET name = $1, total_installments = $2, installment_value = $3,
         start_date = $4, due_day = $5 WHERE id = $6`,
      [dados.name, dados.parcelas, dados.installment_value, dados.start_date, dados.dia, id]
    );

    if (precisaRecalcular) {
      await client.query(`DELETE FROM installments WHERE financing_id = $1`, [id]);
      const vencimentos = calcularVencimentos(dados.start_date, dados.dia, dados.parcelas);
      for (let i = 0; i < vencimentos.length; i++) {
        await client.query(
          `INSERT INTO installments (financing_id, number, due_date) VALUES ($1, $2, $3)`,
          [id, i + 1, vencimentos[i]]
        );
      }
    }
  });

  res.json({ sucesso: true });
}));

// DELETE /financings/:id
router.delete("/:id", asyncHandler(async (req, res) => {
  if (!isValidUUID(req.params.id)) {
    return res.status(400).json({ erro: "Identificador inválido." });
  }
  const result = await db.query(`DELETE FROM financings WHERE id = $1 AND user_id = $2`, [
    req.params.id,
    req.user.id,
  ]);
  if (result.rowCount === 0) {
    return res.status(404).json({ erro: "Financiamento não encontrado." });
  }
  res.json({ sucesso: true });
}));

// PATCH /financings/installments/:id/pagar — marca uma parcela como paga
router.patch("/installments/:id/pagar", asyncHandler(async (req, res) => {
  if (!isValidUUID(req.params.id)) {
    return res.status(400).json({ erro: "Identificador inválido." });
  }
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
