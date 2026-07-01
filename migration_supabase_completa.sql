-- ════════════════════════════════════════════════════════════════
-- GESTORFISCAL PRO — MIGRAÇÃO COMPLETA DE BANCO SUPABASE
-- Gerado a partir do projeto original (qaiqflcxfxygynumapyp) em 2026-06-23
-- Rode este arquivo inteiro no SQL Editor do NOVO projeto Supabase.
-- ════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────
-- TABELA: empresas
-- Guarda os dados cadastrais e o status de assinatura de cada usuário.
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empresas (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome               TEXT,
  cnpj               TEXT,
  uf                 TEXT,
  cidade             TEXT,
  regime             TEXT DEFAULT 'SN',
  sn_anexo           TEXT DEFAULT 'I',
  sn_rba             NUMERIC DEFAULT 360000,
  drive_url          TEXT,
  telefone           TEXT,
  status             TEXT NOT NULL DEFAULT 'pending_payment'
                       CHECK (status IN ('pending','pending_payment','active')),
  plano              TEXT,
  stripe_session_id  TEXT,
  activated_at       TIMESTAMPTZ,
  paid_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own_empresas" ON empresas;
CREATE POLICY "own_empresas" ON empresas
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ────────────────────────────────────────────
-- TABELA: admins
-- Emails autorizados a usar o Painel Admin (ativar/suspender contas).
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_can_check_admin" ON admins;
CREATE POLICY "authenticated_can_check_admin" ON admins
  FOR SELECT USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- IMPORTANTE: troque o email abaixo pelo email da conta admin na NOVA conta Claude/Supabase
INSERT INTO admins (email) VALUES ('deltaspriggan@gmail.com') ON CONFLICT DO NOTHING;

-- Políticas extras em "empresas" que dependem de "admins" (precisam vir depois das duas tabelas existirem)
DROP POLICY IF EXISTS "admins_can_select_all" ON empresas;
CREATE POLICY "admins_can_select_all" ON empresas
  FOR SELECT USING (
    (auth.uid() = user_id)
    OR EXISTS (SELECT 1 FROM admins WHERE email = (auth.jwt() ->> 'email'))
  );

DROP POLICY IF EXISTS "admins_can_update_status" ON empresas;
CREATE POLICY "admins_can_update_status" ON empresas
  FOR UPDATE USING (
    (auth.uid() = user_id)
    OR EXISTS (SELECT 1 FROM admins WHERE email = (auth.jwt() ->> 'email'))
    OR auth.role() = 'service_role'
  );

-- ────────────────────────────────────────────
-- TABELA: notas_fiscais
-- Histórico de análises de XML salvas pelo usuário ("Salvar" na aba Histórico).
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notas_fiscais (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  empresa_id  UUID,
  arquivo     TEXT,
  chave       TEXT,
  regime      TEXT,
  margem      NUMERIC,
  frete       NUMERIC,
  produtos    JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE notas_fiscais ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own_notas" ON notas_fiscais;
CREATE POLICY "own_notas" ON notas_fiscais
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ────────────────────────────────────────────
-- (OPCIONAL) TABELA: ai_config
-- Sobra de uma feature de IA que foi REMOVIDA do app (GESTORFISCAL.html não usa mais isso).
-- Só crie se for reimplementar o assistente de IA no futuro. Pode pular esta seção.
-- ────────────────────────────────────────────
-- CREATE TABLE IF NOT EXISTS ai_config (
--   id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--   user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
--   provider   TEXT NOT NULL DEFAULT 'anthropic' CHECK (provider IN ('anthropic','openai','gemini')),
--   api_key    TEXT NOT NULL,
--   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
--   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
--   UNIQUE (user_id)
-- );
-- ALTER TABLE ai_config ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "own_ai_config" ON ai_config FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ════════════════════════════════════════════════════════════════
-- FIM DA MIGRAÇÃO. Próximos passos manuais (fora do SQL):
-- 1. Authentication → URL Configuration → Site URL = URL do GitHub Pages do app
-- 2. Deploy da Edge Function "stripe-webhook" (código em EDGE_FUNCTION_stripe-webhook.ts)
-- 3. Configurar o secret STRIPE_WEBHOOK_SECRET na Edge Function
-- 4. Atualizar GF_SB_URL e GF_SB_KEY no GESTORFISCAL.html com os dados do novo projeto
-- Veja o arquivo HANDOFF_GESTORFISCAL.md para o passo a passo completo.
-- ════════════════════════════════════════════════════════════════
