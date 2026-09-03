// ============================================
// Servidor principal — MVP v1
// ============================================
require("dotenv").config();

// Falha rápido e com mensagem clara se o .env estiver incompleto — melhor
// descobrir isso agora do que só na primeira requisição de um usuário real.
// OPENAI_API_KEY não é obrigatória para rodar o MVP sem a camada de voz/IA
// (rotas /voice simplesmente não funcionarão até essa chave existir).
const obrigatorias = ["DATABASE_URL", "JWT_SECRET"];
const faltando = obrigatorias.filter((v) => !process.env[v]);
if (faltando.length > 0) {
  console.error(`Variáveis de ambiente ausentes no .env: ${faltando.join(", ")}`);
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "Aviso: OPENAI_API_KEY não configurada — as rotas /voice não vão funcionar até você configurá-la. O resto do app funciona normalmente."
  );
}

const express = require("express");
const jwt = require("jsonwebtoken");
const app = express();

app.use(express.json());

// Rotas públicas — não exigem autenticação
app.use("/auth", require("./routes/auth"));

// Middleware de autenticação: valida o JWT enviado no header Authorization
// e injeta o id do usuário autenticado em req.user — é o que sustenta todas
// as checagens de propriedade (ex: "essa transação é mesmo deste usuário?")
// feitas nas rotas abaixo.
app.use((req, res, next) => {
  const authHeader = req.headers.authorization; // formato esperado: "Bearer <token>"
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ erro: "Token de autenticação ausente." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.id };
    next();
  } catch (err) {
    return res.status(401).json({ erro: "Token inválido ou expirado." });
  }
});

app.use("/accounts", require("./routes/accounts"));
app.use("/transactions", require("./routes/transactions"));
app.use("/financings", require("./routes/financings"));
app.use("/voice", require("./routes/voice"));

// Rota não encontrada
app.use((req, res) => {
  res.status(404).json({ erro: "Rota não encontrada." });
});

// Middleware de erro global — rede de segurança final. Captura qualquer erro
// encaminhado por asyncHandler (ou por next(err) manual) e responde de forma
// controlada, em vez de deixar o processo crashar ou a requisição travar.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erro: "Algo deu errado no servidor. Tente novamente em instantes." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API do MVP rodando na porta ${PORT}`));
