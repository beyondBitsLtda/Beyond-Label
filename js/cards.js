/* ════════════════════════════════════════════════════════════════════
   cards.js — Construção e manipulação de cards
   ────────────────────────────────────────────────────────────────────
   Responsabilidades:
     - Construção de cards (note, code, shape)
     - Drag full-body (qualquer área do card, excluindo editáveis)
     - Resize livre (8 handles: 4 cantos + 4 arestas)
     - Seleção global + Delete por teclado
     - Copy/Paste interno (Ctrl+C / Ctrl+V)
     - Conexões acompanham drag em tempo real (cardmoved contínuo)

   MUDANÇAS (fix indentação em code cards):
     - blur usa innerText em vez de textContent → preserva \n mesmo
       quando o Chrome insere <div>/<br> durante edição
     - paste em .card__code usa Range API pura (sem execCommand),
       insere um único text node → \n preservados literalmente
     - serializeForClipboard e copy também usam innerText
   ════════════════════════════════════════════════════════════════════ */

   import { getScale, screenToWorld } from './canvas.js';

   const world = document.getElementById('world');
   
   /* zCounter começa em 1 mas é sincronizado com o maior z-index já presente
      no #world sempre que um novo card é criado. Assim, cards restaurados
      da persistência (que trazem seus próprios z-indexes) não ficam por
      cima de cards novos. */
   let zCounter = 1;
   function bumpZ() {
     const els = world.querySelectorAll('.card, .freetext, .sticker');
     let max = zCounter;
     els.forEach((el) => {
       const z = parseFloat(el.style.zIndex) || 0;
       if (z > max) max = z;
     });
     zCounter = max + 1;
     return zCounter;
   }
   /* Exposto para o freetext usar o mesmo namespace de z-index. */
   export function nextZ() { return bumpZ(); }
   
   /* ─────────────────────────────────────────────────────────────────────
      SELEÇÃO GLOBAL — qualquer elemento selecionável (card ou sticker)
      ───────────────────────────────────────────────────────────────────── */
   
   let selectedElement = null;
   let clipboardData = null;
   
   function selectElement(el, clickTarget) {
     if (selectedElement !== el) {
       deselectAll();
       selectedElement = el;
       el.classList.add('is-selected');
     }
   
     if (clickTarget && clickTarget.closest && clickTarget.closest('iframe')) return;
   
     const ae = document.activeElement;
     const isEditingInside = ae && el.contains(ae) &&
       (ae.getAttribute('contenteditable') === 'true' ||
        /input|textarea|select/i.test(ae.tagName));
     if (isEditingInside) return;
   
     setTimeout(() => {
       const now = document.activeElement;
       if (now && el.contains(now) && now !== el) return;
       try { el.focus({ preventScroll: true }); } catch {}
     }, 0);
   }
   
   function selectCard(card) { selectElement(card); }
   
   function deselectAll() {
     if (selectedElement) selectedElement.classList.remove('is-selected');
     selectedElement = null;
   }
   
   export function getSelectedCard() { return selectedElement; }
   
   /* Click no fundo → deseleciona */
   document.getElementById('viewport').addEventListener('pointerdown', (e) => {
     if (!e.target.closest('.card, .sticker, .context-menu, .hud, .minimap, .draw-fab, .sticker-palette, .projects-panel, .palette-overlay, .modal-overlay, .conn-menu')) {
       deselectAll();
     }
   });
   
   /* ─────────────────────────────────────────────────────────────────────
      createShell — esqueleto de TODOS os cards
      ───────────────────────────────────────────────────────────────────── */
   
   export function createShell({ type, label, x, y, width, height, cardId }) {
     const card = document.createElement('div');
     card.className = `card card--${type}`;
     card.dataset.cardId = cardId || ('card_' + Math.random().toString(36).slice(2, 10));
     card.style.left = `${x}px`;
     card.style.top  = `${y}px`;
     if (width)  card.style.width  = `${width}px`;
     if (height) card.style.height = `${height}px`;
     card.style.zIndex = bumpZ();
     card.tabIndex = -1;
   
     card.appendChild(makeHandle(label, card));
     addResizeHandles(card);
     world.appendChild(card);
     enableDrag(card);
     return card;
   }
   
   /* ─────────────────────────────────────────────────────────────────────
      FORMAS DE FLUXOGRAMA — oval, retângulo, losango, paralelogramo
      ───────────────────────────────────────────────────────────────────── */
   
   export const SHAPES = {
     oval:     { label: 'Início/Fim', w: 180, h: 80  },
     process:  { label: 'Processo',   w: 200, h: 90  },
     decision: { label: 'Decisão',    w: 200, h: 120 },
     data:     { label: 'Dados',      w: 200, h: 90  },
   };
   
   /* ─── Cores de fluxograma ─── */
   const SHAPE_COLORS = [
     { name: 'padrão',   value: ''                     },
     { name: 'roxo',     value: 'oklch(0.66 0.15 295)' },
     { name: 'azul',     value: 'oklch(0.70 0.12 230)' },
     { name: 'verde',    value: 'oklch(0.72 0.13 150)' },
     { name: 'âmbar',    value: 'oklch(0.80 0.13 80)'  },
     { name: 'vermelho', value: 'oklch(0.68 0.17 25)'  },
     { name: 'rosa',     value: 'oklch(0.72 0.14 350)' },
   ];

   function applyShapeFill(card, fillEl, color) {
     card.dataset.fill = color || '';
     if (color) {
       fillEl.dataset.fill = '1';
       fillEl.style.background = color;
     } else {
       delete fillEl.dataset.fill;
       fillEl.style.background = '';
     }
     const bar = card.querySelector('.shape-color-bar');
     if (bar) bar.querySelectorAll('.shape-color-bar__sw').forEach((sw) =>
       sw.classList.toggle('is-active', (sw.dataset.value || '') === (color || '')));
   }

   function buildShapeColorBar(card, fillEl) {
     const bar = document.createElement('div');
     bar.className = 'shape-color-bar';
     SHAPE_COLORS.forEach((c) => {
       const sw = document.createElement('button');
       sw.type = 'button';
       sw.className = 'shape-color-bar__sw';
       sw.dataset.value = c.value;
       sw.title = c.name;
       sw.style.background = c.value || 'var(--bg-elevated)';
       if (!c.value) sw.style.boxShadow = 'inset 0 0 0 1px var(--ink-faint)';
       sw.addEventListener('pointerdown', (e) => e.stopPropagation());
       sw.addEventListener('click', (e) => {
         e.stopPropagation();
         applyShapeFill(card, fillEl, c.value);
         /* dispara autosave (persistence escuta cardmoved). */
         card.dispatchEvent(new CustomEvent('cardmoved', { bubbles: true }));
       });
       bar.appendChild(sw);
     });
     card.appendChild(bar);
   }

   export function createShapeCard({ shape = 'process', x, y, width, height, content = '', fill = '', silent, cardId }) {
     const def = SHAPES[shape] || SHAPES.process;
     const card = createShell({
       type: 'shape', label: def.label, x, y,
       width: width || def.w, height, cardId,
     });
     card.dataset.shape = shape;
     card.classList.add(`shape--${shape}`);
   
     const body = document.createElement('div');
     body.className = 'card__shape';
     body.style.minHeight = `${def.h}px`;
   
     const inner = document.createElement('div');
     inner.className = 'card__shape-fill';
   
     if (shape === 'decision' || shape === 'data') {
       const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
       svg.classList.add('card__shape-outline');
       svg.setAttribute('viewBox', '0 0 100 60');
       svg.setAttribute('preserveAspectRatio', 'none');
       const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
       if (shape === 'decision') {
         path.setAttribute('d', 'M 50 2 L 98 30 L 50 58 L 2 30 Z');
       } else {
         path.setAttribute('d', 'M 12 2 L 98 2 L 88 58 L 2 58 Z');
       }
       svg.appendChild(path);
       inner.appendChild(svg);
     }
   
     const textEl = document.createElement('div');
     textEl.className = 'card__shape-text';
     textEl.contentEditable = 'true';
     textEl.spellcheck = false;
     textEl.dataset.placeholder = def.label + '…';
     textEl.textContent = content;
     textEl.addEventListener('pointerdown', (e) => e.stopPropagation());
   
     inner.appendChild(textEl);
     body.appendChild(inner);
     card.appendChild(body);

     /* 🎯 Barra de cor (aparece quando a forma está selecionada). */
     buildShapeColorBar(card, inner);
     if (fill) applyShapeFill(card, inner, fill);
   
     if (!silent) {
       requestAnimationFrame(() => {
         selectCard(card);
         textEl.focus();
       });
     }
     return card;
   }
   
   export function createCard({ type, x, y, width, height, content, contentHtml, language, silent, cardId }) {
     const label = type === 'note' ? 'Nota' : 'Código';
     const card = createShell({ type, label, x, y, width, height, cardId });
   
     if (type === 'note') buildNote(card, content, contentHtml);
     if (type === 'code') buildCode(card, content, language);
   
     if (!silent) {
       requestAnimationFrame(() => {
         selectCard(card);
         const editable = card.querySelector('.card__note, .card__code');
         if (editable) {
           if (type === 'code') editable.contentEditable = 'true';
           editable.focus();
         }
       });
     }
   
     return card;
   }
   
   /* ─────────────────────────────────────────────────────────────────────
      "Handle" — barra superior com tipo, drag, e close
      ───────────────────────────────────────────────────────────────────── */
   
   function makeHandle(label, card) {
     const h = document.createElement('div');
     h.className = 'card__handle';
     h.dataset.dragHandle = 'true';
     h.innerHTML = `
       <span class="card__type-dot"></span>
       <span class="card__type">${label}</span>
       <button class="card__close" title="Remover" aria-label="Remover">×</button>
     `;
     h.querySelector('.card__close').addEventListener('click', (e) => {
       e.stopPropagation();
       if (selectedElement === card) deselectAll();
       card.remove();
     });
     return h;
   }
   
   /* ─────────────────────────────────────────────────────────────────────
      NOTE CARD
      ───────────────────────────────────────────────────────────────────── */
   
   function buildNote(card, content = '', contentHtml = null) {
     const body = document.createElement('div');
     body.className = 'card__note';
     body.contentEditable = 'true';
     body.spellcheck = false;
     body.dataset.placeholder = 'Escreva aqui…';
     /* 🎯 FIX formatação de notas: notas são contenteditable, então o
        usuário pode aplicar negrito/itálico/listas (Ctrl+B, etc). Antes
        salvávamos só textContent → a formatação sumia ao recarregar.
        Agora, quando há HTML salvo (contentHtml), restauramos com
        innerHTML; caso contrário, texto puro (nota nova ou colada). */
     if (contentHtml != null) body.innerHTML = contentHtml;
     else                     body.textContent = content;
     body.addEventListener('pointerdown', (e) => e.stopPropagation());
     card.appendChild(body);
   }
   
   /* ─────────────────────────────────────────────────────────────────────
      CODE CARD
      ─────────────────────────────────────────────────────────────────────
      FIX: no blur usamos innerText (não textContent). Motivo: mesmo em
      <pre contenteditable>, o Chrome pode inserir <div>/<br> pra novas
      linhas. textContent apenas concatena o texto dos nós, IGNORANDO os
      blocos — resultado: "linha1linha2linha3" sem quebras.
      innerText respeita o layout visual e devolve \n corretos.
      ───────────────────────────────────────────────────────────────────── */
   
   const LANGS = ['javascript', 'python', 'plain'];
   
   function buildCode(card, content = '', language = 'javascript') {
     const tb = document.createElement('div');
     tb.className = 'card__code-toolbar';
   
     const langSel = document.createElement('select');
     langSel.className = 'card__lang';
     LANGS.forEach((l) => {
       const opt = document.createElement('option');
       opt.value = l;
       opt.textContent = l;
       if (l === language) opt.selected = true;
       langSel.appendChild(opt);
     });
     tb.appendChild(langSel);
   
     const copyBtn = document.createElement('button');
     copyBtn.className = 'card__copy';
     copyBtn.textContent = 'copiar';
     copyBtn.type = 'button';
     tb.appendChild(copyBtn);
     card.appendChild(tb);
   
     const code = document.createElement('pre');
     code.className = 'card__code';
     code.contentEditable = 'true';
     code.spellcheck = false;
     code.dataset.placeholder = '// snippet…';
     code.dataset.raw = content;
     if (content) code.innerHTML = highlight(content, langSel.value);
     else         code.textContent = '';
     card.appendChild(code);
   
     code.addEventListener('pointerdown', (e) => e.stopPropagation());
   
     code.addEventListener('focus', () => {
       /* Mostra o texto bruto (sem HTML de highlight) pra editar limpo.
          textContent aqui SET normaliza em um único text node — o <pre>
          renderiza os \n como quebras via white-space: pre-wrap. */
       code.textContent = code.dataset.raw || code.innerText;
     });
   
     code.addEventListener('blur', () => {
       /* 🎯 innerText: respeita layout visual, retorna \n mesmo se o DOM
          ficou com <div>/<br>. textContent aqui perderia as quebras. */
       const raw = code.innerText;
       code.dataset.raw = raw;
       code.innerHTML = highlight(raw, langSel.value);
     });
   
     langSel.addEventListener('change', () => {
       code.innerHTML = highlight(code.dataset.raw || code.innerText, langSel.value);
     });
   
     copyBtn.addEventListener('click', async (e) => {
       e.stopPropagation();
       try {
         await navigator.clipboard.writeText(code.dataset.raw || code.innerText);
         toast('Copiado');
       } catch { toast('Falha ao copiar'); }
     });
   }
   
   /* Helper: posiciona o cursor no final do conteúdo de um contenteditable */
   function placeCaretAtEnd(el) {
     const range = document.createRange();
     range.selectNodeContents(el);
     range.collapse(false);
     const sel = window.getSelection();
     sel.removeAllRanges();
     sel.addRange(range);
   }
   
   /* ─────────────────────────────────────────────────────────────────────
      SYNTAX HIGHLIGHTING — simples, sem dependências.
      ───────────────────────────────────────────────────────────────────── */
   
   const KEYWORDS = {
     javascript: [
       'const','let','var','function','return','if','else','for','while','do',
       'switch','case','break','continue','new','class','extends','this','super',
       'import','export','from','as','default','async','await','try','catch',
       'finally','throw','typeof','instanceof','in','of','null','undefined','true','false'
     ],
     python: [
       'def','return','if','elif','else','for','while','in','not','and','or',
       'class','import','from','as','with','try','except','finally','raise',
       'lambda','pass','break','continue','True','False','None','self','yield','async','await'
     ],
     plain: []
   };
   
   function escapeHTML(s) {
     return String(s).replace(/[&<>]/g, (c) => ({
       '&': '&amp;',
       '<': '&lt;',
       '>': '&gt;',
     }[c]));
   }
   
   /* ════════════════════════════════════════════════════════════════════
      highlight(src, lang) — Syntax highlight PRESERVANDO indentação
      ────────────────────────────────────────────────────────────────────
      Estratégia:
      1. escapeHTML primeiro → \n e espaços intactos (CSS pre-wrap renderiza)
      2. Marca comentários e strings com placeholders opacos ao regex de
         keywords/números → não colore "if" dentro de string, etc.
      3. Aplica keywords + números só no que sobrou.
      4. Restaura os placeholders com o span final.
      Nunca chamamos split/normalize em whitespace → indentação preservada.
      ════════════════════════════════════════════════════════════════════ */
   function highlight(src, lang) {
     if (!src) return '';
     if (lang === 'plain') return escapeHTML(src);
   
     const kws = KEYWORDS[lang] || [];
   
     let out = escapeHTML(src);
   
     const vault = [];
     const stash = (html) => {
       const key = `\x00${vault.length}\x00`;
       vault.push(html);
       return key;
     };
   
     if (lang === 'javascript') {
       out = out.replace(/\/\*[\s\S]*?\*\//g,
         (m) => stash(`<span class="tok-com">${m}</span>`));
       out = out.replace(/\/\/[^\n]*/g,
         (m) => stash(`<span class="tok-com">${m}</span>`));
     } else if (lang === 'python') {
       out = out.replace(/#[^\n]*/g,
         (m) => stash(`<span class="tok-com">${m}</span>`));
     }
   
     /* Strings: escapeHTML transformou " em &quot;. Ajustamos o regex. */
     out = out.replace(/(&quot;[^&\n]*?&quot;|'[^'\n]*?'|`[^`\n]*?`)/g,
       (m) => stash(`<span class="tok-str">${m}</span>`));
   
     out = out.replace(/\b\d+(?:\.\d+)?\b/g,
       (m) => `<span class="tok-num">${m}</span>`);
   
     if (kws.length) {
       const re = new RegExp('\\b(?:' + kws.join('|') + ')\\b', 'g');
       out = out.replace(re, (m) => `<span class="tok-key">${m}</span>`);
     }
   
     out = out.replace(/\x00(\d+)\x00/g, (_, i) => vault[+i]);
   
     return out;
   }
   
   /* ─────────────────────────────────────────────────────────────────────
      DRAG de cards
      ───────────────────────────────────────────────────────────────────── */
   
   function enableDrag(el) {
     const handle = el.querySelector('[data-drag-handle]') ||
                    (el.matches?.('[data-drag-handle]') ? el : null);
     const isCard = el.classList.contains('card');
   
     const dragZone = isCard ? el : (handle || null);
     if (!dragZone) return;
   
     function shouldDrag(e) {
       if (e.button !== 0) return false;
       const t = e.target;
       if (t.closest('.card__resize')) return false;
       if (t.closest('.card-anchor')) return false;
       if (t.isContentEditable) return false;
       if (/input|textarea|select/i.test(t.tagName)) return false;
       if (t.closest('button')) return false;
       if (t.closest('iframe')) return false;
       return true;
     }
   
     el.addEventListener('pointerdown', (e) => {
       el.style.zIndex = bumpZ();
       if (el.classList.contains('card') || el.classList.contains('sticker')) {
         selectElement(el, e.target);
       }
     });
   
     let drag = null;
     let dragRafPending = false;
   
     dragZone.addEventListener('pointerdown', (e) => {
       if (!shouldDrag(e)) return;
       e.stopPropagation();
       e.preventDefault();
   
       drag = {
         startX: e.clientX,
         startY: e.clientY,
         origLeft: parseFloat(el.style.left) || 0,
         origTop:  parseFloat(el.style.top)  || 0,
         moved: false,
       };
       dragZone.setPointerCapture(e.pointerId);
     });
   
     dragZone.addEventListener('pointermove', (e) => {
       if (!drag) return;
       const scale = getScale();
       el.style.left = `${drag.origLeft + (e.clientX - drag.startX) / scale}px`;
       el.style.top  = `${drag.origTop  + (e.clientY - drag.startY) / scale}px`;
       drag.moved = true;
   
       if (!dragRafPending) {
         dragRafPending = true;
         requestAnimationFrame(() => {
           dragRafPending = false;
           el.dispatchEvent(new CustomEvent('cardmoved', { bubbles: true }));
         });
       }
     });
   
     const end = (e) => {
       if (!drag) return;
       const moved = drag.moved;
       drag = null;
       try { dragZone.releasePointerCapture(e.pointerId); } catch {}
       /* 🎯 detail.final=true sinaliza para o storyboard.js que ESTE é o
          momento de tentar snapear no frame. Sem essa flag, o snap
          rodava em cada pointermove — o que fazia o card ser "sugado"
          por qualquer frame que ele encostasse durante o arrasto, e
          impedia desvincular (re-snap acontecia em tempo real). */
       if (moved) el.dispatchEvent(new CustomEvent('cardmoved', {
         bubbles: true,
         detail: { final: true },
       }));
     };
     dragZone.addEventListener('pointerup', end);
     dragZone.addEventListener('pointercancel', end);
   }
   
   /* ─────────────────────────────────────────────────────────────────────
      RESIZE — 8 handles (4 cantos + 4 arestas)
      ───────────────────────────────────────────────────────────────────── */
   
   function addResizeHandles(card) {
     ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach((pos) => {
       const h = document.createElement('div');
       h.className = `card__resize card__resize--${pos}`;
       h.addEventListener('pointerdown', (e) => startResize(e, card, pos));
       card.appendChild(h);
     });
   }
   
   function startResize(e, card, pos) {
     e.stopPropagation();
     e.preventDefault();
     const scale = getScale();
     const startX = e.clientX;
     const startY = e.clientY;
     const origW = card.offsetWidth;
     const origH = card.offsetHeight;
     const origLeft = parseFloat(card.style.left) || 0;
     const origTop  = parseFloat(card.style.top)  || 0;
     const minW = 120, minH = 60;
   
     card.classList.add('is-resizing');
     const cursorMap = {
       nw: 'nwse-resize', ne: 'nesw-resize',
       sw: 'nesw-resize', se: 'nwse-resize',
       n: 'ns-resize', s: 'ns-resize',
       e: 'ew-resize', w: 'ew-resize',
     };
     document.body.style.cursor = cursorMap[pos];
   
     function onMove(ev) {
       const dx = (ev.clientX - startX) / scale;
       const dy = (ev.clientY - startY) / scale;
       let newW = origW, newH = origH, newL = origLeft, newT = origTop;
   
       if (pos.includes('e')) newW = Math.max(minW, origW + dx);
       if (pos.includes('w')) { newW = Math.max(minW, origW - dx); newL = origLeft + origW - newW; }
       if (pos.includes('s')) newH = Math.max(minH, origH + dy);
       if (pos.includes('n')) { newH = Math.max(minH, origH - dy); newT = origTop + origH - newH; }
   
       card.style.width  = `${newW}px`;
       card.style.height = `${newH}px`;
       card.style.left   = `${newL}px`;
       card.style.top    = `${newT}px`;
       card.dispatchEvent(new CustomEvent('cardmoved', { bubbles: true }));
     }
   
     function onUp() {
       card.classList.remove('is-resizing');
       document.body.style.cursor = '';
       window.removeEventListener('pointermove', onMove, true);
       window.removeEventListener('pointerup', onUp, true);
       card.dispatchEvent(new CustomEvent('cardmoved', { bubbles: true }));
     }
   
     window.addEventListener('pointermove', onMove, true);
     window.addEventListener('pointerup', onUp, true);
   }
   
   /* ─────────────────────────────────────────────────────────────────────
      TECLADO — Escape + Delete + Ctrl+C
      ───────────────────────────────────────────────────────────────────── */
   
   document.addEventListener('keydown', (e) => {
     if (document.body.classList.contains('is-drawing')) return;
   
     const ae = document.activeElement;
   
     const isAnyEditing = ae && ae !== document.body &&
       (ae.getAttribute('contenteditable') === 'true' ||
        /input|textarea|select/i.test(ae.tagName));
   
     const isEditingInside = isAnyEditing && selectedElement && selectedElement.contains(ae);
   
     if (e.key === 'Escape') {
       if (isAnyEditing) {
         ae.blur();
         if (selectedElement && selectedElement.contains(ae)) {
           try { selectedElement.focus({ preventScroll: true }); } catch {}
         }
         return;
       }
       if (selectedElement) {
         deselectAll();
         return;
       }
     }
   
     if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElement) {
       if (isEditingInside) {
         const text = (ae.textContent || ae.value || '').trim();
         if (text.length === 0 && e.key === 'Delete') {
           e.preventDefault();
           const el = selectedElement;
           console.log('[cards] Delete (editor vazio) →', el.className);
           deselectAll();
           el.remove();
           toast('Elemento removido');
           return;
         }
         return;
       }
       e.preventDefault();
       const el = selectedElement;
       console.log('[cards] Delete →', el.className, el.dataset.cardId || el.dataset.stickerId || '');
       deselectAll();
       el.remove();
       toast('Elemento removido');
       return;
     }
   
     if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedElement) {
       if (isAnyEditing) return;
       if (selectedElement.classList.contains('card')) {
         clipboardData = serializeForClipboard(selectedElement);
         if (clipboardData) {
           console.log('[cards] Ctrl+C →', clipboardData.type);
           toast('Card copiado');
         }
       }
       return;
     }
   });
   
   /* ─────────────────────────────────────────────────────────────────────
      PASTE global — cria card interno, nota ou snippet a partir do clipboard
      Prioridade: imagem (media.js) > URL YouTube (media.js) >
                  card interno > texto (nota ou código detectado)
      ───────────────────────────────────────────────────────────────────── */
   
   document.addEventListener('paste', (e) => {
     const t = e.target;
     if (t && (t.isContentEditable || /input|textarea/i.test(t.tagName))) return;
     if (document.body.classList.contains('is-drawing')) return;
   
     const hasFiles = e.clipboardData?.files?.length > 0;
     const hasImageItem = [...(e.clipboardData?.items || [])]
       .some((it) => it.type && it.type.startsWith('image/'));
     const text = (e.clipboardData?.getData('text/plain') || '').trim();
     const hasUrl = /^https?:\/\//i.test(text);
   
     if (hasFiles || hasImageItem || hasUrl) return;
   
     if (clipboardData) {
       e.preventDefault();
       pasteCardFromClipboard();
       return;
     }
   
     if (!text) return;
     e.preventDefault();
     const w = screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
     const lang = detectCodeLanguage(text);
     if (lang) {
       createCard({
         type: 'code', x: w.x - 180, y: w.y - 60,
         width: 380, content: text, language: lang,
       });
       toast(`Código colado (${lang})`);
     } else {
       createCard({
         type: 'note', x: w.x - 120, y: w.y - 40,
         width: 260, content: text,
       });
       toast('Texto colado');
     }
   });
   
   function detectCodeLanguage(text) {
     if (!text || text.length < 3) return null;
     const lines = text.split('\n');
     const nLines = lines.length;
   
     let score = 0;
     if (/[{};]/.test(text))                      score += 2;
     if (/[<>=!]=|=>|->|::|\+\+|--/.test(text))   score += 2;
     if (/^\s{2,}\S/m.test(text))                 score += 2;
     if (/^\t/m.test(text))                       score += 2;
     if (nLines > 1 && /^[\s]*[\/\/#*]/m.test(text)) score += 1;
   
     const js = /\b(function|const|let|var|=>|return|import|export|require|console\.log|async|await|new\s+[A-Z])\b/;
     const py = /\b(def|import|from|class|elif|self|lambda|None|True|False|print\()\b|:\s*$/m;
   
     const isJs = js.test(text);
     const isPy = py.test(text);
   
     if (isJs) score += 3;
     if (isPy) score += 3;
   
     const proseWords = text.match(/\b(que|para|com|uma|the|and|for|with|este|esta)\b/gi) || [];
     if (proseWords.length > 3 && !isJs && !isPy) score -= 3;
   
     if (score < 4) return null;
     if (nLines < 2 && !isJs && !isPy) return null;
   
     if (isPy && !isJs) return 'python';
     if (isJs) return 'javascript';
     return 'plain';
   }
   
   function serializeForClipboard(card) {
     const type = [...card.classList].find((c) => c.startsWith('card--'))?.slice(6);
     if (!type) return null;
     const d = {
       type,
       width:  parseFloat(card.style.width)  || null,
       height: parseFloat(card.style.height) || null,
     };
     switch (type) {
       case 'note': {
         const noteEl = card.querySelector('.card__note');
         d.content     = noteEl?.textContent || '';
         d.contentHtml = noteEl?.innerHTML || null;
         break;
       }
       case 'code': {
         /* 🎯 innerText: preserva \n mesmo com <div>/<br> gerados pela edição. */
         const codeEl = card.querySelector('.card__code');
         d.content  = codeEl?.dataset.raw || codeEl?.innerText || '';
         d.language = card.querySelector('.card__lang')?.value || 'javascript';
         break;
       }
       case 'shape':
         d.shape   = card.dataset.shape || 'process';
         d.content = card.querySelector('.card__shape-text')?.textContent || '';
         d.fill    = card.dataset.fill || '';
         break;
       case 'image':
         d.src  = card.querySelector('.card__image')?.src || '';
         d.name = card.querySelector('.card__image')?.alt || 'imagem';
         break;
       case 'youtube': {
         const iframe = card.querySelector('.card__yt-iframe');
         const input  = card.querySelector('.card__yt-input');
         const m = iframe?.src?.match(/embed\/([A-Za-z0-9_-]{11})/);
         d.url = m ? `https://youtu.be/${m[1]}` : (input?.value || '');
         break;
       }
       case 'db-table': {
         d.name = card.querySelector('.card__db-name')?.textContent || '';
         d.columns = [...card.querySelectorAll('.card__db-col')].map((r) => ({
           name: r.querySelector('.card__db-colname')?.textContent || '',
           type: r.querySelector('.card__db-coltype')?.textContent || '',
           pk: r.querySelector('.card__db-flag[data-kind="pk"]')?.dataset.active === '1',
           fk: r.querySelector('.card__db-flag[data-kind="pk"]')?.dataset.fk === '1',
           nn: r.querySelector('.card__db-flag[data-kind="pk"]')?.dataset.nn === '1',
         }));
         break;
       }
       case 'uml-class':
         d.name    = card.querySelector('.card__uml-name')?.textContent || '';
         d.attrs   = card.querySelector('.card__uml-section[data-part="attrs"]')?.textContent || '';
         d.methods = card.querySelector('.card__uml-section[data-part="methods"]')?.textContent || '';
         break;
       case 'uml-actor':
         d.label = card.querySelector('.card__uml-actor-label')?.textContent || '';
         break;
       case 'uml-usecase':
         d.content = card.querySelector('.card__uml-usecase-text')?.textContent || '';
         break;
       case 'uml-note':
         d.content = card.querySelector('.card__uml-note')?.textContent || '';
         break;
     }
     return d;
   }
   
   async function pasteCardFromClipboard() {
     if (!clipboardData) return;
     const w = screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
     const d = clipboardData;
     switch (d.type) {
       case 'note':
         createCard({ type: 'note', x: w.x - 120, y: w.y - 40, width: d.width || 240, content: d.content, contentHtml: d.contentHtml });
         break;
       case 'code':
         createCard({ type: 'code', x: w.x - 180, y: w.y - 60, width: d.width || 360, content: d.content, language: d.language });
         break;
       case 'shape':
         createShapeCard({ shape: d.shape, x: w.x - 100, y: w.y - 50, width: d.width, content: d.content, fill: d.fill });
         break;
       case 'image': {
         const { createImageCard } = await import('./media.js');
         createImageCard({ src: d.src, x: w.x - 160, y: w.y - 100, width: d.width || 320, height: d.height, name: d.name });
         break;
       }
       case 'youtube': {
         const { createYouTubeCard } = await import('./media.js');
         createYouTubeCard({ x: w.x - 200, y: w.y - 120, url: d.url, width: d.width, height: d.height });
         break;
       }
       case 'db-table': {
         const { createDbTableCard } = await import('./db.js');
         createDbTableCard({ x: w.x - 140, y: w.y - 80, width: d.width, name: d.name, columns: d.columns });
         break;
       }
       case 'uml-class': {
         const { createUmlClassCard } = await import('./uml.js');
         createUmlClassCard({ x: w.x - 130, y: w.y - 70, width: d.width, name: d.name, attrs: d.attrs, methods: d.methods });
         break;
       }
       case 'uml-actor': {
         const { createUmlActorCard } = await import('./uml.js');
         createUmlActorCard({ x: w.x - 40, y: w.y - 60, width: d.width, height: d.height, label: d.label });
         break;
       }
       case 'uml-usecase': {
         const { createUmlUseCaseCard } = await import('./uml.js');
         createUmlUseCaseCard({ x: w.x - 90, y: w.y - 40, width: d.width, height: d.height, content: d.content });
         break;
       }
       case 'uml-note': {
         const { createUmlNoteCard } = await import('./uml.js');
         createUmlNoteCard({ x: w.x - 100, y: w.y - 50, width: d.width, height: d.height, content: d.content });
         break;
       }
     }
     toast('Card colado');
   }
   
   /* ─────────────────────────────────────────────────────────────────────
      Exports + Toast
      ───────────────────────────────────────────────────────────────────── */
   
   export { enableDrag };
   
   let toastEl;
   export function toast(msg) {
     if (!toastEl) {
       toastEl = document.createElement('div');
       toastEl.className = 'toast';
       document.body.appendChild(toastEl);
     }
     toastEl.textContent = msg;
     toastEl.classList.add('is-visible');
     clearTimeout(toast._t);
     toast._t = setTimeout(() => toastEl.classList.remove('is-visible'), 1200);
   }
   
   /* ════════════════════════════════════════════════════════════════════
      FIX — Paste em .card__code preserva indentação e ignora HTML
      ────────────────────────────────────────────────────────────────────
      Estratégia atualizada (Range API pura, sem execCommand):
        · execCommand('insertText') no Chrome AINDA pode gerar <div>/<br>
          mesmo em <pre>. Range.insertNode com um único TextNode garante
          que o \n vai como caractere literal e o <pre>+pre-wrap renderiza.
        · Capture=true + stopPropagation → não conflita com o handler de
          paste global (que criaria uma nova nota/code card).
      ════════════════════════════════════════════════════════════════════ */
   document.addEventListener('paste', (e) => {
     const codeEl = e.target.closest?.('.card__code');
     if (!codeEl) return;
   
     e.preventDefault();
     e.stopPropagation();
   
     const text = e.clipboardData?.getData('text/plain') ?? '';
     if (!text) return;
   
     const sel = window.getSelection();
     const node = document.createTextNode(text);
   
     if (!sel || sel.rangeCount === 0 || !codeEl.contains(sel.anchorNode)) {
       codeEl.appendChild(node);
     } else {
       const range = sel.getRangeAt(0);
       range.deleteContents();
       range.insertNode(node);
       /* Move o caret pra depois do texto inserido. */
       range.setStartAfter(node);
       range.setEndAfter(node);
       sel.removeAllRanges();
       sel.addRange(range);
     }
   
     codeEl.dispatchEvent(new Event('input', { bubbles: true }));
   }, true);