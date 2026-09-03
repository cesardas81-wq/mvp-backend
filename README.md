# MVP v1 — Backend

Estrutura inicial do backend do app, cobrindo exatamente o escopo do MVP que definimos:
Painel (Presente) + Entradas/Saídas por voz e manual + Financiamentos básico.

## Estrutura

```
mvp-backend/
├── server.js              # ponto de entrada da API
├── package.json            # dependências do projeto
├── db/
│   ├── schema.sql          # estrutura do banco de dados (Postgres)
│   └── index.js            # conexão real com o Postgres (+ suporte a transações atômicas)
├── routes/
│   ├── auth.js             # cadastro/login (e-mail e senha) — rota pública
│   ├── accounts.js         # conta principal + saldo consolidado
│   ├── transactions.js     # lançamentos manuais, listagem, correção
│   ├── financings.js       # financiamentos, parcelas e baixa de pagamento
│   └── voice.js            # o coração do MVP: transcrição + interpretação + confirmação
├── services/
│   ├── aiService.js         # integração com Whisper (voz) e GPT-4o mini (interpretação)
│   └── categoryService.js   # resolução atômica de categoria (evita duplicatas e condição de corrida)
└── utils/
    ├── asyncHandler.js      # captura erros de rotas assíncronas (evita o servidor crashar)
    ├── valorValido.js       # validação consistente de valores monetários
    └── isValidUUID.js       # validação de formato UUID (evita erro 500 por id malformado)
```

## Autenticação

Depois de `POST /auth/cadastro` ou `POST /auth/login`, o app recebe um `token` (JWT,
válido por 30 dias). Todas as demais rotas exigem esse token no header:

```
Authorization: Bearer <token>
```

Sem esse header (ou com um token inválido/expirado), a API responde `401`.

## Como o fluxo de voz funciona (o que estamos testando)

1. App grava o áudio e envia para `POST /voice/interpretar`
2. Backend transcreve (Whisper) e interpreta (GPT-4o mini), devolve um **rascunho**
3. App mostra a confirmação: *"Você gastou R$7,50 em Sorvete (Alimentação), confirma?"*
4. Se o usuário confirmar → `POST /voice/confirmar` salva de fato
5. Se o usuário corrigir algo depois → isso é registrado em `correction_history`,
   que é exatamente o que vamos usar para medir a taxa de acerto da IA ao longo do teste

## Para colocar no ar (passo a passo)

1. Criar conta na [OpenAI Platform](https://platform.openai.com) e gerar uma API key
2. Criar um banco Postgres gratuito (ex: [Supabase](https://supabase.com) ou [Neon](https://neon.tech)) — Postgres 13+ (necessário para `gen_random_uuid()` nativo)
3. Rodar `db/schema.sql` nesse banco
4. Criar um arquivo `.env` na raiz do projeto com:
   ```
   DATABASE_URL=sua_url_do_postgres
   JWT_SECRET=uma_frase_secreta_qualquer
   PORT=3000
   ```
   `OPENAI_API_KEY` é **opcional** neste momento — sem ela, todo o app funciona
   normalmente (login, contas, lançamentos, financiamentos), só a rota `/voice`
   fica indisponível até você configurá-la. Quando for ativar o registro por voz,
   basta adicionar `OPENAI_API_KEY=sua_chave_aqui` neste mesmo arquivo.
5. `npm install`
6. `npm start`

## O que ainda falta antes de conectar no app de verdade

- Validação de dados de entrada mais completa nas rotas restantes (já cobrimos as principais: e-mail, senha, valores monetários, propriedade de conta/transação)
- Testes automatizados (o backend nunca foi executado contra um banco real, só validado sintaticamente)
- Rate limiting nas rotas públicas (`/auth`) para evitar força bruta de senha

## Deliberadamente fora do v1

Investimentos, Desejos/Metas, Saúde Financeira, modo Família, OCR de comprovantes,
modo offline, notificações push, múltiplas contas, antecipação de parcelas — tudo
isso já está documentado no plano geral do projeto, entra nas versões seguintes.
