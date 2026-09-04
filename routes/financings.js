// ============================================
// Rotas: financiamentos e parcelas (v1 + cálculo automático de parcela atual)
// ============================================
const express = require("express");
const router = express.Router();
const db = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const valorValido = require("../utils/valorValido");
const isValidUUID = require("../utils/isValidUUID");

function ultimoDiaDoMes(ano, mesIndex) {
  return new Date(ano, mesIndex + 1, 0).getDate();
}

/**
 * Calcula a data de vencimento de cada parcela. Regra: a 1ª parcela vence
 * sempre no MÊS SEGUINTE ao início do contrato, no dia escolhido (due_day).
 * As demais seguem, uma por mês, a partir daí. Se o dia escolhido não
 * existir num mês (ex: dia 31 em fevereiro), usa o último dia daquele mês.
 */
function calcularVencimentos(startDate, dueDay, totalInstallments) {
  const inicio = new Date(startDate);
  const anoBase = inicio.getFullYear();
  const mesBase = inicio.getMonth() + 1; // mês seguinte ao início (0-indexado)

  const vencimentos = [];
  for (let i = 0; i < totalInstallments; i++) {
    const anoAlvo = anoBase + Math.floor((mesBase + i) / 12);
    const mesAlvo = (mesBase + i) % 12;
    const dia = Math.min(dueDay, ultimoDiaDoMes(anoAlvo, mesAlvo));
    vencimentos.push(new Date(anoAlvo, mesAlvo, dia));
  }
  return vencimentos;
}

/** Conta quantas parcelas já teriam vencido até o mês atual (inclusive). */
function calcularParcelaAtual(vencimentos) {
  const hoje = new Date();
  const hojeAnoMes = hoje.getFullYear() * 12 + hoje.getMonth();
  let atual = 0;
  for (const v of vencimentos) {
    const vAnoMes = v.getFullYear() * 12 + v.getMonth();
    if (vAnoMes <= hojeAnoMes) atual++;
    else break;
  }
  return Math.max(1, Math.min(atual || 1, vencimentos.length));
}

function validarDadosFinanciamento(body) {
  const { name, total_installments, installment_value, start_date, due_day } = body;

  if (typeof name !== "string" || !name.trim()) {
    return { erro: "Nome é obrigatório." };
  }
  const parcelas = parseInt(total_installments, 10);
  if (!Number.isInteger(parcelas) || parcelas <= 0 || parcelas > 600) {
    return { erro: "Número de parcelas inválido." };
  }
  if (!valorValido(installment_value)) {
    return { erro: "O valor da parcela precisa ser maior que zero." };
  }
  if (!start_date || isNaN(new Date(start_date).getTime())) {
    return { erro: "Data de início do contrato inválida." };
  }
  const dia = parseInt(due_day, 10);
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
    return { erro: "Dia de vencimento inválido (use um número de 1 a 31)." };
  }

  return { dados: { name: name.trim(), parcelas, installment_value, start_date, dia } };
}

// POST /financings — cadastra um financiamento e já gera todas as parcelas
router.post("/", asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { erro, dados } = validarDadosFinanciamento(req.body);
  if (erro) return res.status(400).json({ erro });

  const vencimentos = calcularVencimentos(dados.start_date, dados.dia, dados.parcelas);

  const financingId = await db.transaction(async (client) => {
    const financing = await client.query(
      `INSERT INTO financings (user_id, name, total_installments, installment_value, start_date, due_day)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [userId, dados.name, dados.parcelas, dados.installment_value, dados.start_date, dados.dia]
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

// GET /financings — lista com a parcela atual já calculada automaticamente
router.get("/", asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT * FROM financings WHERE user_id = $1 ORDER BY created_at DESC`,
    [req.user.id]
  );

  const financiamentos = result.rows.map((f) => {
    const vencimentos = calcularVencimentos(f.start_date, f.due_day, f.total_installments);
    return { ...f, parcela_atual: calcularParcelaAtual(vencimentos) };
  });

  res.json(financiamentos);
}));

// PATCH /financings/:id — edita um financiamento; se algo que afeta as datas
// mudar (parcelas, dia de vencimento ou início), as parcelas são recriadas
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

  const { erro, dados } = validarDadosFinanciamento({ ...existente.rows[0], ...req.body });
  if (erro) return res.status(400).json({ erro });

  const antes = existente.rows[0];
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
