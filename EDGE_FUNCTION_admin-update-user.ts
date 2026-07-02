// ════════════════════════════════════════════════════════════════
// Edge Function: admin-update-user
// Deploy no projeto Supabase com: verify_jwt = true
//
// Permite que um ADMIN (email presente na tabela "admins") troque a senha
// de qualquer usuário e/ou atualize os dados cadastrais da empresa dele.
//
// A troca de senha usa a Admin API do Supabase (auth.admin.updateUserById),
// que exige a service_role key — por isso PRECISA ser feita aqui no servidor,
// nunca no frontend. A função valida que o CHAMADOR é admin antes de qualquer
// coisa; um usuário comum recebe 403.
//
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetados automaticamente.
// ════════════════════════════════════════════════════════════════

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const EMPRESA_FIELDS = ['nome', 'cnpj', 'uf', 'cidade', 'regime', 'sn_anexo', 'sn_rba'];

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Nao autenticado.' }, 401);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // 1. Identifica o chamador a partir do JWT
  const { data: caller, error: callerErr } = await admin.auth.getUser(jwt);
  if (callerErr || !caller?.user) return json({ error: 'Sessao invalida.' }, 401);

  // 2. Confirma que o chamador é admin
  const { data: adminRow } = await admin
    .from('admins').select('id').eq('email', caller.user.email).maybeSingle();
  if (!adminRow) return json({ error: 'Acesso restrito a administradores.' }, 403);

  // 3. Lê o corpo
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: 'JSON invalido.' }, 400); }

  const targetUserId = body.target_user_id as string | undefined;
  if (!targetUserId) return json({ error: 'target_user_id obrigatorio.' }, 400);

  const results: Record<string, unknown> = {};

  // 4. Troca de senha (opcional)
  if (typeof body.password === 'string' && body.password.length > 0) {
    if (body.password.length < 6) return json({ error: 'A senha deve ter ao menos 6 caracteres.' }, 400);
    const { error: pwErr } = await admin.auth.admin.updateUserById(targetUserId, { password: body.password });
    if (pwErr) return json({ error: 'Erro ao trocar senha: ' + pwErr.message }, 500);
    results.password = 'updated';
  }

  // 5. Atualização de dados da empresa (opcional)
  if (body.empresa && typeof body.empresa === 'object') {
    const patch: Record<string, unknown> = {};
    for (const f of EMPRESA_FIELDS) {
      if (f in (body.empresa as Record<string, unknown>)) patch[f] = (body.empresa as Record<string, unknown>)[f];
    }
    if (Object.keys(patch).length > 0) {
      const { error: upErr } = await admin.from('empresas').update(patch).eq('user_id', targetUserId);
      if (upErr) return json({ error: 'Erro ao atualizar empresa: ' + upErr.message }, 500);
      results.empresa = 'updated';
    }
  }

  return json({ ok: true, ...results });
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
