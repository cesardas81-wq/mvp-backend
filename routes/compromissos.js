// ============================================
// Rota agregadora: tudo que vence no MÊS ATUAL, juntando as 4 fontes
// (despesa à vencer, recorrente, financiamento, parcelamento)
// ============================================
const express = require("express");
const router = express.Router();
const db = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { calcularVencimentos, calcularOcorrenciaAtualIndefinida } = require("../services/dateService");

function estaNoMesAtual(data) {
  const hoje = new Date();
  const d = new Date(data);
  return d.getFullYear() === hoje.getFullYear() && d.getMonth() === hoje.getMonth();
}

// GET /compromissos/mes-atual — usado no Painel ("Próximos vencimentos")
router.get("/mes-atual", asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const itens = [];

  // 1) Despesas à vencer (transações futuras ainda não realizadas)
  const aVencer = await db.query(
    `SELECT description, amount, transaction_date FROM transactions
     WHERE user_id = $1 AND type = 'saida' AND tipo_saida = 'despesa_a_vencer'
       AND transaction_date > CURRENT_DATE`,
    [userId]
  );
  aVencer.rows
    .filter((t) => estaNoMesAtual(t.transaction_date))
    .forEach((t) =>
      itens.push({ tipo: "Despesa à vencer", nome: t.description, valor: t.amount, data: t.transaction_date })
    );

  // 2) Despesas recorrentes
  const recorrentes = await db.query(
    `SELECT description, amount, due_day, start_date FROM recurring_expenses
     WHERE user_id = $1 AND active = true`,
    [userId]
  );
  recorrentes.rows.forEach((r) => {
    const atual = calcularOcorrenciaAtualIndefinida(r.start_date, r.due_day);
    const [dataAtual] = calcularVencimentos(r.start_date, r.due_day, atual).slice(-1);
    if (estaNoMesAtual(dataAtual)) {
      itens.push({ tipo: "Recorrente", nome: r.description, valor: r.amount, data: dataAtual });
    }
  });

  // 3) Financiamentos e Parcelamentos (via parcelas geradas)
  const financiamentos = await db.query(
    `SELECT f.name, f.tipo, f.installment_value, i.due_date
     FROM installments i
     JOIN financings f ON f.id = i.financing_id
     WHERE f.user_id = $1
       AND date_trunc('month', i.due_date) = date_trunc('month', CURRENT_DATE)`,
    [userId]
  );
  financiamentos.rows.forEach((f) =>
    itens.push({
      tipo: f.tipo === "parcelamento" ? "Parcelamento" : "Financiamento",
      nome: f.name,
      valor: f.installment_value,
      data: f.due_date,
    })
  );

  itens.sort((a, b) => new Date(a.data) - new Date(b.data));
  res.json(itens);
}));

module.exports = router;
