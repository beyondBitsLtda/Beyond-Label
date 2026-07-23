/* ════════════════════════════════════════════════════════════════════
   freetext.js — Texto solto no canvas
   ────────────────────────────────────────────────────────────────────
   Diferente de um card: não tem moldura, handle ou resize. É só texto
   absoluto no #world, arrastável full-body, com toolbar flutuante de
   formatação que aparece quando o texto está em foco.

   Por que não reusar createShell?
   ─────────────────────────────────
   createShell injeta handle bar, resize handles e classe `.card`, que
   ativa snap-into-frame (storyboard.js) e seleção como card. Nada
   disso faz sentido para texto solto. Mais limpo manter um caminho
   próprio e simples — drag e seleção são reaproveitados via enableDrag.

   Persistência
   ─────────────
   Estado serializável: { id, x, y, content, size, color, font, bold,
   italic }. persistence.js cuida do save/restore (extensão do schema).
   ════════════════════════════════════════════════════════════════════ */

   import { toast, nextZ } from './cards.js';
   import { getScale, screenToWorld } from './canvas.js';
   
   const world = document.getElementById('world');
   
   /* ────── Presets ────── */
   
   const SIZES = {
     s:  { px: 14, label: 'S'  },
     m:  { px: 20, label: 'M'  },
     g:  { px: 32, label: 'G'  },
     gg: { px: 56, label: 'GG' },
   };
   
   const COLORS = [
     { v: 'var(--ink)',                  label: 'tinta'      },
     { v: 'oklch(0.55 0.17 295)',        label: 'roxo'       },
     { v: 'oklch(0.55 0.20 25)',         label: 'vermelho'   },
     { v: 'oklch(0.62 0.13 38)',         label: 'terracota'  },
     { v: 'oklch(0.55 0.13 220)',        label: 'azul'       },
     { v: 'oklch(0.50 0.15 145)',        label: 'verde'      },
   ];
   
   const FONTS = {
     sans:  { family: 'var(--font-sans)',                      label: 'sans'       },
     serif: { family: "'Georgia', 'Times New Roman', serif",   label: 'serif'      },
     mono:  { family: 'var(--font-mono)',                      label: 'mono'       },
     hand:  { family: "'Caveat', 'Homemade Apple', cursive",   label: 'manuscrita' },
     marker:{ family: "'Kalam', cursive",                      label: 'marcador'   },
     calig: { family: "'Homemade Apple', cursive",             label: 'caligrafia' },
   };
   
   /* z-index vem do namespace compartilhado (cards.js/nextZ) para nunca
      ficar por baixo/em cima de cards por acidente. */
   
   /* ════════════════════════════════════════════════════════════════════
      createFreetext({ x, y, content?, size?, color?, font?, bold?, italic? })
      ──────────────────────────────────────────────────────────────────── */
   export function createFreetext({
     x, y, content = '', size = 'm', color = COLORS[0].v,
     font = 'sans', bold = false, italic = false, ftId, silent = false,
   } = {}) {
     const el = document.createElement('div');
     el.className = 'freetext';
     el.dataset.ftId = ftId || ('ft_' + Math.random().toString(36).slice(2, 10));
     el.dataset.dragHandle = 'true';      // drag full-body como sticker
     el.contentEditable = 'true';
     el.spellcheck = false;
     el.dataset.placeholder = 'Texto…';
     el.style.left = `${x}px`;
     el.style.top  = `${y}px`;
     el.style.zIndex = nextZ();
     el.tabIndex = -1;
     el.textContent = content;
   
     /* Estado de formatação fica no próprio dataset (idempotente, serializável) */
     el.dataset.size   = size;
     el.dataset.color  = color;
     el.dataset.font   = font;
     el.dataset.bold   = bold ? '1' : '';
     el.dataset.italic = italic ? '1' : '';
     applyStyle(el);
   
     world.appendChild(el);
   
     /* ── Drag por limiar de movimento ─────────────────────────────────
        Problema anterior: enableDrag() do cards.js dava setPointerCapture
        imediatamente, roubando o caret. Isso obrigava o usuário a "clicar
        fora, depois arrastar" — irritante.
   
        Solução: NÃO usar enableDrag para freetext. Implementamos aqui um
        drag manual que só ativa depois de 4px de movimento. Até lá, o
        pointerdown funciona normalmente pro contenteditable (caret ok).
        Se o usuário move mais que o limiar, blurramos, capturamos o
        pointer e viramos drag. Se solta antes, ficou tudo como clique. */
   
     const DRAG_THRESHOLD = 4;  // px de tela
     let pdown = null;
   
     el.addEventListener('pointerdown', (e) => {
       if (e.button !== 0) return;
       /* Não arrasta se o clique foi num link, botão, etc. */
       if (e.target.closest('a, button, input, textarea, select')) return;
       pdown = {
         startX: e.clientX, startY: e.clientY,
         origLeft: parseFloat(el.style.left) || 0,
         origTop:  parseFloat(el.style.top)  || 0,
         pointerId: e.pointerId,
         dragging: false,
       };
       /* Traz pra frente ao interagir. */
       el.style.zIndex = nextZ();
     });
   
     el.addEventListener('pointermove', (e) => {
       if (!pdown) return;
       const dx = e.clientX - pdown.startX;
       const dy = e.clientY - pdown.startY;
       if (!pdown.dragging) {
         if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
         /* Virou drag: tira foco, captura pointer, marca. */
         pdown.dragging = true;
         if (document.activeElement === el) el.blur();
         try { el.setPointerCapture(pdown.pointerId); } catch {}
         el.style.userSelect = 'none';
       }
       const scale = getScale();
       el.style.left = `${pdown.origLeft + dx / scale}px`;
       el.style.top  = `${pdown.origTop  + dy / scale}px`;
       el.dispatchEvent(new CustomEvent('cardmoved', { bubbles: true }));
     });
   
     const endDrag = (e) => {
       if (!pdown) return;
       const wasDragging = pdown.dragging;
       try { el.releasePointerCapture(pdown.pointerId); } catch {}
       el.style.userSelect = '';
       pdown = null;
       if (wasDragging) {
         el.dispatchEvent(new CustomEvent('cardmoved', { bubbles: true }));
       }
       /* Se NÃO virou drag e o elemento não está focado, foca-o para editar.
          (contenteditable normalmente foca no pointerdown; damos um empurrão
          caso um pointer capture anterior tenha atrapalhado.) */
       if (!wasDragging && document.activeElement !== el) {
         requestAnimationFrame(() => el.focus());
       }
     };
     el.addEventListener('pointerup', endDrag);
     el.addEventListener('pointercancel', endDrag);
   
     /* Toolbar aparece no foco; some no blur (com delay p/ clicar nela). */
     el.addEventListener('focus', () => showToolbar(el));
     el.addEventListener('blur',  () => {
       scheduleHideToolbar();
       /* Auto-remoção: freetext vazio é lixo invisível. Pequeno delay para
          não conflitar com o usuário clicando na toolbar (o foco vai pra
          toolbar momentaneamente). */
       setTimeout(() => {
         if (document.activeElement === el) return;
         if ((el.textContent || '').trim().length === 0) {
           el.remove();
           el.dispatchEvent(new CustomEvent('cardmoved', { bubbles: true }));
         }
       }, 200);
     });
   
     /* Selection mudou enquanto edita → reposicionar toolbar (segue caret). */
     el.addEventListener('keyup',     () => repositionToolbar(el));
     el.addEventListener('mouseup',   () => repositionToolbar(el));
     el.addEventListener('cardmoved', () => repositionToolbar(el));
   
     if (!silent) {
       requestAnimationFrame(() => {
         el.focus();
         // Caret no final (consistente com criação de note/code).
         const r = document.createRange();
         r.selectNodeContents(el);
         r.collapse(false);
         const s = window.getSelection();
         s.removeAllRanges();
         s.addRange(r);
       });
     }
   
     return el;
   }
   
   /* ────── Aplica estilo a partir do dataset ────── */
   function applyStyle(el) {
     const s = SIZES[el.dataset.size] || SIZES.m;
     const f = FONTS[el.dataset.font] || FONTS.sans;
     el.style.fontSize   = `${s.px}px`;
     el.style.color      = el.dataset.color || 'var(--ink)';
     el.style.fontFamily = f.family;
     el.style.fontWeight = el.dataset.bold   ? '700' : '400';
     el.style.fontStyle  = el.dataset.italic ? 'italic' : 'normal';
     // Caveat e Homemade Apple precisam de line-height maior — não cortam descendentes.
     el.style.lineHeight = (el.dataset.font === 'hand') ? '1.05' : '1.25';
   }
   
   /* ════════════════════════════════════════════════════════════════════
      TOOLBAR FLUTUANTE
      ────────────────────────────────────────────────────────────────────
      Uma única instância no body. Reaproveitada para todos os freetexts.
      Pairing é via `currentTarget`. Posicionamento: acima do elemento,
      centralizado horizontalmente, com clamp à viewport.
      ──────────────────────────────────────────────────────────────────── */
   
   let toolbar = null;
   let currentTarget = null;
   let hideTimer = null;
   
   function ensureToolbar() {
     if (toolbar) return toolbar;
     toolbar = document.createElement('div');
     toolbar.className = 'freetext-toolbar';
     toolbar.hidden = true;
   
     /* Não roubar foco do elemento editado: mousedown.preventDefault() é
        a forma idiomática de manter o caret no contenteditable enquanto
        o usuário interage com a toolbar. */
     toolbar.addEventListener('mousedown', (e) => e.preventDefault());
   
     toolbar.innerHTML = `
       <div class="ft-tb__group" data-group="size">
         ${Object.entries(SIZES).map(([k, v]) =>
           `<button type="button" class="ft-tb__btn ft-tb__size" data-size="${k}" title="Tamanho ${v.label}">${v.label}</button>`
         ).join('')}
       </div>
       <span class="ft-tb__sep"></span>
       <div class="ft-tb__group" data-group="font">
         ${Object.entries(FONTS).map(([k, v]) =>
           `<button type="button" class="ft-tb__btn ft-tb__font" data-font="${k}" style="font-family:${v.family}" title="${v.label}">Aa</button>`
         ).join('')}
       </div>
       <span class="ft-tb__sep"></span>
       <div class="ft-tb__group" data-group="style">
         <button type="button" class="ft-tb__btn" data-toggle="bold" title="Negrito"><b>B</b></button>
         <button type="button" class="ft-tb__btn" data-toggle="italic" title="Itálico"><i>I</i></button>
       </div>
       <span class="ft-tb__sep"></span>
       <div class="ft-tb__group ft-tb__colors" data-group="color">
         ${COLORS.map((c) =>
           `<button type="button" class="ft-tb__color" data-color="${c.v}" style="--c:${c.v}" title="${c.label}"></button>`
         ).join('')}
       </div>
     `;
     document.body.appendChild(toolbar);
   
     /* Wireup — delegação por dataset */
     toolbar.addEventListener('click', (e) => {
       const t = e.target.closest('button');
       if (!t || !currentTarget) return;
       const el = currentTarget;
   
       if (t.dataset.size)   el.dataset.size  = t.dataset.size;
       if (t.dataset.font)   el.dataset.font  = t.dataset.font;
       if (t.dataset.color)  el.dataset.color = t.dataset.color;
       if (t.dataset.toggle === 'bold')   el.dataset.bold   = el.dataset.bold   ? '' : '1';
       if (t.dataset.toggle === 'italic') el.dataset.italic = el.dataset.italic ? '' : '1';
   
       applyStyle(el);
       syncToolbar(el);
       repositionToolbar(el);
       /* Sinaliza ao persistence para salvar */
       el.dispatchEvent(new CustomEvent('cardmoved', { bubbles: true }));
     });
   
     return toolbar;
   }
   
   function syncToolbar(el) {
     toolbar.querySelectorAll('.ft-tb__size').forEach((b) =>
       b.classList.toggle('is-active', b.dataset.size === el.dataset.size));
     toolbar.querySelectorAll('.ft-tb__font').forEach((b) =>
       b.classList.toggle('is-active', b.dataset.font === el.dataset.font));
     toolbar.querySelectorAll('.ft-tb__color').forEach((b) =>
       b.classList.toggle('is-active', b.dataset.color === el.dataset.color));
     toolbar.querySelector('[data-toggle="bold"]')
       ?.classList.toggle('is-active', !!el.dataset.bold);
     toolbar.querySelector('[data-toggle="italic"]')
       ?.classList.toggle('is-active', !!el.dataset.italic);
   }
   
   function showToolbar(el) {
     clearTimeout(hideTimer);
     ensureToolbar();
     currentTarget = el;
     toolbar.hidden = false;
     syncToolbar(el);
     repositionToolbar(el);
   }
   
   function scheduleHideToolbar() {
     clearTimeout(hideTimer);
     hideTimer = setTimeout(() => {
       if (!toolbar) return;
       // Se algum freetext ainda tem foco, mantenha.
       const ae = document.activeElement;
       if (ae && ae.classList?.contains('freetext')) return;
       toolbar.hidden = true;
       currentTarget = null;
     }, 150);
   }
   
   function repositionToolbar(el) {
     if (!toolbar || toolbar.hidden) return;
     const r = el.getBoundingClientRect();
     // Mede após render (precisa de width)
     toolbar.style.visibility = 'hidden';
     toolbar.style.left = '0px';
     toolbar.style.top  = '0px';
     requestAnimationFrame(() => {
       const tw = toolbar.offsetWidth;
       const th = toolbar.offsetHeight;
       let x = r.left + (r.width - tw) / 2;
       let y = r.top - th - 10;
       // Clamp à viewport
       const pad = 8;
       x = Math.max(pad, Math.min(window.innerWidth  - tw - pad, x));
       if (y < pad) y = r.bottom + 10;        // se não cabe acima, vai abaixo
       toolbar.style.left = `${x}px`;
       toolbar.style.top  = `${y}px`;
       toolbar.style.visibility = '';
     });
   }
   
   /* Fecha toolbar se clicar em qualquer lugar fora dela e fora de freetext */
   document.addEventListener('pointerdown', (e) => {
     if (!toolbar || toolbar.hidden) return;
     if (toolbar.contains(e.target)) return;
     if (e.target.closest('.freetext')) return;
     toolbar.hidden = true;
     currentTarget = null;
   }, true);
   
   window.addEventListener('resize', () => {
     if (currentTarget) repositionToolbar(currentTarget);
   });
   
   /* ────── Atalho T no centro da viewport ────── */
   document.addEventListener('keydown', (e) => {
     const t = e.target;
     if (t && (t.isContentEditable || /input|textarea|select/i.test(t.tagName))) return;
     if (e.metaKey || e.ctrlKey || e.altKey) return;
     if (document.body.classList.contains('is-drawing')) return;
     if (e.key.toLowerCase() === 't') {
       const w = screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
       createFreetext({ x: w.x, y: w.y });
     }
   });
   
   /* ────── Serialização (consumido por persistence.js) ────── */
   export function serializeFreetexts() {
     return [...world.querySelectorAll('.freetext')].map((el) => ({
       ftId:    el.dataset.ftId,
       x:       parseFloat(el.style.left) || 0,
       y:       parseFloat(el.style.top)  || 0,
       content: el.textContent || '',
       size:    el.dataset.size  || 'm',
       color:   el.dataset.color || 'var(--ink)',
       font:    el.dataset.font  || 'sans',
       bold:    !!el.dataset.bold,
       italic:  !!el.dataset.italic,
     }));
   }