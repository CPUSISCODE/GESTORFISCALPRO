-- ════════════════════════════════════════════════════════════════
-- GESTORFISCAL PRO — MIGRAÇÃO COMPLETA DE BANCO SUPABASE
-- Rode este arquivo inteiro no SQL Editor de um novo projeto Supabase
-- para recriar o schema do zero.
-- ════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────
-- TABELA: empresas
-- Guarda os dados cadastrais e o status de assinatura de cada usuário.
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empresas (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  nome               TEXT,
  cnpj               TEXT,
  uf                 TEXT,
  cidade             TEXT,
  regime             TEXT DEFAULT 'SN',
  sn_anexo           TEXT DEFAULT 'I',
  sn_rba             NUMERIC DEFAULT 360000,
  drive_url          TEXT,
  telefone           TEXT,
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','pending_payment','active')),
  plano              TEXT,
  payment_ref        TEXT, -- id da assinatura/pagamento no Mercado Pago (preapproval_id / payment_id)
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

-- IMPORTANTE: troque o email abaixo pelo email da conta admin do seu projeto
INSERT INTO admins (email) VALUES ('joseminergate2019@gmail.com') ON CONFLICT DO NOTHING;

-- Políticas extras em "empresas" que dependem de "admins"
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
-- PROTEÇÃO CRÍTICA: sem isto, qualquer usuário logado poderia rodar
--   sb.from('empresas').update({status:'active'}) e ativar a própria conta
--   sem pagar, porque a policy "own_empresas" acima libera UPDATE de
--   qualquer coluna da própria linha (RLS filtra linhas, não colunas).
-- Este trigger reforça, a nível de coluna, que status/plano/payment_ref/
--   activated_at/paid_at só podem ser alterados por:
--   - service_role (a Edge Function do webhook do Mercado Pago), ou
--   - um admin (tabela admins) usando o Painel Admin.
-- Qualquer outro usuário continua podendo editar os próprios dados
--   cadastrais (nome, cnpj, regime, etc.) normalmente.
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION protect_empresas_payment_fields()
RETURNS TRIGGER AS $$
DECLARE
  is_privileged BOOLEAN;
BEGIN
  is_privileged := (auth.role() = 'service_role')
    OR EXISTS (SELECT 1 FROM admins WHERE email = (auth.jwt() ->> 'email'));

  IF TG_OP = 'INSERT' THEN
    IF NOT is_privileged THEN
      NEW.status       := 'pending'; -- novo cadastro aguarda aprovação do admin
      NEW.plano        := NULL;
      NEW.payment_ref  := NULL;
      NEW.activated_at := NULL;
      NEW.paid_at      := NULL;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NOT is_privileged THEN
      NEW.status       := OLD.status;
      NEW.plano        := OLD.plano;
      NEW.payment_ref  := OLD.payment_ref;
      NEW.activated_at := OLD.activated_at;
      NEW.paid_at      := OLD.paid_at;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_protect_empresas_payment ON empresas;
CREATE TRIGGER trg_protect_empresas_payment
BEFORE INSERT OR UPDATE ON empresas
FOR EACH ROW EXECUTE FUNCTION protect_empresas_payment_fields();

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

-- Colunas extras para guardar o XML bruto e organizar o backup no Google Drive
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS xml_raw       TEXT;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS empresa_nome  TEXT;
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS competencia   TEXT;  -- mm/aaaa
ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS drive_file_id TEXT;

-- ────────────────────────────────────────────
-- TABELA: despesas
-- Persiste as despesas operacionais de cada usuário no Supabase
-- (além do cache em localStorage do navegador). Uma linha por usuário.
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS despesas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE despesas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own_despesas" ON despesas;
CREATE POLICY "own_despesas" ON despesas
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Campos para integração com o ERP/PDV do cliente (chave de API nas Configurações)
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS erp_provider TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS erp_api_key  TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS erp_api_url  TEXT;

-- ════════════════════════════════════════════════════════════════
-- FIM DA MIGRAÇÃO. Próximos passos manuais (fora do SQL):
-- 1. Authentication → URL Configuration → Site URL = URL do GitHub Pages do app
-- 2. Deploy das Edge Functions "mp-create-subscription" (verify_jwt=true) e
--    "mp-webhook" (verify_jwt=false) — código em
--    EDGE_FUNCTION_mercadopago-create-subscription.ts e
--    EDGE_FUNCTION_mercadopago-webhook.ts
-- 3. Configurar os secrets MP_ACCESS_TOKEN e MP_WEBHOOK_SECRET nas Edge Functions
-- 4. Atualizar GF_SB_URL e GF_SB_KEY no GESTORFISCAL.html/index.html com os
--    dados do projeto (Project Settings → API)
-- ════════════════════════════════════════════════════════════════
