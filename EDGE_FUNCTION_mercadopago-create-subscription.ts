// ════════════════════════════════════════════════════════════════
// Edge Function: mp-create-subscription
// Deploy no projeto Supabase com: verify_jwt = true
// (só pode ser chamada por um usuário logado — o frontend chama via
//  sb.functions.invoke('mp-create-subscription', { body: { back_url } }))
//
// Cria uma assinatura (preapproval) no Mercado Pago para o usuário logado
// e devolve o link de checkout (init_point) para o frontend abrir.
//
// Configure o secret antes de usar em produção:
//   Supabase Dashboard → Edge Functions → mp-create-subscription → Secrets
//   MP_ACCESS_TOKEN = access token de PRODUÇÃO da sua aplicação no
//   Mercado Pago Developers (https://www.mercadopago.com.br/developers/panel/app)
//
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já são injetados automaticamente
// pelo Supabase em toda Edge Function — não precisa configurar esses dois.
// ════════════════════════════════════════════════════════════════

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MP_ACCESS_TOKEN      = Deno.env.get('MP_ACCESS_TOKEN') ?? '';

// Mantenha igual à constante MP_PRECO_MENSAL do GESTORFISCAL.html
const MP_PRECO_MENSAL = 100;

// CORS: necessário porque a função é chamada pelo navegador (sb.functions.invoke),
// que envia um preflight OPTIONS antes do POST.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  if (!MP_ACCESS_TOKEN) {
    return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN não configurado no servidor. Contate o administrador.' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Extrai o usuário a partir do JWT do header Authorization (Supabase já validou a assinatura
  // do JWT antes de invocar esta function, pois verify_jwt = true no deploy).
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return new Response(JSON.stringify({ error: 'Não autenticado.' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: 'Sessão inválida.' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  const user = userData.user;

  let backUrl = '';
  try {
    const body = await req.json();
    if (typeof body?.back_url === 'string') backUrl = body.back_url;
  } catch { /* body é opcional */ }

  const preapprovalBody: Record<string, unknown> = {
    reason: 'GestorFiscal PRO — Licença mensal',
    external_reference: user.id, // usado pelo webhook para identificar o usuário
    payer_email: user.email,
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: MP_PRECO_MENSAL,
      currency_id: 'BRL',
    },
    status: 'pending',
  };
  if (backUrl) preapprovalBody.back_url = backUrl;

  const mpRes = await fetch('https://api.mercadopago.com/preapproval', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(preapprovalBody),
  });

  const mpData = await mpRes.json();
  if (!mpRes.ok) {
    console.error('Erro ao criar preapproval no Mercado Pago:', mpData);
    return new Response(JSON.stringify({ error: mpData?.message || 'Erro ao criar assinatura no Mercado Pago.' }), {
      status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Guarda a referência da assinatura já na criação; o webhook confirma a ativação
  // depois que o pagamento é aprovado (evento subscription_preapproval / payment).
  await supabase.from('empresas').update({ payment_ref: mpData.id }).eq('user_id', user.id);

  return new Response(JSON.stringify({ init_point: mpData.init_point }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
