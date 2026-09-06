// ============================================
// Utilitário: cálculo de datas de vencimento mensal
// Usado por Financiamentos, Parcelamentos e Despesas Recorrentes
// ============================================

function ultimoDiaDoMes(ano, mesIndex) {
  return new Date(ano, mesIndex + 1, 0).getDate();
}

/**
 * Calcula a data de vencimento de cada ocorrência. Regra: a 1ª ocorrência
 * vence sempre no MÊS SEGUINTE à data de início, no dia escolhido (dueDay).
 * As demais seguem, uma por mês, a partir daí.
 * @param {string|Date} startDate
 * @param {number} dueDay
 * @param {number} quantidade - quantas datas gerar
 * @returns {Date[]}
 */
function calcularVencimentos(startDate, dueDay, quantidade) {
  const inicio = new Date(startDate);
  const anoBase = inicio.getFullYear();
  const mesBase = inicio.getMonth() + 1; // mês seguinte ao início (0-indexado)

  const vencimentos = [];
  for (let i = 0; i < quantidade; i++) {
    const anoAlvo = anoBase + Math.floor((mesBase + i) / 12);
    const mesAlvo = (mesBase + i) % 12;
    const dia = Math.min(dueDay, ultimoDiaDoMes(anoAlvo, mesAlvo));
    vencimentos.push(new Date(anoAlvo, mesAlvo, dia));
  }
  return vencimentos;
}

/** Conta quantas ocorrências já teriam vencido até o mês atual (inclusive). */
function calcularOcorrenciaAtual(vencimentos) {
  const hoje = new Date();
  const hojeAnoMes = hoje.getFullYear() * 12 + hoje.getMonth();
  let atual = 0;
  for (const v of vencimentos) {
    const vAnoMes = v.getFullYear() * 12 + v.getMonth();
    if (vAnoMes <= hojeAnoMes) atual++;
    else break;
  }
  return Math.max(1, atual || 1);
}

/**
 * Calcula o número da ocorrência atual para uma despesa recorrente
 * (indefinida, sem total) com base em quantos meses já se passaram
 * desde a 1ª ocorrência.
 */
function calcularOcorrenciaAtualIndefinida(startDate, dueDay) {
  const hoje = new Date();
  const inicio = new Date(startDate);
  const primeiraOcorrencia = calcularVencimentos(inicio, dueDay, 1)[0];
  const mesesDesdeAPrimeira =
    (hoje.getFullYear() - primeiraOcorrencia.getFullYear()) * 12 +
    (hoje.getMonth() - primeiraOcorrencia.getMonth());
  return Math.max(1, mesesDesdeAPrimeira + 1);
}

module.exports = {
  calcularVencimentos,
  calcularOcorrenciaAtual,
  calcularOcorrenciaAtualIndefinida,
};
