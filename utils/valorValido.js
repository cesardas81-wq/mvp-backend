// ============================================
// Utilitário: validação de valor monetário
// ============================================
// Number(undefined) e Number(null) retornam NaN, e "NaN <= 0" é false em
// JavaScript — ou seja, um valor ausente passaria despercebido por uma
// checagem ingênua como `Number(x) <= 0`. Esta função valida de forma
// explícita que o valor é um número finito e positivo.
function valorValido(v) {
  const num = typeof v === "string" ? Number(v) : v;
  return typeof num === "number" && Number.isFinite(num) && num > 0;
}

module.exports = valorValido;
