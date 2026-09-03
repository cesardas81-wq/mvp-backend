// ============================================
// Rota: registro de transação por voz
// ============================================
const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer();
const { transcreverAudio, interpretarComando } = require("../services/aiService");
const { resolverCategoria } = require("../services/categoryService");
const valorValido = require("../utils/valorValido");
const isValidUUID = require("../utils/isValidUUID");
const db = require("../db");

// POST /voice/interpretar
// Recebe o áudio, transcreve, interpreta e devolve pro app SEM salvar ainda —
// o app mostra a confirmação ("você gastou R$7,50 em sorvete, confirma?")
// antes de chamar /voice/confirmar
router.post("/interpretar", upload.single("audio"), async (req, res) => {
  try {
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({ erro: "Nenhum áudio enviado." });
    }

    const texto = await transcreverAudio(req.file.buffer, req.file.originalname);

    const categoriasExistentes = await db.query(
      "SELECT name FROM categories WHERE user_id = $1 OR user_id IS NULL",
      [userId]
    );

    const resultado = await interpretarComando(
      texto,
      categoriasExistentes.rows.map((c) => c.name)
    );

    // Devolve o rascunho pro app confirmar com o usuário antes de gravar
    res.json({ texto_transcrito: texto, ...resultado });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Não consegui entender o áudio. Tente novamente." });
  }
});

// POST /voice/confirmar
// Chamado depois que o usuário confirma o que a IA entendeu — só aqui salva de fato
router.post("/confirmar", async (req, res) => {
  try {
    const userId = req.user.id;
    const { valor, tipo, descricao, categoria, confidence, account_id } = req.body;

    if (
      !isValidUUID(account_id) ||
      typeof descricao !== "string" ||
      !descricao.trim() ||
      typeof categoria !== "string" ||
      !categoria.trim() ||
      !["entrada", "saida"].includes(tipo)
    ) {
      return res.status(400).json({ erro: "Dados obrigatórios ausentes ou inválidos." });
    }
    if (!valorValido(valor)) {
      return res.status(400).json({ erro: "O valor precisa ser maior que zero." });
    }

    // Confere que a conta informada realmente pertence a este usuário
    const conta = await db.query("SELECT id FROM accounts WHERE id = $1 AND user_id = $2", [
      account_id,
      userId,
    ]);
    if (!conta.rows[0]) {
      return res.status(403).json({ erro: "Conta inválida para este usuário." });
    }

    const categoryId = await resolverCategoria(userId, categoria);

    const transacao = await db.query(
      `INSERT INTO transactions
        (user_id, account_id, category_id, description, amount, type, source, ai_confidence)
       VALUES ($1, $2, $3, $4, $5, $6, 'voz', $7) RETURNING id`,
      [userId, account_id, categoryId, descricao, valor, tipo, confidence]
    );

    res.json({ sucesso: true, transaction_id: transacao.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Não consegui salvar o lançamento." });
  }
});

module.exports = router;
