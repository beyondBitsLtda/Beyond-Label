/* ════════════════════════════════════════════════════════════════════
   collab.js — Colaboração em tempo real (WebRTC P2P via Yjs)
   ────────────────────────────────────────────────────────────────────
   MODELO MENTAL
     · A "fonte da verdade" da colaboração é um Y.Doc (CRDT do Yjs).
       Ele resolve automaticamente conflitos de edição simultânea —
       é por isso que escolhemos Yjs em vez de "último a escrever vence".
     · O Y.Doc é sincronizado entre navegadores via WebRTC (y-webrtc),
       ponto-a-ponto, sem servidor próprio. Servidores públicos de
       sinalização cuidam só do handshake inicial.
     · Estruturas no Y.Doc:
         - ymap  (Y.Map)   : cardId → { type, x, y, width, content, ... }
         - ystrokes (Y.Array): lista de strokes de desenho
         - awareness        : cursores + nomes dos participantes
     · DOIS fluxos, cada um com guarda contra ECO:
         DOM → Yjs : mudanças locais (mover/editar/criar/apagar/desenhar)
                     viram operações no Y.Doc.
         Yjs → DOM : mudanças vindas de peers são aplicadas no DOM.
       A flag `applyingRemote` impede que aplicar uma mudança remota
       dispare um novo envio (loop infinito).

   ATIVAÇÃO
     · A colab só liga se a URL tiver `#room=<id>`. Sem isso, o app
       funciona 100% local como antes (zero overhead).
     · Botão "colaborar" no HUD gera um link com room e copia.

   ESCOPO DESTA ETAPA: cards (criar/mover/editar/apagar) + desenho +
   cursores. Stickers e frames ficam para a próxima iteração.
   ════════════════════════════════════════════════════════════════════ */

   import * as Y from 'https://esm.sh/yjs@13.6.18';
   import { SupabaseProvider } from './collab-supabase.js';
   import { createCard, createShell } from './cards.js';
   import { getConnections, loadConnections } from './connections.js';
   import { restoreStroke } from './drawing.js';
   import { screenToWorld } from './canvas.js';
   
   /* ────────────────────────────────────────────────────────────────────
      0) Só ativa se houver #room= na URL
      ──────────────────────────────────────────────────────────────────── */
   
   function getRoomFromURL() {
     const m = location.hash.match(/room=([A-Za-z0-9_-]+)/);
     return m ? m[1] : null;
   }
   
   const ROOM = getRoomFromURL();
   
   /* Expõe utilitários globais para o HUD (botão colaborar). */
   window.__collab = {
     isActive: () => !!ROOM,
     getShareLink: () => {
       const id = ROOM || genRoomId();
       const url = new URL(location.href);
       url.hash = `room=${id}`;
       return url.toString();
     },
     start: () => {
       // Inicia uma sessão nova: gera room, coloca no hash e recarrega.
       const id = genRoomId();
       // Marca que EU sou o host desta sala → só eu semeio o quadro atual.
       sessionStorage.setItem('collab:host', id);
       const url = new URL(location.href);
       url.hash = `room=${id}`;
       location.href = url.toString();
       location.reload();
     },
   };
   
   function genRoomId() {
     return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);
   }
   
   // Se não há sala, não fazemos NADA — app roda local normalmente.
   if (!ROOM) {
     console.log('[collab] sem #room na URL — modo local (sem colaboração)');
   } else {
     initCollab(ROOM);
   }
   
   /* ════════════════════════════════════════════════════════════════════
      1) Inicialização da sessão colaborativa
      ════════════════════════════════════════════════════════════════════ */
   
   function initCollab(room) {
     console.log('[collab] iniciando sessão na sala:', room);
   
     const world = document.getElementById('world');
     const drawLayer = document.getElementById('draw-layer');

     /* ── Sou HOST (iniciei a sala) ou CONVIDADO (entrei pelo link)? ── */
     const isHost = sessionStorage.getItem('collab:host') === room;

     /* CONVIDADO: limpa o canvas local ANTES de conectar, para não fundir
        com o quadro do host. persist=false → NÃO sobrescreve o projeto
        salvo do convidado. O quadro do host chega pela sincronização. */
     if (!isHost && typeof window.__loadBoard === 'function') {
       window.__loadBoard({}, false);
       console.log('[collab] convidado — canvas limpo para receber o quadro do host');
     }
   
     /* ── Y.Doc e estruturas compartilhadas ── */
     const ydoc = new Y.Doc();
     const ycards   = ydoc.getMap('cards');     // cardId → objeto do card
     const ystrokes = ydoc.getArray('strokes'); // strokes de desenho
     const yconns   = ydoc.getMap('connections');// connId → objeto da conexão
   
     /* ── Provider WebRTC ──
        signaling: servidores públicos de sinalização (só handshake).
        password: a própria sala como senha leve (não é segurança forte,
        só evita colisão acidental de salas com mesmo id).               */
     const provider = new SupabaseProvider(`whiteboard-${room}`, ydoc);
   
     const awareness = provider.awareness;
   
     /* Guarda anti-eco: quando true, mudanças no DOM NÃO são reenviadas
        (porque elas vieram de um peer e estamos só aplicando).          */
     let applyingRemote = false;
   
     /* ──────────────────────────────────────────────────────────────────
        2) Identidade do participante (nome + cor)
        ────────────────────────────────────────────────────────────────── */
     const myName = promptName();
     const myColor = pickColor();
     awareness.setLocalStateField('user', { name: myName, color: myColor });

     /* Assim que o cliente Supabase estiver pronto, usa o nome do usuário
        LOGADO (prefixo do e-mail) no cursor — em vez de um nome digitado. */
     if (window.__supabaseReady) {
       window.__supabaseReady.then(async (sb) => {
         if (!sb) return;
         try {
           const { data: { user } } = await sb.auth.getUser();
           const nm = user?.email ? user.email.split('@')[0] : null;
           if (nm) {
             localStorage.setItem('collab:name', nm);
             awareness.setLocalStateField('user', { name: nm, color: myColor });
           }
         } catch (e) {}
       });
     }
   
     function promptName() {
       // Não interrompe com prompt(): usa o nome em cache ou um provisório.
       // O nome REAL (do usuário logado no Supabase) é aplicado logo abaixo,
       // de forma assíncrona, assim que o cliente estiver disponível.
       return localStorage.getItem('collab:name') || 'Convidado';
     }
     function pickColor() {
       const colors = ['#CC0F10', '#2362D3', '#FF6B05', '#0B861D', '#7A3FF2', '#E8A400'];
       return colors[Math.floor(Math.random() * colors.length)];
     }
   
     /* ══════════════════════════════════════════════════════════════════
        3) CARDS — DOM ⇄ Yjs
        ══════════════════════════════════════════════════════════════════ */
   
     /* Garante que todo card tenha um id estável compartilhável. */
     function ensureCardId(cardEl) {
       if (!cardEl.dataset.collabId) {
         cardEl.dataset.collabId = 'c_' + Math.random().toString(36).slice(2, 10);
       }
       return cardEl.dataset.collabId;
     }
   
     /* Serializa um card do DOM para um objeto simples (igual à lógica
        do persistence, mas inline para não acoplar). */
     function serializeCardEl(cardEl) {
       // Usa a serialização COMPLETA do persistence.js (todos os tipos).
       if (typeof window.__serializeCardEl === 'function') {
         try {
           const full = window.__serializeCardEl(cardEl);
           if (full) {
             full.z = parseFloat(cardEl.style.zIndex) || 1;
             return full;
           }
         } catch (e) {}
       }
       // Fallback antigo (só note/code) caso o global não exista.
       const type = [...cardEl.classList].find((c) => c.startsWith('card--'))?.slice(6);
       if (!type) return null;
       const obj = {
         type,
         x: parseFloat(cardEl.style.left) || 0,
         y: parseFloat(cardEl.style.top)  || 0,
         width: parseFloat(cardEl.style.width) || null,
         z: parseFloat(cardEl.style.zIndex) || 1,
       };
       if (type === 'note') {
         obj.content = cardEl.querySelector('.card__note')?.textContent || '';
       } else if (type === 'code') {
         const codeEl = cardEl.querySelector('.card__code');
         obj.content  = codeEl?.dataset.raw || codeEl?.textContent || '';
         obj.language = cardEl.querySelector('.card__lang')?.value || 'javascript';
       }
       return obj;
     }
   
     /* Empurra o estado de um card para o Y.Map (DOM → Yjs). */
     function pushCard(cardEl) {
       if (applyingRemote) return;
       const id = ensureCardId(cardEl);
       const obj = serializeCardEl(cardEl);
       if (obj) ycards.set(id, obj);
     }
   
     /* Aplica um objeto de card vindo do Yjs no DOM (Yjs → DOM).
        Se o card já existe, atualiza; senão, cria.                      */
     function applyCardFromY(id, obj) {
       if (!obj) return;
       let cardEl = world.querySelector(`[data-collab-id="${id}"]`);
   
       if (!cardEl) {
         // Cria via serialização COMPLETA (todos os tipos). silent evita foco.
         applyingRemote = true;
         try {
           if (typeof window.__restoreCardData === 'function') {
             cardEl = window.__restoreCardData(obj);
           } else if (obj.type === 'note' || obj.type === 'code') {
             cardEl = createCard({
               type: obj.type, x: obj.x, y: obj.y, width: obj.width,
               content: obj.content, language: obj.language, silent: true,
             });
           }
           if (!cardEl) return;                 // tipo sem factory: ignora
           cardEl.dataset.collabId = id;
           if (obj.z) cardEl.style.zIndex = obj.z;
           if (obj.type === 'youtube') {
             console.log('[collab] recebido YOUTUBE — url:', obj.url || '(vazio!)',
               '· iframe criado:', !!cardEl.querySelector('.card__yt-iframe'));
           }
         } finally { applyingRemote = false; }
         return;
       }
   
       // Já existe: atualiza posição/tamanho/conteúdo sem recriar.
       applyingRemote = true;
       try {
         cardEl.style.left = `${obj.x}px`;
         cardEl.style.top  = `${obj.y}px`;
         if (obj.width) cardEl.style.width = `${obj.width}px`;
         if (obj.z) cardEl.style.zIndex = obj.z;
   
         if (obj.type === 'note') {
           const body = cardEl.querySelector('.card__note');
           // Só atualiza se o texto mudou E o usuário não está editando ESTE card.
           if (body && body.textContent !== obj.content && document.activeElement !== body) {
             body.textContent = obj.content;
           }
         } else if (obj.type === 'code') {
           const codeEl = cardEl.querySelector('.card__code');
           if (codeEl && document.activeElement !== codeEl) {
             if ((codeEl.dataset.raw || '') !== obj.content) {
               codeEl.dataset.raw = obj.content;
               codeEl.textContent = obj.content;  // re-highlight ocorre no blur normal
             }
           }
         }
       } finally { applyingRemote = false; }
     }
   
     /* Remove do DOM um card que sumiu do Y.Map. */
     function removeCardFromDOM(id) {
       const cardEl = world.querySelector(`[data-collab-id="${id}"]`);
       if (cardEl) {
         applyingRemote = true;
         try { cardEl.remove(); } finally { applyingRemote = false; }
       }
     }
   
     /* ── Observa o Y.Map: aplica mudanças de peers no DOM ── */
     ycards.observe((event) => {
       event.changes.keys.forEach((change, id) => {
         if (change.action === 'add' || change.action === 'update') {
           applyCardFromY(id, ycards.get(id));
         } else if (change.action === 'delete') {
           removeCardFromDOM(id);
         }
       });
     });
   
     /* ── Detecta mudanças LOCAIS no DOM e empurra pro Yjs ── */
   
     // (a) Card criado ou removido (MutationObserver no #world).
     new MutationObserver((muts) => {
       if (applyingRemote) return;
       for (const m of muts) {
         m.addedNodes.forEach((n) => {
           if (n.classList?.contains('card')) {
             // Atraso de 1 frame para o card ter conteúdo/layout.
             requestAnimationFrame(() => pushCard(n));
           }
         });
         m.removedNodes.forEach((n) => {
           if (n.classList?.contains('card') && n.dataset.collabId) {
             if (!applyingRemote) ycards.delete(n.dataset.collabId);
           }
         });
       }
     }).observe(world, { childList: true });
   
     // (b) Card movido (evento custom 'cardmoved' já existe em cards.js).
     document.addEventListener('cardmoved', (e) => {
       if (applyingRemote) return;
       const card = e.target.closest?.('.card');
       if (card) pushCard(card);
     });
   
     // (c) Texto editado (input em note/code).
     let inputDebounce = null;
     document.addEventListener('input', (e) => {
       if (applyingRemote) return;
       const card = e.target.closest?.('.card');
       if (!card) return;
       clearTimeout(inputDebounce);
       inputDebounce = setTimeout(() => pushCard(card), 250);
     });
   
     // (d) Blur do code card (raw muda no blur) — garante envio final.
     document.addEventListener('blur', (e) => {
       if (applyingRemote) return;
       const card = e.target.closest?.('.card');
       if (card) pushCard(card);
     }, true);

     /* ── Semeadura inicial ──
        Se EU iniciei a sessão (host), empurro o quadro atual para o doc
        compartilhado. Quem entra pelo link depois recebe tudo via sync.
        O convidado NÃO semeia (evita misturar os dois quadros) — por isso
        recomende que ele abra o link num canvas novo/vazio. */
     /* ══════════════════════════════════════════════════════════════════
        CONEXÕES (setas) — DOM ⇄ Yjs
        ──────────────────────────────────────────────────────────────────
        connections.js dispara 'connectionschanged' a cada mudança e expõe
        getConnections()/loadConnections(). Espelhamos a lista inteira no
        Y.Map yconns (por id). Como são poucas, sincronizar tudo é simples
        e robusto. ══════════════════════════════════════════════════════ */

     function pushAllConnections() {
       if (applyingRemote) return;
       const conns = getConnections() || [];
       const ids = new Set(conns.map((c) => c.id));
       yconns.forEach((_v, id) => { if (!ids.has(id)) yconns.delete(id); });
       conns.forEach((c) => { yconns.set(c.id, c); });
     }

     let connDebounce = null;
     document.addEventListener('connectionschanged', () => {
       if (applyingRemote) return;
       clearTimeout(connDebounce);
       connDebounce = setTimeout(pushAllConnections, 120);
     });

     yconns.observe(() => {
       if (applyingRemote) return;
       applyingRemote = true;
       try { loadConnections(Array.from(yconns.values())); }
       catch (e) { console.warn('[collab] aplicar conexões', e); }
       finally { applyingRemote = false; }
     });

     if (isHost) {
       sessionStorage.removeItem('collab:host');
       setTimeout(() => {
         const cards = world.querySelectorAll('.card');
         const tipos = {};
         cards.forEach((card) => {
           try {
             pushCard(card);
             const t = [...card.classList].find((c) => c.startsWith('card--'))?.slice(6) || '?';
             tipos[t] = (tipos[t] || 0) + 1;
             if (t === 'youtube') {
               const yt = card.querySelector('.card__yt-iframe');
               console.log('[collab] semeando YOUTUBE — src:', yt?.src || '(sem iframe / vazio)');
             }
           } catch (e) {}
         });
         pushAllConnections();
         console.log('[collab] host — semeado por tipo:', tipos, '+', yconns.size, 'conexões');
       }, 900);
     }
   
     /* ══════════════════════════════════════════════════════════════════
        4) DESENHO — DOM ⇄ Yjs
        ──────────────────────────────────────────────────────────────────
        Estratégia: cada stroke finalizado é serializado e empurrado para
        o Y.Array. Não sincronizamos o traço EM PROGRESSO (cada ponto) —
        seria pesado demais para WebRTC; sincronizamos o stroke completo
        ao terminar. Peers recebem e reconstroem via restoreStroke().
   
        Cada stroke ganha um id no elemento SVG (data-collab-id) para
        correlacionar e evitar duplicação.
        ══════════════════════════════════════════════════════════════════ */
   
     function serializeStrokeEl(el) {
       const pts = el._points;
       if (!pts || !pts.length) return null;
       const kind = el.tagName.toLowerCase();
       return {
         id: el.dataset.collabId || ('s_' + Math.random().toString(36).slice(2, 10)),
         kind,
         points: pts.map((p) => [p.x, p.y]),
         color: kind === 'circle' ? el.getAttribute('fill') : el.getAttribute('stroke'),
         size:  kind === 'circle'
                 ? parseFloat(el.getAttribute('r')) * 2
                 : parseFloat(el.getAttribute('stroke-width')) || 2,
       };
     }
   
     function pushStroke(el) {
       if (applyingRemote) return;
       const data = serializeStrokeEl(el);
       if (!data) return;
       el.dataset.collabId = data.id;
       ystrokes.push([data]);
     }
   
     function removeStrokeFromY(el) {
       if (applyingRemote || !el.dataset.collabId) return;
       const id = el.dataset.collabId;
       for (let i = 0; i < ystrokes.length; i++) {
         if (ystrokes.get(i)?.id === id) { ystrokes.delete(i, 1); break; }
       }
     }
   
     /* Observa Y.Array de strokes: reconstrói os que chegaram de peers. */
     ystrokes.observe((event) => {
       if (applyingRemote) return;
       event.changes.added.forEach((item) => {
         item.content.getContent().forEach((data) => {
           // Já existe localmente? (eco do nosso próprio push) → pula.
           if (drawLayer.querySelector(`[data-collab-id="${data.id}"]`)) return;
           applyingRemote = true;
           try {
             const el = restoreStroke({
               kind: data.kind, points: data.points,
               color: data.color, size: data.size,
             });
             if (el) el.dataset.collabId = data.id;
           } finally { applyingRemote = false; }
         });
       });
       // Strokes removidos por peers (borracha): remove do DOM.
       event.changes.deleted.forEach(() => {
         // Reconciliação: remove do DOM strokes que não estão mais no array.
         const liveIds = new Set();
         for (let i = 0; i < ystrokes.length; i++) {
           const d = ystrokes.get(i);
           if (d?.id) liveIds.add(d.id);
         }
         [...drawLayer.children].forEach((el) => {
           const id = el.dataset.collabId;
           if (id && !liveIds.has(id)) {
             applyingRemote = true;
             try { el.remove(); } finally { applyingRemote = false; }
           }
         });
       });
     });
   
     /* Detecta strokes novos/removidos no draw-layer (MutationObserver). */
     new MutationObserver((muts) => {
       if (applyingRemote) return;
       for (const m of muts) {
         m.addedNodes.forEach((n) => {
           if (n._points) requestAnimationFrame(() => pushStroke(n));
         });
         m.removedNodes.forEach((n) => {
           if (n.dataset?.collabId) removeStrokeFromY(n);
         });
       }
     }).observe(drawLayer, { childList: true });
   
     /* ══════════════════════════════════════════════════════════════════
        5) CURSORES — Awareness
        ══════════════════════════════════════════════════════════════════ */
   
     const cursorLayer = document.createElement('div');
     cursorLayer.className = 'collab-cursors';
     document.body.appendChild(cursorLayer);
   
     // Reporta posição do meu cursor em coordenadas do MUNDO.
     let cursorThrottle = null;
     document.addEventListener('pointermove', (e) => {
       if (cursorThrottle) return;
       cursorThrottle = setTimeout(() => { cursorThrottle = null; }, 40);
       const w = screenToWorld(e.clientX, e.clientY);
       awareness.setLocalStateField('cursor', { x: w.x, y: w.y });
     });
   
     // Renderiza cursores dos OUTROS participantes.
     awareness.on('change', () => {
       const states = awareness.getStates();
       const seen = new Set();
       states.forEach((state, clientId) => {
         if (clientId === awareness.clientID) return;   // não desenha o próprio
         const user = state.user;
         const cur = state.cursor;
         if (!user || !cur) return;
         seen.add(clientId);
         let el = cursorLayer.querySelector(`[data-cid="${clientId}"]`);
         if (!el) {
           el = document.createElement('div');
           el.className = 'collab-cursor';
           el.dataset.cid = clientId;
           el.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16"><path d="M2 2l5 12 2-5 5-2L2 2z" fill="${user.color}"/></svg><span class="collab-cursor__name" style="background:${user.color}">${escapeHTML(user.name)}</span>`;
           cursorLayer.appendChild(el);
         }
         // Converte mundo → tela para posicionar (lê transform atual).
         const screen = worldToScreen(cur.x, cur.y);
         el.style.transform = `translate(${screen.x}px, ${screen.y}px)`;
       });
       // Remove cursores de quem saiu.
       cursorLayer.querySelectorAll('.collab-cursor').forEach((el) => {
         if (!seen.has(Number(el.dataset.cid))) el.remove();
       });
     });
   
     /* Converte coordenada do mundo → tela usando o transform do #world. */
     function worldToScreen(wx, wy) {
       const t = world.style.transform;
       const tr = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(t);
       const sc = /scale\(([-\d.]+)\)/.exec(t);
       const tx = tr ? parseFloat(tr[1]) : 0;
       const ty = tr ? parseFloat(tr[2]) : 0;
       const z  = sc ? parseFloat(sc[1]) : 1;
       return { x: wx * z + tx, y: wy * z + ty };
     }
   
     /* ══════════════════════════════════════════════════════════════════
        6) Estado de conexão + indicador no HUD
        ══════════════════════════════════════════════════════════════════ */
   
     const badge = document.createElement('div');
     badge.className = 'collab-badge';
     badge.innerHTML = `
       <span class="collab-badge__dot"></span>
       <span class="collab-badge__text">conectando…</span>
       <span class="collab-badge__peers">0</span>
     `;
     document.body.appendChild(badge);
   
     function updateBadge() {
       const peers = awareness.getStates().size - 1;  // exclui você
       const connected = provider.connected;
       badge.classList.toggle('is-connected', connected);
       badge.querySelector('.collab-badge__text').textContent =
         connected ? 'colaborando' : 'conectando…';
       badge.querySelector('.collab-badge__peers').textContent = String(Math.max(0, peers));
     }
     provider.on('status', updateBadge);
     awareness.on('change', updateBadge);
     setTimeout(updateBadge, 1000);
   
     /* ── Ao entrar, aplica o estado que já veio dos peers. NÃO empurra
          os cards locais aqui: só o HOST semeia (via flag collab:host,
          mais acima). Isso evita a "mistura" dos dois quadros quando o
          convidado entra com conteúdo próprio na tela. ── */
     setTimeout(() => {
       ycards.forEach((obj, id) => applyCardFromY(id, obj));
     }, 800);
   
     console.log('[collab] sessão pronta. Nome:', myName);
   
     function escapeHTML(s) {
       return String(s).replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
     }
   }