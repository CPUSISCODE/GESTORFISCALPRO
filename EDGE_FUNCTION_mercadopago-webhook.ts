// ════════════════════════════════════════════════════════════════
// Edge Function: mp-webhook
// Deploy no projeto Supabase com: verify_jwt = false
// (este endpoint recebe chamadas do Mercado Pago, não do usuário logado)
//
// Configure no painel do Mercado Pago (Developers → Sua aplicação → Webhooks):
//   URL: https://<project-ref>.supabase.co/functions/v1/mp-webhook
//   Eventos: "Assinaturas" (subscription_preapproval) e "Pagamentos" (payment)
// Depois copie a "Assinatura secreta" (Secret Signature) gerada e configure:
//   Supabase Dashboard → Edge Functions → mp-webhook → Secrets
//   MP_WEBHOOK_SECRET = <secret gerado pelo Mercado Pago>
//   MP_ACCESS_TOKEN    = o mesmo access token usado em mp-create-subscription
//
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já são injetados automaticamente
// pelo Supabase em toda Edge Function — não precisa configurar esses dois.
//
// Referência oficial da validação de assinatura:
// https://www.mercadopago.com.br/developers/pt/docs/checkout-api/webhooks#editor_5
// ════════════════════════════════════════════════════════════════

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MP_ACCESS_TOKEN      = Deno.env.get('MP_ACCESS_TOKEN') ?? '';
const MP_WEBHOOK_SECRET    = Deno.env.get('MP_WEBHOOK_SECRET') ?? '';

async function verifyMpSignature(req: Request, dataId: string): Promise<boolean> {
  // Sem secret configurado ainda, não dá pra validar — bloqueia por segurança.
  // Configure MP_WEBHOOK_SECRET antes de colocar isso em produção de verdade.
  if (!MP_WEBHOOK_SECRET) return false;

  const sigHeader = req.headers.get('x-signature') ?? '';
  const requestId = req.headers.get('x-request-id') ?? '';
  const parts: Record<string, string> = {};
  for (const p of sigHeader.split(',')) {
    const [k, v] = p.split('=');
    if (k && v) parts[k.trim()] = v.trim();
  }
  const ts = parts['ts'];
  const v1 = parts['v1'];
  if (!ts || !v1 || !dataId) return false;

  // Manifesto conforme documentação do Mercado Pago (data.id sempre em minúsculas)
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(MP_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signed   = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest));
  const computed = Array.from(new Uint8Array(signed)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (computed.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const url    = new URL(req.url);
  const type   = url.searchParams.get('type') || url.searchParams.get('topic') || '';
  const dataId = url.searchParams.get('data.id') || url.searchParams.get('id') || '';

  let body: Record<string, unknown> = {};
  if (req.method === 'POST') {
    try { body = await req.json(); } catch { /* alguns eventos não trazem body */ }
  }
  const finalType   = type || (body.type as string) || '';
  const finalDataId = dataId || ((body.data as Record<string, unknown> | undefined)?.id as string) || '';

  // Nada pra processar (ex: ping de teste do painel) — responde OK sem fazer nada.
  if (!finalDataId || !finalType) return new Response('ok', { status: 200 });

  const validSig = await verifyMpSignature(req, finalDataId);
  if (!validSig) return new Response('Invalid signature', { status: 401 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    // Assinatura criada/paga/cancelada/pausada
    if (finalType === 'subscription_preapproval' || finalType === 'preapproval') {
      const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${finalDataId}`, {
        headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` },
      });
      const preapproval = await mpRes.json();
      const userId = preapproval?.external_reference as string | undefined;
      if (userId) {
        if (preapproval.status === 'authorized') {
          await supabase.from('empresas')
            .update({ status: 'active', payment_ref: finalDataId, paid_at: new Date().toISOString() })
            .eq('user_id', userId);
        } else if (preapproval.status === 'cancelled' || preapproval.status === 'paused') {
          await supabase.from('empresas').update({ status: 'pending_payment' }).eq('user_id', userId);
        }
      }
    }

    // Cobrança recorrente individual (mensalidade aprovada ou recusada)
    if (finalType === 'payment') {
      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${finalDataId}`, {
        headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` },
      });
      const payment = await mpRes.json();
      const userId = payment?.external_reference as string | undefined;
      if (userId) {
        if (payment.status === 'approved') {
          await supabase.from('empresas')
            .update({ status: 'active', paid_at: new Date().toISOString() })
            .eq('user_id', userId);
        } else if (payment.status === 'rejected' || payment.status === 'cancelled') {
          await supabase.from('empresas').update({ status: 'pending_payment' }).eq('user_id', userId);
        }
      }
    }
  } catch (e) {
    console.error('Erro processando webhook Mercado Pago:', e);
    return new Response('Internal error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
