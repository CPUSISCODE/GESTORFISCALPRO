// ════════════════════════════════════════════════════════════════
// Edge Function: admin-create-user
// Deploy no projeto Supabase com: verify_jwt = true
//
// Permite que um ADMIN crie um novo login (usuário) no sistema, já com a
// empresa/regime e o status desejado. Usa a Admin API do Supabase
// (auth.admin.createUser), que exige service_role — por isso roda aqui no
// servidor, nunca no frontend. Valida que o chamador é admin antes de agir.
// ════════════════════════════════════════════════════════════════

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

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

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Nao autenticado.' }, 401);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Confirma que o chamador é admin
  const { data: caller, error: callerErr } = await admin.auth.getUser(jwt);
  if (callerErr || !caller?.user) return json({ error: 'Sessao invalida.' }, 401);
  const { data: adminRow } = await admin.from('admins').select('id').eq('email', caller.user.email).maybeSingle();
  if (!adminRow) return json({ error: 'Acesso restrito a administradores.' }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: 'JSON invalido.' }, 400); }

  const email    = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !email.includes('@')) return json({ error: 'E-mail invalido.' }, 400);
  if (password.length < 6)            return json({ error: 'A senha deve ter ao menos 6 caracteres.' }, 400);

  // Cria o usuário no Auth (email já confirmado, para poder logar direto)
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { nome: body.nome || '' },
  });
  if (createErr) return json({ error: 'Erro ao criar usuario: ' + createErr.message }, 500);

  const uid = created.user?.id;
  if (!uid) return json({ error: 'Usuario criado sem ID.' }, 500);

  // Cria a empresa vinculada. Como usamos service_role, o trigger permite
  // definir o status diretamente (ex.: já ativo, já que foi um admin quem criou).
  const status = ['pending', 'pending_payment', 'active'].includes(String(body.status)) ? String(body.status) : 'active';
  const { error: empErr } = await admin.from('empresas').insert({
    user_id:  uid,
    nome:     body.nome || null,
    cnpj:     body.cnpj || null,
    uf:       body.uf || null,
    cidade:   body.cidade || null,
    regime:   body.regime || 'SN',
    sn_anexo: body.sn_anexo || 'I',
    sn_rba:   Number(body.sn_rba) || 360000,
    status,
    activated_at: status === 'active' ? new Date().toISOString() : null,
  });
  if (empErr) {
    // desfaz o usuário criado se a empresa falhar, para não deixar órfão
    await admin.auth.admin.deleteUser(uid).catch(() => {});
    return json({ error: 'Erro ao criar empresa: ' + empErr.message }, 500);
  }

  return json({ ok: true, user_id: uid });
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
