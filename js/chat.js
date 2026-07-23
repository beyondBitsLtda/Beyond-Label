/* ════════════════════════════════════════════════════════════════════
   chat.js — Chat de texto do quadro (durante a colaboração)
   ────────────────────────────────────────────────────────────────────
   Independente do collab.js. Só liga quando há #room= na URL (ou seja,
   numa sessão de colaboração). Usa o Supabase Realtime (mesmo Realtime
   da colaboração), num canal próprio 'chat:<room>'.

   • Mensagens são efêmeras (não ficam salvas) — é um chat da sessão.
   • O nome do remetente vem do usuário logado (prefixo do e-mail).
   • Botão flutuante + painel; badge de não lidas quando fechado.
   ════════════════════════════════════════════════════════════════════ */

   (function () {
    function roomFromURL() {
      const m = location.hash.match(/room=([A-Za-z0-9_-]+)/);
      return m ? m[1] : null;
    }
    const ROOM = roomFromURL();
    if (!ROOM) return;   // sem sala → sem chat (app roda normal)
  
    let sb = null;
    let channel = null;
    let myName = 'Convidado';
    let open = false;
    let unread = 0;
  
    injectStyles();
    const { btn, panel, list, input, badge } = buildUI();
  
    init();
  
    async function init() {
      // Nome do usuário logado (se houver).
      if (window.__supabaseReady) {
        try {
          const client = await window.__supabaseReady;
          if (client) {
            sb = client;
            const { data: { user } } = await client.auth.getUser();
            if (user?.email) myName = user.email.split('@')[0];
          }
        } catch (e) {}
      }
      if (!sb) {
        // Sem Supabase configurado: mostra aviso discreto e não conecta.
        addSystem('Chat indisponível (Supabase não configurado).');
        return;
      }
  
      channel = sb.channel('chat:' + ROOM, { config: { broadcast: { self: false } } });
      channel.on('broadcast', { event: 'msg' }, ({ payload }) => {
        addMessage(payload.name, payload.text, payload.ts, false);
      });
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') addSystem('Conectado ao chat da sessão.');
      });
    }
  
    function send() {
      const text = input.value.trim();
      if (!text) return;
      const ts = Date.now();
      input.value = '';
      addMessage(myName, text, ts, true);          // mostra a minha na hora
      if (channel) {
        channel.send({ type: 'broadcast', event: 'msg', payload: { name: myName, text, ts } });
      }
    }
  
    /* ─────────── UI ─────────── */
    function buildUI() {
      const btn = el('button', 'wb-chat-btn');
      btn.title = 'Chat da colaboração';
      btn.innerHTML = chatIcon() + '<span class="wb-chat-badge" hidden>0</span>';
      document.body.appendChild(btn);
  
      const panel = el('div', 'wb-chat-panel');
      panel.hidden = true;
      panel.innerHTML = `
        <div class="wb-chat-head">
          <span>Chat da sessão</span>
          <button class="wb-chat-close" title="Fechar">✕</button>
        </div>
        <div class="wb-chat-list"></div>
        <div class="wb-chat-input">
          <input type="text" placeholder="mensagem…" maxlength="500">
          <button class="wb-chat-send" title="Enviar">➤</button>
        </div>
      `;
      document.body.appendChild(panel);
  
      const list  = panel.querySelector('.wb-chat-list');
      const input = panel.querySelector('.wb-chat-input input');
      const badge = btn.querySelector('.wb-chat-badge');
  
      btn.addEventListener('click', toggle);
      panel.querySelector('.wb-chat-close').addEventListener('click', toggle);
      panel.querySelector('.wb-chat-send').addEventListener('click', send);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  
      return { btn, panel, list, input, badge };
    }
  
    function toggle() {
      open = !open;
      panel.hidden = !open;
      btn.classList.toggle('is-open', open);
      if (open) {
        unread = 0;
        badge.hidden = true;
        badge.textContent = '0';
        setTimeout(() => input.focus(), 30);
        list.scrollTop = list.scrollHeight;
      }
    }
  
    function addMessage(name, text, ts, mine) {
      const row = el('div', 'wb-chat-msg' + (mine ? ' is-mine' : ''));
      const time = new Date(ts || Date.now()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      row.innerHTML = `
        <div class="wb-chat-meta"><b>${esc(name)}</b> <span>${time}</span></div>
        <div class="wb-chat-text">${esc(text)}</div>`;
      list.appendChild(row);
      list.scrollTop = list.scrollHeight;
      if (!open && !mine) {
        unread++;
        badge.textContent = String(unread);
        badge.hidden = false;
      }
    }
  
    function addSystem(text) {
      const row = el('div', 'wb-chat-sys');
      row.textContent = text;
      list.appendChild(row);
      list.scrollTop = list.scrollHeight;
    }
  
    /* ─────────── helpers ─────────── */
    function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
    function esc(s) {
      return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }
    function chatIcon() {
      return '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h11A1.5 1.5 0 0 1 17 4.5v8A1.5 1.5 0 0 1 15.5 14H8l-3.5 3v-3H4.5A1.5 1.5 0 0 1 3 12.5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    }
  
    function injectStyles() {
      if (document.getElementById('wb-chat-styles')) return;
      const s = document.createElement('style');
      s.id = 'wb-chat-styles';
      s.textContent = `
        .wb-chat-btn{position:fixed;left:16px;bottom:120px;z-index:9000;width:44px;height:44px;
          border-radius:50%;border:1px solid var(--border,rgba(26,26,24,.12));
          background:var(--bg-elevated,#fff);color:var(--ink,#1a1a18);cursor:pointer;
          box-shadow:0 6px 18px rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center;
          transition:transform .12s, background .12s;}
        .wb-chat-btn:hover{transform:translateY(-2px);}
        .wb-chat-btn.is-open{background:var(--accent,#7c3aed);color:#fff;border-color:transparent;}
        .wb-chat-badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 5px;
          border-radius:9px;background:#e5484d;color:#fff;font:600 11px/18px var(--font-sans,sans-serif);
          text-align:center;}
        .wb-chat-panel{position:fixed;left:16px;bottom:174px;z-index:9000;width:300px;max-width:calc(100vw - 32px);
          height:380px;max-height:60vh;display:flex;flex-direction:column;
          background:var(--bg-elevated,#fff);color:var(--ink,#1a1a18);
          border:1px solid var(--border,rgba(26,26,24,.12));border-radius:14px;overflow:hidden;
          box-shadow:0 18px 44px rgba(0,0,0,.28);font-family:var(--font-sans,system-ui,sans-serif);}
        .wb-chat-head{display:flex;align-items:center;justify-content:space-between;padding:11px 13px;
          font-size:13px;font-weight:600;border-bottom:1px solid var(--line,rgba(26,26,24,.08));}
        .wb-chat-close{border:0;background:transparent;color:var(--ink-soft,#6b6a64);cursor:pointer;font-size:14px;}
        .wb-chat-list{flex:1;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:9px;}
        .wb-chat-msg{max-width:85%;}
        .wb-chat-msg.is-mine{align-self:flex-end;text-align:right;}
        .wb-chat-meta{font-size:10.5px;color:var(--ink-faint,#b8b6ad);margin-bottom:2px;}
        .wb-chat-meta b{color:var(--ink-soft,#6b6a64);font-weight:600;}
        .wb-chat-text{display:inline-block;background:var(--bg,#f2f1ec);padding:7px 10px;border-radius:10px;
          font-size:13px;line-height:1.4;word-break:break-word;white-space:pre-wrap;}
        .wb-chat-msg.is-mine .wb-chat-text{background:var(--accent-soft,rgba(124,58,237,.14));}
        .wb-chat-sys{font-size:11px;color:var(--ink-faint,#b8b6ad);text-align:center;font-style:italic;}
        .wb-chat-input{display:flex;gap:6px;padding:9px 10px;border-top:1px solid var(--line,rgba(26,26,24,.08));}
        .wb-chat-input input{flex:1;font:inherit;font-size:13px;padding:9px 11px;border-radius:9px;outline:none;
          background:var(--bg,#f6f5f1);color:var(--ink,#1a1a18);border:1.5px solid var(--border,rgba(26,26,24,.12));}
        .wb-chat-input input:focus{border-color:var(--accent,#7c3aed);}
        .wb-chat-send{border:0;background:var(--accent,#7c3aed);color:#fff;border-radius:9px;padding:0 13px;cursor:pointer;font-size:14px;}
      `;
      document.head.appendChild(s);
    }
  })();