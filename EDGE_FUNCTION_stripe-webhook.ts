// ════════════════════════════════════════════════════════════════
// Edge Function: stripe-webhook
// Deploy no NOVO projeto Supabase com: verify_jwt = false
// (este endpoint recebe chamadas do Stripe, não do usuário logado)
//
// Depois de deployar, configure o secret:
//   Supabase Dashboard → Edge Functions → stripe-webhook → Secrets
//   STRIPE_WEBHOOK_SECRET = whsec_... (gerado ao criar o endpoint no Stripe)
//
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já são injetados automaticamente
// pelo Supabase em toda Edge Function — não precisa configurar esses dois.
// ════════════════════════════════════════════════════════════════

import { createClient } from 'jsr:@supabase/supabase-js@2';

const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
const SUPABASE_URL          = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

async function verifyStripeSignature(body: string, sig: string, secret: string): Promise<boolean> {
  const parts      = sig.split(',');
  const tsPart     = parts.find(p => p.startsWith('t='));
  const v1Part     = parts.find(p => p.startsWith('v1='));
  if (!tsPart || !v1Part) return false;
  const timestamp  = tsPart.slice(2);
  const v1Sig      = v1Part.slice(3);
  const payload    = `${timestamp}.${body}`;
  const key        = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signed     = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const computed   = Array.from(new Uint8Array(signed)).map(b => b.toString(16).padStart(2,'0')).join('');
  if (computed.length !== v1Sig.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ v1Sig.charCodeAt(i);
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  return diff === 0 && age < 300;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const body = await req.text();
  const sig  = req.headers.get('stripe-signature') ?? '';

  if (STRIPE_WEBHOOK_SECRET) {
    const valid = await verifyStripeSignature(body, sig, STRIPE_WEBHOOK_SECRET);
    if (!valid) return new Response('Invalid signature', { status: 400 });
  }

  let event: Record<string, unknown>;
  try { event = JSON.parse(body); } catch { return new Response('Bad JSON', { status: 400 }); }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const type = event.type as string;
  const obj  = (event.data as Record<string, unknown>)?.object as Record<string, unknown>;

  if (type === 'checkout.session.completed') {
    const userId    = obj?.client_reference_id as string;
    const sessionId = obj?.id as string;
    if (userId) {
      const { error } = await supabase
        .from('empresas')
        .update({ status: 'active', stripe_session_id: sessionId, paid_at: new Date().toISOString() })
        .eq('user_id', userId);
      if (error) {
        console.error('Supabase update error:', error.message);
        return new Response('DB error', { status: 500 });
      }
      console.log(`Usuário ${userId} ativado após pagamento ${sessionId}`);
    }
  }

  if (type === 'customer.subscription.deleted' || type === 'invoice.payment_failed') {
    const userId = obj?.client_reference_id as string
      ?? (obj?.metadata as Record<string,string>)?.user_id;
    if (userId) {
      await supabase.from('empresas').update({ status: 'pending_payment' }).eq('user_id', userId);
      console.log(`Acesso suspenso para ${userId} — evento: ${type}`);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
