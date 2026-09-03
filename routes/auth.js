// ============================================
// Rotas: cadastro e login (e-mail/senha — v1)
// ============================================
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../db");
const asyncHandler = require("../utils/asyncHandler");

router.post("/cadastro", asyncHandler(async (req, res) => {
  const { email, senha } = req.body;

  if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ erro: "E-mail inválido." });
  }
  if (typeof senha !== "string" || senha.length < 8) {
    return res.status(400).json({ erro: "A senha precisa ter pelo menos 8 caracteres." });
  }

  try {
    const hash = await bcrypt.hash(senha, 10);

    // Cria o usuário e a conta principal na mesma transação — se a criação da
    // conta falhar, o cadastro do usuário também é revertido, evitando um
    // usuário "incompleto" (cadastrado, mas sem nenhuma conta para usar o app)
    const userId = await db.transaction(async (client) => {
      const usuario = await client.query(
        "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
        [email.toLowerCase(), hash]
      );
      await client.query(
        "INSERT INTO accounts (user_id, name, is_default) VALUES ($1, 'Conta Principal', true)",
        [usuario.rows[0].id]
      );
      return usuario.rows[0].id;
    });

    const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "30d" });
    res.json({ token });
  } catch (err) {
    if (err.code === "23505") {
      // violação da constraint UNIQUE(email)
      return res.status(409).json({ erro: "Este e-mail já está cadastrado." });
    }
    throw err; // outros erros seguem para o middleware de erro global
  }
}));

router.post("/login", asyncHandler(async (req, res) => {
  const { email, senha } = req.body;

  if (typeof email !== "string" || typeof senha !== "string" || !email || !senha) {
    return res.status(400).json({ erro: "E-mail e senha são obrigatórios." });
  }

  const usuario = await db.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);

  if (!usuario.rows[0] || !(await bcrypt.compare(senha, usuario.rows[0].password_hash))) {
    return res.status(401).json({ erro: "E-mail ou senha inválidos" });
  }

  const token = jwt.sign({ id: usuario.rows[0].id }, process.env.JWT_SECRET, { expiresIn: "30d" });
  res.json({ token });
}));

module.exports = router;
