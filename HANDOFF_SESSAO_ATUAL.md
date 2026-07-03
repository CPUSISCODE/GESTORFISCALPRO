# HANDOFF — GestorFiscal PRO (sessão de melhorias)

> Documento para o **próximo Claude** continuar de onde paramos.
> Data: 2026-07-03. App = SaaS de precificação tributária (foco Acre), **um único HTML**
> (`index.html` = `GESTORFISCAL.html`, sempre idênticos), 100% no navegador, backend Supabase + pagamento.

---

## ⚠️ LEIA PRIMEIRO — estado do Git (crítico)

- Branch de trabalho: **`claude/app-review-improvements-w6qj71`**
- Há **7 commits feitos localmente que NUNCA subiram** para o GitHub.
- Motivo: a sessão anterior estava com **acesso somente-leitura** ao repo `cpusiscode/gestorfiscalpro`.
  Tanto `git push` quanto a API do GitHub (MCP) retornavam **403** (`Resource not accessible by integration`).
  `git fetch` funcionava (leitura), `push` não (escrita).
- O usuário disse que **liberou a permissão de escrita**, mas o token da sessão é gerado no início dela,
  então **só passa a valer numa sessão nova**.
- **AÇÃO Nº 1 do próximo Claude:** tentar `git push -u origin claude/app-review-improvements-w6qj71`.
  Se funcionar, ótimo. Se ainda der 403, orientar o usuário a confirmar a permissão de escrita do
  GitHub App do Claude Code no repo e/ou fazer upload manual dos arquivos pelo site do GitHub
  (Add file → Upload files → arrastar `index.html` e `GESTORFISCAL.html` → Commit).
- Os arquivos finais já foram entregues ao usuário via chat (index.html, GESTORFISCAL.html,
  migration_supabase_completa.sql e as 4 Edge Functions .ts).

### Commits locais (mais recente → mais antigo)
1. `0bfa93c` Gestão de usuários (criar login) e aba de integração PDV/ERP
2. `cfc2258` Precificação: lucro desejado, fator de conversão, log e tabela estilo-ERP
3. `ca9f0e3` Persiste despesas/XMLs no Supabase + backup automático no Google Drive
4. `ebe5bab` Adiciona edição de usuário no Painel Admin (dados cadastrais + senha)
5. `d8a8819` (Mercado Pago + correção RLS) — *ver nota de autoria abaixo*
6. (2 commits anteriores de amend/base do mesmo trabalho)

> Nota: um stop-hook fica reclamando de commits "Unverified". Ignore — o e-mail do autor já é
> `noreply@anthropic.com`; a assinatura é aplicada pelo servidor **no push**. Nada a corrigir localmente.

---

## ✅ O QUE JÁ ESTÁ NO AR (Supabase — projeto `wnwceqoafxvnyqcostpi`, "CalcVendas BR")

Este projeto Supabase foi **reaproveitado** (as tabelas antigas de outro app foram apagadas — só tinham
lixo) e recriado com o schema do GestorFiscal. **URL e anon key já estão no `index.html`.**

### Tabelas (todas com RLS)
- `empresas` (cadastro + status de assinatura). Colunas novas: `payment_ref`, `erp_provider`,
  `erp_api_key`, `erp_api_url`.
- `admins` (e-mails admin). **Admin cadastrado: `joseminergate2019@gmail.com`**.
- `notas_fiscais` (histórico). Colunas novas: `xml_raw`, `empresa_nome`, `competencia`, `drive_file_id`.
- `despesas` (1 linha/usuário, JSONB) — persiste as despesas na nuvem.

### 🔒 Correção de segurança CRÍTICA aplicada (RLS)
A policy antiga deixava qualquer usuário logado rodar `update({status:'active'})` e **se auto-ativar sem
pagar**. Foi criado o trigger `protect_empresas_payment_fields` que só deixa `status/plano/payment_ref/
paid_at/activated_at` serem alterados por **service_role (webhook)** ou **admin**. O dono da linha ainda
edita os próprios dados cadastrais normalmente.

### Edge Functions (todas ACTIVE)
1. `mp-create-subscription` (verify_jwt=true) — cria assinatura no Mercado Pago, retorna `init_point`.
2. `mp-webhook` (verify_jwt=false) — recebe confirmação de pagamento e ativa/suspende a conta.
3. `admin-update-user` (verify_jwt=true) — admin troca senha e/ou edita cadastro de qualquer usuário.
4. `admin-create-user` (verify_jwt=true) — admin cria novo login (e-mail+senha+empresa+status).

### ⚠️ Secrets que FALTAM configurar no Supabase (senão o pagamento não funciona)
Dashboard → Edge Functions → Secrets:
- `MP_ACCESS_TOKEN` = Access Token de produção do Mercado Pago (o usuário ainda não tem conta MP criada).
- `MP_WEBHOOK_SECRET` = "assinatura secreta" gerada ao criar o webhook no painel do Mercado Pago.
- Depois, criar o webhook no Mercado Pago apontando para
  `https://wnwceqoafxvnyqcostpi.supabase.co/functions/v1/mp-webhook` (eventos: Assinaturas + Pagamentos).

---

## 🧩 O QUE FOI IMPLEMENTADO NO CÓDIGO (index.html / GESTORFISCAL.html)

### 1. Pagamento: Stripe → Mercado Pago
- Removido Stripe. `goToMercadoPago()` chama a Edge Function `mp-create-subscription` e abre o `init_point`.
- Constante `MP_PRECO_MENSAL = 100` (R$ 100/mês).

