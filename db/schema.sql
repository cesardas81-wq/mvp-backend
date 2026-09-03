-- ============================================
-- Schema do MVP v1 — App de Gestão Financeira
-- ============================================

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- No v1, cada usuário tem só 1 conta, mas a tabela já suporta múltiplas (v2+)
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(30) DEFAULT 'principal', -- principal, cartao, carteira (usado a partir da v2)
  is_default BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now()
);

-- Categorias pré-carregadas + criadas automaticamente pela IA
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE, -- NULL = categoria padrão do sistema
  name VARCHAR(100) NOT NULL,
  created_by_ai BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now()
);
-- Protege no nível do banco contra duplicatas (case-insensitive), reforçando a checagem
-- já feita na aplicação: uma categoria por nome, por usuário, e uma por nome entre as padrão do sistema
CREATE UNIQUE INDEX idx_categories_unique_user ON categories (user_id, LOWER(name)) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX idx_categories_unique_system ON categories (LOWER(name)) WHERE user_id IS NULL;

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id),
  category_id UUID REFERENCES categories(id),
  description VARCHAR(255) NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  type VARCHAR(10) NOT NULL CHECK (type IN ('entrada', 'saida')),
  source VARCHAR(10) NOT NULL CHECK (source IN ('manual', 'voz')),
  ai_confidence NUMERIC(4,3) CHECK (ai_confidence IS NULL OR ai_confidence BETWEEN 0 AND 1), -- só preenchido quando source = 'voz'
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT now()
);

-- Histórico de correções: alimenta o aprendizado da IA e mede a taxa de acerto
CREATE TABLE correction_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  field_corrected VARCHAR(20) NOT NULL CHECK (field_corrected IN ('categoria', 'valor', 'descricao')),
  original_value VARCHAR(255),
  corrected_value VARCHAR(255),
  corrected_at TIMESTAMP DEFAULT now()
);

CREATE TABLE financings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  total_installments INT NOT NULL CHECK (total_installments > 0),
  installment_value NUMERIC(12,2) NOT NULL CHECK (installment_value > 0),
  start_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  financing_id UUID NOT NULL REFERENCES financings(id) ON DELETE CASCADE,
  number INT NOT NULL,
  due_date DATE NOT NULL,
  paid BOOLEAN DEFAULT false,
  paid_at TIMESTAMP,
  UNIQUE (financing_id, number)
);

CREATE INDEX idx_transactions_user_date ON transactions(user_id, transaction_date);
CREATE INDEX idx_installments_financing ON installments(financing_id);

-- ============================================
-- Seed: categorias padrão do sistema (user_id NULL)
-- Necessário para a IA já ter um "leque" de categorias desde o primeiro uso
-- ============================================
INSERT INTO categories (user_id, name, created_by_ai) VALUES
  (NULL, 'Alimentação', false),
  (NULL, 'Transporte', false),
  (NULL, 'Moradia', false),
  (NULL, 'Saúde', false),
  (NULL, 'Lazer', false),
  (NULL, 'Educação', false),
  (NULL, 'Assinaturas', false),
  (NULL, 'Compras/Vestuário', false),
  (NULL, 'Contas e Serviços', false),
  (NULL, 'Cuidados Pessoais', false),
  (NULL, 'Pets', false),
  (NULL, 'Presentes/Doações', false),
  (NULL, 'Viagem', false),
  (NULL, 'Renda', false),
  (NULL, 'Outros', false);
