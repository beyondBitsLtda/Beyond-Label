/* ════════════════════════════════════════════════════════════════════
   storyboard.js — Frames + Lente do Diretor + CONTENÇÃO FÍSICA
   ────────────────────────────────────────────────────────────────────
   Fixes desta versão:
     · Snap SÓ acontece quando o CARD se move (não quando o frame é
       arrastado por cima de outros cards). Antes, mover um frame
       "engolia" tudo que ele encostava — errado.
     · Cards contidos ganham um botão "↗" no handle pra soltar do
       frame. Ao clicar, o card volta pra posição atual em coordenadas
       de mundo, sem saltar visualmente.
     · Ao apagar um frame (X do handle), os cards contidos são
       devolvidos ao mundo primeiro — antes eram apagados junto.
   ════════════════════════════════════════════════════════════════════ */

   import { createShell } from './cards.js';
   import { panTo, screenToWorld, getScale } from './canvas.js';
   
   const world = document.getElementById('world');
   
   /* ────── Presets de proporção ────── */
   const PRESETS = {
     '9:16': { w: 270, bodyH: 480, label: 'Mobile · 9:16' },
     '16:9': { w: 480, bodyH: 270, label: 'YouTube · 16:9' },
     '1:1':  { w: 360, bodyH: 360, label: 'Quadrado · 1:1' },
   };
   
   /* ────── Criação de frame ────── */
   export function createFrame({ x, y, ratio = '9:16', label = '', cardId } = {}) {
     const p = PRESETS[ratio] || PRESETS['9:16'];
     const card = createShell({ type: 'frame', label: p.label, x, y, width: p.w, cardId });
     card.dataset.ratio = ratio;
     card.id = 'f_' + Math.random().toString(36).slice(2, 9);
   
     const body = document.createElement('div');
     body.className = 'card__frame';
     body.style.minHeight = `${p.bodyH}px`;
     body.innerHTML = `
       <div class="card__frame-number"></div>
       <div class="card__frame-ratio">${ratio}</div>
       <div class="card__frame-contents"></div>
       <div class="card__frame-label"
            contenteditable="true"
            spellcheck="false"
            data-placeholder="descreva a cena…"></div>
     `;
     card.appendChild(body);
   
     if (label) body.querySelector('.card__frame-label').textContent = label;
   
     body.querySelector('.card__frame-label')
         .addEventListener('pointerdown', (e) => e.stopPropagation());
   
     /* Ao apagar o frame, devolve cards contidos ao mundo primeiro. */
     const closeBtn = card.querySelector('.card__close');
     if (closeBtn) {
       /* Insere handler ANTES do que já existe em cards.js. */
       const originalCloseHandler = closeBtn.onclick;
       closeBtn.addEventListener('click', (e) => {
         const contents = card.querySelector('.card__frame-contents');
         if (contents) {
           [...contents.children].forEach((child) => detachToWorld(child));
         }
       }, true);
     }
   
     queueMicrotask(updateFrameNumbers);
     return card;
   }
   
   /* ────── Ordem dos frames (numeração) ────── */
   function getOrderedFrames() {
     const frames = [...document.querySelectorAll('.card--frame')];
     return frames.sort((a, b) => {
       const ax = parseFloat(a.style.left) || 0;
       const ay = parseFloat(a.style.top)  || 0;
       const bx = parseFloat(b.style.left) || 0;
       const by = parseFloat(b.style.top)  || 0;
       const dy = ay - by;
       if (Math.abs(dy) > 200) return dy;
       return ax - bx;
     });
   }
   
   function updateFrameNumbers() {
     const ordered = getOrderedFrames();
     ordered.forEach((f, i) => {
       const num = f.querySelector('.card__frame-number');
       if (num) num.textContent = String(i + 1).padStart(2, '0');
     });
     const counter = document.getElementById('sb-count');
     if (counter) counter.textContent = ordered.length
       ? `${ordered.length} cena${ordered.length > 1 ? 's' : ''}`
       : '';
   }
   
   /* ─── CONTAINMENT — attach / detach ─── */
   
   function attachToFrame(card, frame) {
     const contents = frame.querySelector('.card__frame-contents');
     if (!contents) return;
     card.style.removeProperty('left');
     card.style.removeProperty('top');
     card.style.removeProperty('width');
     card.style.removeProperty('z-index');
     card.dataset.frameId = frame.id;
     if (card.parentElement !== contents) contents.appendChild(card);
   
     /* 🎯 Injeta botão "↗" (soltar do frame) no handle, se ainda não existe. */
     ensureDetachButton(card);
   }
   
   function detachToWorld(card) {
     const rect = card.getBoundingClientRect();
     const tl = screenToWorld(rect.left, rect.top);
     const z  = getScale();
     card.style.left  = `${tl.x}px`;
     card.style.top   = `${tl.y}px`;
     card.style.width = `${rect.width / z}px`;
     delete card.dataset.frameId;
     world.appendChild(card);
   
     /* Remove o botão de detach agora que voltou ao mundo. */
     const btn = card.querySelector('.card__detach-frame');
     if (btn) btn.remove();
   }
   
   /* ─── Botão "soltar do frame" no handle do card contido ─── */
   function ensureDetachButton(card) {
     const handle = card.querySelector('.card__handle');
     if (!handle) return;
     if (handle.querySelector('.card__detach-frame')) return;
   
     const btn = document.createElement('button');
     btn.type = 'button';
     btn.className = 'card__detach-frame';
     btn.title = 'Soltar do frame';
     btn.setAttribute('aria-label', 'Soltar do frame');
     btn.innerHTML = '↗';
     /* pointerdown parado pra não iniciar drag do card. */
     btn.addEventListener('pointerdown', (e) => e.stopPropagation());
     btn.addEventListener('click', (e) => {
       e.stopPropagation();
       detachToWorld(card);
       card.dispatchEvent(new CustomEvent('cardmoved', { bubbles: true }));
     });
   
     /* Insere ANTES do botão X (que já existe no handle via cards.js). */
     const closeBtn = handle.querySelector('.card__close');
     if (closeBtn) handle.insertBefore(btn, closeBtn);
     else          handle.appendChild(btn);
   }
   
   /* Listener de CAPTURA: mantido pro caso de arrastar card pra fora do
      frame. Ao iniciar drag em um card CONTIDO, destaca-o pro mundo
      antes do handler de drag em cards.js começar. Isso preserva a UX
      antiga "arrastar pra fora funciona" pra quem descobre por acidente. */
   document.addEventListener('pointerdown', (e) => {
     if (e.button !== 0) return;
     const handle = e.target.closest?.('[data-drag-handle]');
     if (!handle) return;
     if (e.target.closest('.card__close')) return;
     if (e.target.closest('.card__detach-frame')) return;
     const card = handle.closest('.card');
     if (!card) return;
     if (card.parentElement?.classList.contains('card__frame-contents')) {
       detachToWorld(card);
     }
   }, true);
   
   /* ────── Snap: menor frame que contém o centro do card. ────── */
   function maybeSnap(card) {
     if (!card.classList || card.classList.contains('card--frame')) return;
     if (card.parentElement?.classList.contains('card__frame-contents')) return;
   
     const cx = (parseFloat(card.style.left) || 0) + card.offsetWidth / 2;
     const cy = (parseFloat(card.style.top)  || 0) + card.offsetHeight / 2;
   
     let target = null;
     let smallest = Infinity;
     for (const f of document.querySelectorAll('.card--frame')) {
       const fx = parseFloat(f.style.left) || 0;
       const fy = parseFloat(f.style.top)  || 0;
       const fw = f.offsetWidth, fh = f.offsetHeight;
       if (cx >= fx && cx <= fx + fw && cy >= fy && cy <= fy + fh) {
         const area = fw * fh;
         if (area < smallest) { target = f; smallest = area; }
       }
     }
   
     if (target) attachToFrame(card, target);
   }
   
   /* ────── Contagem de itens por frame ────── */
   function updateFrameCounts() {
     document.querySelectorAll('.card--frame').forEach((f) => {
       const contents = f.querySelector('.card__frame-contents');
       const n = contents ? contents.children.length : 0;
       let counter = f.querySelector('.card__frame-count');
       if (n > 0) {
         if (!counter) {
           counter = document.createElement('div');
           counter.className = 'card__frame-count';
           f.querySelector('.card__frame').appendChild(counter);
         }
         counter.textContent = `${n} item${n > 1 ? 's' : ''}`;
       } else if (counter) {
         counter.remove();
       }
     });
   }
   
   /* ────── Hooks de mudança ──────
      MUDANÇA CRUCIAL: quando um FRAME se move, NÃO tentamos snapear
      cards do mundo. Snap agora só acontece na direção certa:
      quando o CARD se move e cai dentro de um frame. */
   document.addEventListener('cardmoved', (e) => {
     const t = e.target;
     if (t.classList?.contains('card--frame')) {
       /* Frame moveu: só recalcula numeração. NÃO varre o mundo pra
          "absorver" cards que ele encostou. */
       updateFrameNumbers();
     } else if (t.classList?.contains('card')) {
       /* 🎯 Card comum moveu: só tenta snap no FIM do drag (pointerup).
          Sem essa checagem, o snap rodava em cada pointermove e sugava
          cards ao mero encostar num frame, além de tornar impossível
          desvincular. */
       if (e.detail?.final) maybeSnap(t);
     }
     updateFrameCounts();
   });
   
   new MutationObserver((muts) => {
     let frameChange = false;
     let contentsChange = false;
     const newWorldCards = [];
     /* 🎯 Cards que foram REMOVIDOS de um .card__frame-contents no mesmo
        batch. Se aparecem também em newWorldCards, é um detach — NÃO
        deve re-snapear (senão o ↗ e o arrasto-pra-fora ficam impossíveis
        quando o card não é solto longe o bastante do rect do frame). */
     const detachedFromContents = new Set();
   
     for (const m of muts) {
       for (const n of m.addedNodes) {
         if (!n.classList) continue;
         if (n.classList.contains('card--frame')) {
           frameChange = true;
         } else if (n.classList.contains('card')) {
           if (m.target === world) newWorldCards.push(n);
           if (m.target.classList?.contains('card__frame-contents')) contentsChange = true;
         }
       }
       for (const n of m.removedNodes) {
         if (!n.classList) continue;
         if (n.classList.contains('card--frame')) frameChange = true;
         if (m.target.classList?.contains('card__frame-contents')) {
           contentsChange = true;
           detachedFromContents.add(n);
         }
       }
     }
   
     if (frameChange) {
       /* Frame novo criado ou removido: só re-numera. Não força
          resnap global — antes forçava e engolia cards inocentes. */
       updateFrameNumbers();
       contentsChange = true;
     } else if (newWorldCards.length) {
       requestAnimationFrame(() => {
         /* Filtra cards que acabaram de sair de contents. Esses só
            devem voltar pra um frame se o usuário arrastar de novo
            e SOLTAR dentro dele (via cardmoved final=true), nunca
            pelo observer. */
         newWorldCards
           .filter((c) => !detachedFromContents.has(c))
           .forEach(maybeSnap);
         updateFrameCounts();
       });
     }
     if (contentsChange) updateFrameCounts();
   }).observe(world, { childList: true, subtree: true });
   
   /* Chamada externa (persistência) após restore. Respeita frameId salvo. */
   export function rebuildSnaps() {
     document.querySelectorAll('#world > .card:not(.card--frame)').forEach((card) => {
       if (card.dataset.frameId) {
         const frame = document.getElementById(card.dataset.frameId);
         if (frame) { attachToFrame(card, frame); return; }
       }
       maybeSnap(card);
     });
     updateFrameNumbers();
     updateFrameCounts();
   }
   
   /* ═══ MODO STORYBOARD — toggle + play ═══ */
   
   const sbToggle = document.getElementById('sb-toggle');
   const sbPlay   = document.getElementById('sb-play');
   
   let isOn = false;
   function setStoryboardMode(on) {
     isOn = on;
     document.body.classList.toggle('is-storyboard', on);
     sbToggle.classList.toggle('is-active', on);
     sbPlay.hidden = !on;
     if (on) updateFrameNumbers();
   }
   sbToggle.addEventListener('click', () => setStoryboardMode(!isOn));
   
   let playing = null;
   const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
   
   async function play() {
     const frames = getOrderedFrames();
     if (!frames.length) return;
     if (playing) {
       playing.cancelled = true;
       playing = null;
       sbPlay.classList.remove('is-playing');
       return;
     }
   
     const session = { cancelled: false };
     playing = session;
     sbPlay.classList.add('is-playing');
     document.body.classList.add('is-playing');
   
     for (let i = 0; i < frames.length; i++) {
       if (session.cancelled) break;
       const f = frames[i];
       const rect = frameWorldRect(f);
   
       const vw = window.innerWidth, vh = window.innerHeight;
       const z = Math.min(vw * 0.75 / rect.w, vh * 0.75 / rect.h);
       showBadge(i + 1, frames.length, f.querySelector('.card__frame-label')?.textContent || '');
   
       await panTo({
         worldX: rect.x + rect.w / 2,
         worldY: rect.y + rect.h / 2,
         z, duration: 700,
       });
       if (session.cancelled) break;
       await sleep(900);
     }
   
     hideBadge();
     document.body.classList.remove('is-playing');
     sbPlay.classList.remove('is-playing');
     playing = null;
   }
   
   function frameWorldRect(f) {
     return {
       x: parseFloat(f.style.left) || 0,
       y: parseFloat(f.style.top)  || 0,
       w: f.offsetWidth,
       h: f.offsetHeight,
     };
   }
   
   sbPlay.addEventListener('click', play);
   
   document.addEventListener('keydown', (e) => {
     if (e.key === 'Escape' && playing) { playing.cancelled = true; }
   });
   
   let badgeEl;
   function showBadge(i, total, label) {
     if (!badgeEl) {
       badgeEl = document.createElement('div');
       badgeEl.className = 'play-badge';
       document.body.appendChild(badgeEl);
     }
     badgeEl.innerHTML = `
       <span class="play-badge__index">${String(i).padStart(2,'0')} / ${String(total).padStart(2,'0')}</span>
       ${label ? `<span class="play-badge__label">${escapeHTML(label)}</span>` : ''}
     `;
     badgeEl.classList.add('is-visible');
   }
   function hideBadge() {
     if (badgeEl) badgeEl.classList.remove('is-visible');
   }
   function escapeHTML(s) {
     return String(s).replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
   }