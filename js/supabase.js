/* ════════════════════════════════════════════════════════════════════
   supabase.js — Login (e-mail + senha) + salvar o quadro na nuvem
   ────────────────────────────────────────────────────────────────────
   ┌─────────────────────────────────────────────────────────────────┐
   │  CONFIGURE AQUI ── cole a URL e a chave pública (anon) do seu    │
   │  projeto Supabase. Enquanto ficarem vazias, este módulo NÃO faz  │
   │  nada — o app funciona 100% offline, como antes.                 │
   │  Supabase → Project Settings → API:                             │
   │     • Project URL          → SUPABASE_URL                        │
   │     • Project API keys → anon public → SUPABASE_ANON_KEY         │
   └─────────────────────────────────────────────────────────────────┘

   LOGIN: e-mail + senha (Supabase Auth).
     • "Entrar"      → signInWithPassword
     • "Criar conta" → signUp
   ⚠️ Por padrão o Supabase pede CONFIRMAÇÃO de e-mail ao criar conta.
      Se quiser entrar direto sem confirmar, vá em
      Supabase → Authentication → Providers → Email e DESLIGUE
      "Confirm email". (Ou confirme pelo link que chega no e-mail.)

   SALVAR: depois de logado, o botão do topo vira um menu ☁ com
      "Salvar este canvas na nuvem". É ali que você grava o quadro.

   ⚠️ MÍDIA (imagens): imagens coladas/arrastadas são pesadas. Ao salvar,
      elas sobem para o Supabase Storage e o quadro guarda só o link.
      Para isso funcionar você precisa criar UM bucket (uma vez só):
        Supabase → Storage → New bucket → nome: board-media → Public ✓
      E rodar as POLÍTICAS de Storage do SQL (no fim deste arquivo).

   As TABELAS/policies estão no comentário no fim deste arquivo.
   ════════════════════════════════════════════════════════════════════ */

   const SUPABASE_URL      = 'https://wilxxkkqgoigmrdgufej.supabase.co';   // ex.: 'https://xxxxxxxx.supabase.co'
   const SUPABASE_ANON_KEY = 'sb_publishable_4aAvHuCLifDoik3w-ECc7Q_8L6jxaXn';   // ex.: 'eyJhbGciOi...'
   
 
   
   // Promessa que resolve com o cliente Supabase (ou null se não configurado).
   // Idempotente: se o collab-supabase.js já a criou (ele carrega antes), reusa
   // a mesma — evita corrida de ordem de carregamento dos scripts.
   if (!window.__supabaseReady) {
     window.__supabaseReady = new Promise((resolve) => { window.__resolveSupabase = resolve; });
   }
   
   if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
     console.info('[supabase] Não configurado — modo offline. Preencha SUPABASE_URL e SUPABASE_ANON_KEY em supabase.js para ativar login/nuvem.');
     window.__resolveSupabase(null);
   } else {
     boot();
   }
   
   async function boot() {
     const { confirmModal, chooseModal } = await import('./modal.js');
     const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
     const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
     window.__supabase = sb;
     window.__resolveSupabase(sb);
   
     const ACTIVE_KEY  = 'whiteboard:active';
     const INDEX_KEY   = 'whiteboard:projects';
     const DATA_PREFIX = 'whiteboard:v1:';
   
     const activeId   = () => localStorage.getItem(ACTIVE_KEY) || 'default';
     const activeName = () => {
       try {
         const list = JSON.parse(localStorage.getItem(INDEX_KEY) || '[]');
         return list.find((p) => p.id === activeId())?.name || 'Canvas';
       } catch { return 'Canvas'; }
     };
     const activeData = () => {
       try { return JSON.parse(localStorage.getItem(DATA_PREFIX + activeId()) || '{}'); }
       catch { return {}; }
     };
   
     const slot = document.getElementById('auth-slot');
   
     /* ══════════════ UI do botão no topo ══════════════ */
     function render(user) {
       if (!slot) return;
       slot.innerHTML = '';
       const btn = document.createElement('button');
       btn.className = 'hud__btn hud__btn--text';
       btn.style.cssText = 'display:inline-flex;align-items:center;gap:5px;';
       if (!user) {
         btn.innerHTML = cloudIcon() + 'entrar';
         btn.title = 'Entrar para salvar na nuvem';
         btn.addEventListener('click', openAuthModal);
       } else {
         btn.innerHTML = cloudIcon() + (user.email?.split('@')[0] || 'conta');
         btn.title = 'Nuvem — salvar / abrir / sair';
         btn.addEventListener('click', () => openCloudMenu(user));
       }
       slot.appendChild(btn);
     }
   
     function cloudIcon() {
       return '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" style="vertical-align:-1px;"><path d="M4.5 12a3 3 0 0 1-.3-6A4 4 0 0 1 12 6.5a2.75 2.75 0 0 1-.2 5.5H4.5z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
     }
   
     /* ══════════════ Modal de login (e-mail + senha) ══════════════ */
     function openAuthModal() {
       const overlay = document.createElement('div');
       overlay.className = 'sb-auth-overlay';
       overlay.style.cssText = `position:fixed;inset:0;z-index:10000;display:flex;
         align-items:center;justify-content:center;padding:24px;opacity:1;
         background:rgba(20,20,18,0.42);backdrop-filter:blur(3px);`;
   
       overlay.innerHTML = `
         <div class="sb-auth-card" style="background:var(--bg-elevated,#fdfcf9);
           color:var(--ink,#1a1a18);width:min(360px,100%);border-radius:16px;
           padding:24px 22px 20px;box-shadow:0 24px 60px rgba(0,0,0,.28);
           border:1px solid var(--border,rgba(26,26,24,.08));
           font-family:var(--font-sans,system-ui,sans-serif);">
           <h3 style="font-size:15px;font-weight:600;margin:0 0 4px;">Entrar na nuvem</h3>
           <p style="font-size:12.5px;color:var(--ink-soft,#6b6a64);margin:0 0 16px;">
             Use seu e-mail e senha. Se ainda não tem conta, clique em "Criar conta".</p>
           <input class="sb-email" type="email" placeholder="e-mail" autocomplete="username"
             style="width:100%;box-sizing:border-box;font:inherit;font-size:14px;margin-bottom:8px;
             padding:10px 12px;border-radius:10px;outline:none;
             background:var(--bg,#f6f5f1);color:var(--ink,#1a1a18);
             border:1.5px solid var(--border,rgba(26,26,24,.12));">
           <input class="sb-pass" type="password" placeholder="senha" autocomplete="current-password"
             style="width:100%;box-sizing:border-box;font:inherit;font-size:14px;
             padding:10px 12px;border-radius:10px;outline:none;
             background:var(--bg,#f6f5f1);color:var(--ink,#1a1a18);
             border:1.5px solid var(--border,rgba(26,26,24,.12));">
           <p class="sb-msg" style="font-size:12px;min-height:16px;margin:8px 2px 0;color:#e5484d;"></p>
           <div style="display:flex;justify-content:space-between;gap:8px;margin-top:12px;">
             <button class="sb-signup" style="font:inherit;font-size:13px;font-weight:500;cursor:pointer;
               border-radius:9px;padding:9px 14px;background:transparent;color:var(--ink-soft,#6b6a64);
               border:1.5px solid var(--border,rgba(26,26,24,.14));">Criar conta</button>
             <button class="sb-signin" style="font:inherit;font-size:13px;font-weight:500;cursor:pointer;
               border-radius:9px;padding:9px 18px;background:var(--accent,#7c3aed);color:#fff;border:none;">Entrar</button>
           </div>
         </div>`;
   
       document.body.appendChild(overlay);
       const email = overlay.querySelector('.sb-email');
       const pass  = overlay.querySelector('.sb-pass');
       const msg   = overlay.querySelector('.sb-msg');
       const close = () => overlay.remove();
   
       overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });
       overlay.querySelector('.sb-auth-card').addEventListener('pointerdown', (e) => e.stopPropagation());
       requestAnimationFrame(() => email.focus());
   
       const setBusy = (b) => {
         overlay.querySelector('.sb-signin').disabled = b;
         overlay.querySelector('.sb-signup').disabled = b;
       };
       const fail = (t) => { msg.style.color = '#e5484d'; msg.textContent = t; };
       const info = (t) => { msg.style.color = 'var(--ink-soft,#6b6a64)'; msg.textContent = t; };
   
       async function signIn() {
         if (!email.value.trim() || !pass.value) { fail('Preencha e-mail e senha.'); return; }
         setBusy(true); info('Entrando…');
         const { error } = await sb.auth.signInWithPassword({
           email: email.value.trim(), password: pass.value,
         });
         setBusy(false);
         if (error) { fail(traduzErro(error.message)); return; }
         close();   // onAuthStateChange cuida do resto
       }
   
       async function signUp() {
         if (!email.value.trim() || !pass.value) { fail('Preencha e-mail e senha.'); return; }
         if (pass.value.length < 6) { fail('A senha precisa de pelo menos 6 caracteres.'); return; }
         setBusy(true); info('Criando conta…');
         const { data, error } = await sb.auth.signUp({
           email: email.value.trim(), password: pass.value,
         });
         setBusy(false);
         if (error) { fail(traduzErro(error.message)); return; }
         if (data.session) { close(); return; }          // login imediato (confirmação desligada)
         info('Conta criada! Confirme o link enviado ao seu e-mail e depois clique em Entrar.');
       }
   
       overlay.querySelector('.sb-signin').addEventListener('click', signIn);
       overlay.querySelector('.sb-signup').addEventListener('click', signUp);
       pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') signIn(); });
       email.addEventListener('keydown', (e) => { if (e.key === 'Enter') pass.focus(); });
     }
   
     function traduzErro(m = '') {
       const s = m.toLowerCase();
       if (s.includes('invalid login')) return 'E-mail ou senha incorretos.';
       if (s.includes('already registered') || s.includes('already exists')) return 'Esse e-mail já tem conta. Clique em Entrar.';
       if (s.includes('email not confirmed')) return 'E-mail ainda não confirmado. Veja o link no seu e-mail.';
       if (s.includes('password')) return 'Senha inválida (mínimo 6 caracteres).';
       return m;
     }
   
     /* ══════════════ Menu da nuvem (depois de logado) ══════════════ */
     async function openCloudMenu(user) {
       const choice = await chooseModal({
         title: `Nuvem · ${user.email}`,
         options: [
           { value: 'save',   label: '☁  Salvar este canvas na nuvem',  hint: activeName() },
           { value: 'open',   label: '⤓  Abrir um canvas da nuvem',      hint: '' },
           { value: 'logout', label: '⎋  Sair da conta',                 hint: '' },
         ],
       });
       if (choice === 'save')   await saveToCloud();
       if (choice === 'open')   await openFromCloud();
       if (choice === 'logout') await sb.auth.signOut();
     }
   
     /* ══════════════ Mídia pesada → Supabase Storage ══════════════
        Imagens coladas/arrastadas viram base64 gigante e estouram o
        localStorage na volta. Solução: ao salvar, subimos cada base64 pro
        bucket "board-media" e trocamos pelo link público (curto). O JSON do
        quadro fica pequeno e carrega numa boa em qualquer navegador. */
   
     const BUCKET = 'board-media';
   
     function cloneData(obj) {
       try { return structuredClone(obj); }
       catch { return JSON.parse(JSON.stringify(obj)); }
     }
   
     async function uploadDataUrl(userId, dataUrl, cache) {
       if (cache.has(dataUrl)) return cache.get(dataUrl);
       const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
       if (!m) return dataUrl;
       const mime = m[1];
       const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
       // Hash do conteúdo → nome do arquivo (dedup: mesma imagem sobe 1x só).
       const hashBuf = await crypto.subtle.digest('SHA-256', bytes);
       const hash = [...new Uint8Array(hashBuf)]
         .map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
       const ext = (mime.split('/')[1] || 'bin').split('+')[0];
       const path = `${userId}/${hash}.${ext}`;
       const blob = new Blob([bytes], { type: mime });
       const { error } = await sb.storage.from(BUCKET)
         .upload(path, blob, { contentType: mime, upsert: true });
       if (error && !String(error.message || '').toLowerCase().includes('exists')) throw error;
       const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
       cache.set(dataUrl, data.publicUrl);
       return data.publicUrl;
     }
   
     // Percorre todo o JSON e troca base64 por URL do Storage.
     async function externalizeMedia(userId, node, cache) {
       if (typeof node === 'string') {
         if (node.startsWith('data:') && node.includes(';base64,')) {
           return uploadDataUrl(userId, node, cache);
         }
         return node;
       }
       if (Array.isArray(node)) {
         for (let i = 0; i < node.length; i++) node[i] = await externalizeMedia(userId, node[i], cache);
         return node;
       }
       if (node && typeof node === 'object') {
         for (const k of Object.keys(node)) node[k] = await externalizeMedia(userId, node[k], cache);
         return node;
       }
       return node;
     }
   
     async function saveToCloud() {
       try { window.__flushPersistence?.(); } catch {}
       const { data: { user } } = await sb.auth.getUser();
       if (!user) return;
   
       // 1) Sobe a mídia pesada pro Storage (numa cópia — o local segue offline).
       let data;
       try {
         data = await externalizeMedia(user.id, cloneData(activeData()), new Map());
       } catch (err) {
         console.error('[supabase] Falha ao enviar mídia ao Storage:', err);
         alert('Não consegui enviar as imagens para o Storage.\n\n'
           + 'Erro: ' + (err?.message || err) + '\n\n'
           + 'Você já criou o bucket "board-media" (público) no Supabase → Storage? '
           + 'E rodou as políticas de Storage do SQL? (instruções no topo do supabase.js)');
         return;
       }
   
       // 2) Salva o JSON já enxuto (com URLs no lugar do base64).
       const { error } = await sb.from('boards')
         .upsert({
           user_id:    user.id,
           project_id: activeId(),
           name:       activeName(),
           data,
         }, { onConflict: 'user_id,project_id' });
       if (error) alert('Falha ao salvar: ' + error.message);
       else alert('Canvas salvo na nuvem ✓');
     }
   
     async function openFromCloud() {
       const { data, error } = await sb.from('boards')
         .select('project_id,name,updated_at')
         .order('updated_at', { ascending: false });
       if (error) { alert('Falha ao listar: ' + error.message); return; }
       if (!data || !data.length) { alert('Nenhum canvas salvo na nuvem ainda.'); return; }
   
       const pick = await chooseModal({
         title: 'Abrir da nuvem',
         message: 'O conteúdo substituirá o canvas atualmente ativo.',
         options: data.map((b) => ({
           value: b.project_id,
           label: b.name || 'Canvas',
           hint: new Date(b.updated_at).toLocaleDateString('pt-BR'),
         })),
       });
       if (!pick) return;
   
       const { data: full, error: e2 } = await sb.from('boards')
         .select('data').eq('project_id', pick).single();
       if (e2) { alert('Falha ao baixar: ' + e2.message); return; }
   
       const cards = Array.isArray(full?.data?.cards) ? full.data.cards.length : 0;
       const sizeKB = Math.round(JSON.stringify(full?.data || {}).length / 1024);
       console.info('[supabase] baixado da nuvem →', { projeto: pick, cards, tamanho_KB: sizeKB });
   
       if (!full || !full.data || cards === 0) {
         alert('O quadro salvo na nuvem está VAZIO (0 cards). O problema foi no SALVAR, não no abrir. Volte ao quadro original (com conteúdo) e clique em Salvar na nuvem de novo.');
         return;
       }
   
       const ok = await confirmModal({
         title: `Substituir canvas atual? (${cards} cards, ${sizeKB} KB)`,
         message: 'O canvas ativo será substituído pelo da nuvem. Recomendado fazer isso num canvas novo.',
         confirmText: 'Substituir e abrir',
         danger: true,
       });
       if (!ok) return;
   
       // Carrega DIRETO na tela (sem reload), evitando qualquer problema de
       // chave/bootstrap/timing. O loader também persiste no projeto ativo.
       if (typeof window.__loadBoard === 'function') {
         const okLoad = window.__loadBoard(full.data);
         if (okLoad) {
           console.info('[supabase] quadro carregado ao vivo (', cards, 'cards )');
           return;
         }
       }
   
       // Fallback (caso o loader não exista): grava e recarrega.
       let activeProj = activeId();
       try {
         const list = JSON.parse(localStorage.getItem(INDEX_KEY) || '[]');
         if (!activeProj || !list.some((p) => p.id === activeProj)) {
           activeProj = (list[0] && list[0].id) || activeProj;
         }
       } catch {}
   
       const key = DATA_PREFIX + activeProj;
       try {
         const json = JSON.stringify(full.data);
         localStorage.setItem(key, json);
         localStorage.setItem(ACTIVE_KEY, activeProj);
         localStorage.removeItem('whiteboard:seed:' + activeProj);
         if (localStorage.getItem(key) !== json) throw new Error('a escrita nao persistiu');
         console.info('[supabase] gravado em', key, '(', cards, 'cards ) — recarregando');
       } catch (err) {
         console.error('[supabase] Falha ao gravar o canvas no localStorage:', err);
         const quota = err && (err.name === 'QuotaExceededError'
           || err.code === 22 || String(err).toLowerCase().includes('quota'));
         if (quota) {
           alert('Não deu pra abrir: este canvas é grande demais para o armazenamento local do navegador '
             + '(normalmente por causa de imagens, áudio e vídeos embutidos).\n\n'
             + 'Como liberar espaço:\n'
             + '• Abra o painel "projetos" e use "apagar todos os projetos" (ou apague os que não usa);\n'
             + '• depois tente abrir da nuvem de novo, de preferência num canvas novo e vazio.');
         } else {
           alert('Não foi possível abrir o canvas: ' + (err?.message || err));
         }
         return;
       }
       location.reload();
     }
   
     /* ══════════════ Estado de autenticação ══════════════ */
     const { data: { session } } = await sb.auth.getSession();
     render(session?.user || null);
     sb.auth.onAuthStateChange((_ev, sess) => render(sess?.user || null));
   
     window.__cloud = { save: saveToCloud, open: openFromCloud, client: sb };
   }
   
   /* ════════════════════════════════════════════════════════════════════
      SQL PARA CRIAR AS TABELAS (rode no Supabase → SQL Editor)
      ────────────────────────────────────────────────────────────────────
      create table if not exists public.boards (
        id          uuid primary key default gen_random_uuid(),
        user_id     uuid not null references auth.users(id) on delete cascade,
        project_id  text not null,
        name        text not null default 'Canvas',
        data        jsonb not null,
        updated_at  timestamptz not null default now(),
        unique (user_id, project_id)
      );
   
      alter table public.boards enable row level security;
   
      create policy "boards_select_own" on public.boards
        for select using (auth.uid() = user_id);
      create policy "boards_insert_own" on public.boards
        for insert with check (auth.uid() = user_id);
      create policy "boards_update_own" on public.boards
        for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
      create policy "boards_delete_own" on public.boards
        for delete using (auth.uid() = user_id);
   
      create or replace function public.touch_updated_at()
        returns trigger language plpgsql as $$
        begin new.updated_at = now(); return new; end; $$;
   
      drop trigger if exists boards_touch on public.boards;
      create trigger boards_touch before update on public.boards
        for each row execute function public.touch_updated_at();
   
      ─────────────────────────────────────────────────────────────────────
      STORAGE (para as imagens). Passo 1: crie o bucket pelo painel:
        Supabase → Storage → New bucket → nome "board-media" → marque Public.
      (ou rode:  insert into storage.buckets (id, name, public)
                 values ('board-media','board-media', true)
                 on conflict (id) do nothing;  )
   
      Passo 2: políticas de acesso ao Storage (rode no SQL Editor):
   
      create policy "board_media_read" on storage.objects
        for select to public
        using (bucket_id = 'board-media');
   
      create policy "board_media_insert" on storage.objects
        for insert to authenticated
        with check (bucket_id = 'board-media');
   
      create policy "board_media_update" on storage.objects
        for update to authenticated
        using (bucket_id = 'board-media')
        with check (bucket_id = 'board-media');
      ════════════════════════════════════════════════════════════════════ */