### 2. Segurança de front
- Função `escapeHtml()` aplicada onde dados de XML (descrição do produto) e de cadastro (nome/CNPJ no
  admin) eram injetados em `innerHTML` — corrige XSS.

### 3. Persistência de dados (navegador + nuvem)
- **Despesas**: salvam no `localStorage` (chave por usuário) **e** no Supabase (tabela `despesas`).
  `loadDespesas()` puxa a nuvem como fonte da verdade.
- **XML bruto**: `saveToHistory()` agora grava o XML completo (`xml_raw`) + `empresa_nome` + `competencia`.

### 4. Google Drive — backup automático de XMLs
- Botão "Conectar/Desconectar" na sub-aba **Drive** (OAuth via Google Identity Services).
- A cada XML salvo, faz upload para `Empresa / mês-ano / arquivo.xml` dentro da pasta compartilhada.
- **FALTA:** preencher a constante `GOOGLE_CLIENT_ID` (está vazia/placeholder). O usuário precisa criar um
  OAuth Client ID ("Web application") no Google Cloud, habilitar a Google Drive API, e colar o ID.
  A pasta raiz do Drive já está embutida: `DRIVE_PARENT_FOLDER_ID = '15KRDJASUHSm5ZPUeHuefxIqQQXtau1N5'`.

### 5. ⚡ Lucro Líquido Desejado (era URGENTE — apresentação pro "César")
- Campo no card de precificação (sidebar detail), **abaixo do preço sugerido**. Aceita **% sobre a venda**
  ou **R$ por unidade**. Recalcula o Preço de Venda Sugerido na hora (função `setLucroDesejado()`),
  convertendo para a margem equivalente do motor (`margemCustom`) — flui para tabela/impressão sem divergir.
- Atualiza no `onchange` (ao sair do campo), não a cada tecla, para não perder o foco no re-render.

### 6. Fator de Conversão / Fracionamento
- Por item, `÷` ou `×` + quantidade (ex.: caixa ÷ 50 → custo unitário). Aplicado DENTRO de
  `calcCustoEfetivo` (via `aplicaFatorConversao`), então reflete em todas as telas. Campos: `p.convOp`, `p.convQty`.

### 7. Botão "Log" (memória de cálculo)
- Botão no fim do card abre modal `#modal-calc-log` com o rastro textual: cada número real da fórmula
  do Custo Base → CMV → Preço. Função `openCalcLog()`.

### 8. Tabela estilo-ERP ("bate o olho")
- Função `buildErpTable()` monta uma tabela vertical no topo do card: Preço de Compra → CST Entrada →
  Preço de Venda → CST Saída → Lucro Líquido, com colunas Descrição/R$/%. Espelha a planilha de ERP que
  o chefe do usuário mostrou (imagem enviada no chat).

### 9. Gestão de usuários (Painel Admin / ícone escudo)
- **"Editar"** em cada usuário: modal edita cadastro/regime + troca senha (via `admin-update-user`).
- **"Novo usuário"** no header do painel: modal cria login novo (via `admin-create-user`).
- Resolve "não depender de uma conta só" + "troca de senha funcionando".

### 10. Aba PDV/ERP nas Configurações
- Sub-aba "PDV/ERP" com campos: sistema, URL da API, chave (token). Salvos em `empresas.erp_*`
  (função `saveErpConfig()`). **Estrutura pronta**; a importação real depende de saber QUAL ERP o cliente usa.

---

## 📋 O QUE AINDA FALTA / PRÓXIMOS PASSOS

1. **Fazer o push dos 7 commits** (ver seção Git no topo).
2. **Secrets do Mercado Pago** + criar conta/app no Mercado Pago + configurar webhook (ver Supabase acima).
3. **Google Drive**: preencher `GOOGLE_CLIENT_ID` (usuário precisa criar no Google Cloud).
4. **Integração ERP real**: descobrir QUAL sistema o cliente usa (Consinco? TOTVS? Bling? Tiny?) para
   implementar a importação de notas via API. Sem o nome do ERP não dá para avançar.
5. **Auth do Supabase**: em Authentication → URL Configuration, colocar a URL do GitHub Pages
   (necessário para o "esqueci a senha" e redirecionos).

---

## 💡 Sugestões de melhoria em aberto (o usuário gosta de recebê-las)
- **Remover a proteção "anti-DevTools"** do topo do `<script>`: atrapalha usuários legítimos e não protege
  de fato (a API é acessível via anon key de qualquer jeito).
- **Mostrar o e-mail de login** nos cards do Painel Admin (hoje só mostra razão social/CNPJ; o e-mail está
  em `auth.users`, então precisaria a `admin-*` function retornar isso).
- **Confirmar antes de trocar senha** no modal admin (evitar troca acidental).
- **Avisar na UI** quando o cálculo de ICMS-ST do Acre usa NCM "estimado" vs "oficial" (a tabela
  `ICMS_AC_ST_NCM` tem vários valores estimados, já comentados no código).

---

## 🗂️ Fórmulas centrais (NÃO recalcular preço fora delas — senão as telas divergem)
```js
calcCustoEfetivo(p, freteRS, icmsEntPct, ipi)
// Custo Base = (vUnCom - desconto - icmsDesonerado) + freteRS + outrasDespesas
//   + vUnCom*(icmsEntPct/100 + ipi/100) + vUnCom*aliquotaST/100
// depois aplica o Fator de Conversão (÷ ou ×) via aplicaFatorConversao()

calcPreco(custoEf, aliquota, margem)
// = custoEf / (1 - aliquota - margem/100 - despesasTotalPct/100)
```
