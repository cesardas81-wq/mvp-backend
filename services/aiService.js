// ============================================
// Serviço de IA — Transcrição (Whisper) + Interpretação (LLM)
// ============================================
const OpenAI = require("openai");

// Criação preguiçosa do cliente: se instanciássemos aqui no topo do arquivo,
// a biblioteca da OpenAI lançaria erro imediatamente na ausência da chave,
// derrubando o servidor inteiro assim que este módulo fosse carregado —
// mesmo que nenhuma rota de voz tivesse sido chamada ainda. Assim, o app
// roda normalmente sem IA configurada, e só falha (com mensagem clara) se
// alguém realmente tentar usar a rota /voice sem a chave configurada.
let client = null;
function getClient() {
  if (!process.env.OPENAI_API_KEY) {
    const err = new Error(
      "OPENAI_API_KEY não configurada. Configure-a no .env para usar o registro por voz."
    );
    err.status = 503;
    throw err;
  }
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

/**
 * Etapa 1: transcreve o áudio enviado pelo app em texto.
 * @param {Buffer} audioBuffer - arquivo de áudio recebido do app (via multer)
 * @param {string} filename - nome/extensão original do arquivo (ex: "audio.m4a"),
 *   necessário porque a API da OpenAI identifica o formato pela extensão
 * @returns {Promise<string>} texto transcrito
 */
async function transcreverAudio(audioBuffer, filename = "audio.m4a") {
  // multer entrega um Buffer puro — precisa ser convertido para um "arquivo"
  // com nome antes de enviar, senão a API rejeita o upload
  const arquivo = await OpenAI.toFile(audioBuffer, filename);

  const transcription = await getClient().audio.transcriptions.create({
    file: arquivo,
    model: "whisper-1",
    language: "pt",
  });
  return transcription.text;
}

/**
 * Etapa 2: interpreta o texto transcrito e extrai os dados estruturados
 * do lançamento financeiro (valor, tipo, descrição, categoria sugerida).
 * @param {string} texto - texto transcrito, ex: "comprei um sorvete, paguei sete e cinquenta"
 * @param {string[]} categoriasExistentes - categorias já cadastradas do usuário
 * @returns {Promise<object>} { valor, tipo, descricao, categoria, categoria_nova, confidence }
 */
async function interpretarComando(texto, categoriasExistentes) {
  const prompt = `
Você é o assistente financeiro de um app de controle de gastos por voz.
Extraia os dados do comando do usuário e responda APENAS em JSON, sem nenhum texto adicional.

Categorias já existentes do usuário: ${categoriasExistentes.join(", ")}

IMPORTANTE: antes de marcar "categoria_nova": true, verifique com atenção se o gasto já se
encaixa em alguma categoria existente (mesmo com nome ligeiramente diferente). Só crie uma
categoria nova se nenhuma existente for coerente.

Formato de resposta obrigatório:
{
  "valor": number,
  "tipo": "entrada" | "saida",
  "descricao": string (curta, ex: "Sorvete"),
  "categoria": string (uma das categorias existentes, ou uma nova sugestão coerente),
  "categoria_nova": boolean (true somente se a categoria não existia antes),
  "confidence": number (0 a 1, sua confiança na interpretação)
}

Comando do usuário: "${texto}"
`.trim();

  const response = await getClient().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    response_format: { type: "json_object" }, // força saída JSON válida, evita crash no parse
  });

  const resultado = JSON.parse(response.choices[0].message.content);

  // Blindagem: o banco exige confidence entre 0 e 1 — se a IA devolver algo
  // fora disso (ex: 95 em vez de 0.95), normaliza em vez de deixar a
  // inserção falhar lá na frente por violação de constraint
  if (typeof resultado.confidence !== "number" || !Number.isFinite(resultado.confidence)) {
    resultado.confidence = null;
  } else {
    resultado.confidence = Math.min(Math.max(resultado.confidence, 0), 1);
  }

  return resultado;
}

module.exports = { transcreverAudio, interpretarComando };
