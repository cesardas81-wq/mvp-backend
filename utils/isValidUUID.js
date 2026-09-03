// ============================================
// Utilitário: validação de formato UUID
// ============================================
// Sem essa checagem, um id malformado (ex: "abc") só é rejeitado lá no
// banco, com um erro de tipo feio que vira 500 genérico em vez de um
// 400 claro — melhor barrar aqui antes de qualquer query.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(value) {
  return typeof value === "string" && UUID_REGEX.test(value);
}

module.exports = isValidUUID;
