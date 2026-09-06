// ============================================
// Rota: conta principal do usuário (v1 = apenas 1 conta)
// ============================================
const express = require("express");
const router = express.Router();
const db = require("../db");
const asyncHandler = require("../utils/asyncHandler");

router.get("/", asyncHandler(async (req, res) => {
  const result = await db.query("SELECT * FROM accounts WHERE user_id = $1", [req.user.id]);
  res.json(result.rows);
}));

// GET /accounts/saldo — saldo consolidado, usado no Painel
// Só conta transações até hoje — uma "despesa à vencer" com data futura
// fica de fora do saldo até a data realmente chegar, como combinado
router.get("/saldo", asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'entrada' THEN amount ELSE 0 END), 0) -
       COALESCE(SUM(CASE WHEN type = 'saida' THEN amount ELSE 0 END), 0) AS saldo
     FROM transactions WHERE user_id = $1 AND transaction_date <= CURRENT_DATE`,
    [req.user.id]
  );
  res.json({ saldo: result.rows[0].saldo });
}));

module.exports = router;
