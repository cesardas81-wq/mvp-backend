// ============================================
// Utilitário: captura erros de rotas assíncronas
// ============================================
// Em Express 4, uma Promise rejeitada dentro de um handler async NÃO é
// capturada automaticamente — e desde o Node 15, isso derruba o processo
// inteiro (unhandled promise rejection). Esse wrapper garante que qualquer
// erro (ex: falha de conexão com o banco) seja encaminhado para o
// middleware de erro global, em vez de crashar o servidor para todos os
// usuários por causa de uma única requisição com problema.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
