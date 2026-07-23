/* ════════════════════════════════════════════════════════════════════
   drawing.js — Caneta livre + Borracha sobre uma camada SVG do mundo
   ────────────────────────────────────────────────────────────────────
   Por que SVG dentro do world (e não Canvas 2D na viewport)?
     - Strokes precisam viver em coordenadas DO MUNDO. Quando o usuário
       dá zoom ou pan, eles devem se mover/escalar junto com o conteúdo.
       SVG dentro de um elemento com transform: scale() herda isso
       de graça. Canvas 2D exigiria redesenhar tudo a cada zoom.
     - SVG tem stroke-linecap/join e suavização que dão sensação
       analógica de tinta sem trabalho extra.

   Como o input é capturado:
     - O viewport (não o SVG) escuta pointerdown/move/up em CAPTURA.
     - Quando há ferramenta ativa, prevenimos pan/drag e desenhamos.
     - canvas.js verifica body.is-drawing para abortar pan.
     - .card recebe pointer-events: none enquanto desenha (via CSS).

   Suavização: Quadratic Bézier entre pontos médios consecutivos.
   É o truque clássico — barato, redondo, sem oscilação.

   MUDANÇAS SPRINT 4 (paleta expandida):
     - 14 cores predefinidas (12 OKLCH harmônicas + preto + branco).
     - Botão "cor customizada" via <input type="color">.
     - Última cor usada persiste em localStorage.
   ════════════════════════════════════════════════════════════════════ */

   import { screenToWorld, getScale } from './canvas.js';

   const viewport = document.getElementById('viewport');
   const world    = document.getElementById('world');
   console.log('%c[drawing.js] ✓ SPRINT-5B LOADED', 'background:#f6c; color:#000; padding:2px 6px;');
   
   /* ───────── Camada SVG ─────────
      Dimensionada grande o suficiente para cobrir qualquer área prática
      navegada via pan. Não cresce dinamicamente — paths que saem fora do
      viewBox ainda renderizam, porque setamos overflow visible.        */
   
   const SVG_NS = 'http://www.w3.org/2000/svg';
   const svg = document.createElementNS(SVG_NS, 'svg');
   svg.setAttribute('class', 'draw-layer');
   svg.setAttribute('id', 'draw-layer');
   svg.setAttribute('width', '40000');
   svg.setAttribute('height', '40000');
   svg.setAttribute('viewBox', '-20000 -20000 40000 40000');
   svg.style.position = 'absolute';
   svg.style.left = '-20000px';
   svg.style.top  = '-20000px';
   svg.style.overflow = 'visible';
   svg.style.pointerEvents = 'none';
   svg.style.zIndex = '0';
   world.appendChild(svg);
   
   /* ───────── Paleta de cores (Sprint 4) ─────────
      OKLCH escolhido para ficar visualmente coerente com o app (tons
      quentes-neutros + accent roxo). Preto e branco pra extremos. */
   const COLOR_PALETTE = [
     { v: '#1a1a18',                label: 'tinta'      },
     { v: '#ffffff',                label: 'branco'     },
     { v: 'oklch(0.55 0.20 25)',    label: 'vermelho'   },
     { v: 'oklch(0.62 0.15 45)',    label: 'terracota'  },
     { v: 'oklch(0.72 0.15 75)',    label: 'âmbar'      },
     { v: 'oklch(0.75 0.15 105)',   label: 'oliva'      },
     { v: 'oklch(0.60 0.16 145)',   label: 'verde'      },
     { v: 'oklch(0.65 0.13 180)',   label: 'ciano'      },
     { v: 'oklch(0.55 0.15 220)',   label: 'azul'       },
     { v: 'oklch(0.50 0.18 265)',   label: 'anil'       },
     { v: 'oklch(0.55 0.17 295)',   label: 'roxo'       },
     { v: 'oklch(0.60 0.20 330)',   label: 'magenta'    },
     { v: 'oklch(0.65 0.18 355)',   label: 'rosa'       },
     { v: 'oklch(0.50 0.02 90)',    label: 'grafite'    },
   ];
   
   const COLOR_STORAGE_KEY = 'whiteboard:pen-color';
   
   /* ───────── Estado da ferramenta ───────── */
   
   const state = {
     tool:  null,        // null | 'pen' | 'eraser'
     color: localStorage.getItem(COLOR_STORAGE_KEY) || COLOR_PALETTE[0].v,
     size:  2,           // espessura em UNIDADES DE MUNDO
   };
   
   /* ───────── FAB (mirror da HUD de zoom no canto oposto) ─────────
      Mantemos a mesma "pílula" visual para parecer parte do sistema. */
   const fab = document.createElement('div');
   fab.className = 'draw-fab';
   fab.innerHTML = `
     <button class="draw-fab__btn" data-tool="pen"    title="Caneta (P)">✎</button>
     <button class="draw-fab__btn" data-tool="eraser" title="Borracha (E)">⌫</button>
     <span class="draw-fab__sep" data-show-when="drawing"></span>
     <div class="draw-fab__colors" data-show-when="drawing">
       ${COLOR_PALETTE.map((c) => `
         <button class="draw-fab__color" data-color="${c.v}"
                 style="--c:${c.v}" title="${c.label}" aria-label="${c.label}"></button>
       `).join('')}
       <label class="draw-fab__color-custom" title="Cor personalizada">
         <input type="color" class="draw-fab__color-input" value="#1a1a18" aria-label="Cor personalizada">
         <span class="draw-fab__color-custom-icon">＋</span>
       </label>
     </div>
     <span class="draw-fab__sep" data-show-when="drawing"></span>
     <button class="draw-fab__btn draw-fab__btn--text" data-action="clear"
             data-show-when="drawing" title="Limpar todos os desenhos">Limpar</button>
   `;
   document.body.appendChild(fab);
   
   /* Marca a cor inicial como ativa. */
   function markActiveColor(color) {
     fab.querySelectorAll('[data-color]').forEach((b) => {
       b.classList.toggle('is-active', b.dataset.color === color);
     });
   }
   markActiveColor(state.color);
   
   /* ───────── Wireup do FAB ───────── */
   function setTool(t) {
     state.tool = (state.tool === t) ? null : t;
     document.body.classList.toggle('is-drawing', !!state.tool);
     document.body.classList.toggle('is-erasing', state.tool === 'eraser');
     fab.classList.toggle('is-expanded', !!state.tool);
     fab.querySelectorAll('[data-tool]').forEach((b) =>
       b.classList.toggle('is-active', b.dataset.tool === state.tool));
   }
   fab.querySelectorAll('[data-tool]').forEach((b) =>
     b.addEventListener('click', () => setTool(b.dataset.tool)));
   
   /* Cores predefinidas. */
   fab.querySelectorAll('[data-color]').forEach((b) =>
     b.addEventListener('click', () => {
       state.color = b.dataset.color;
       localStorage.setItem(COLOR_STORAGE_KEY, state.color);
       markActiveColor(state.color);
       // Se a borracha estava ativa, ao clicar uma cor volta para caneta.
       if (state.tool !== 'pen') setTool('pen');
     }));
   
   /* Cor customizada via <input type="color">. */
   const customInput = fab.querySelector('.draw-fab__color-input');
   if (customInput) {
     customInput.addEventListener('input', (e) => {
       state.color = e.target.value;
       localStorage.setItem(COLOR_STORAGE_KEY, state.color);
       // Remove destaque das predefinidas quando usa custom.
       fab.querySelectorAll('[data-color]').forEach((b) => b.classList.remove('is-active'));
       if (state.tool !== 'pen') setTool('pen');
     });
     // Clique no ícone abre o color picker.
     customInput.addEventListener('click', (e) => e.stopPropagation());
   }
   
   fab.querySelector('[data-action="clear"]').addEventListener('click', () => {
    if (!svg.children.length) return;
    if (!confirm('Apagar todos os desenhos do canvas?')) return;
    svg.innerHTML = '';
    document.dispatchEvent(new CustomEvent('strokedone'));
  });
   
   /* ───────── Caneta ─────────
      Cada stroke = um <path> + array _points armazenado no elemento.
      _points é usado depois pela borracha (hit-test em distância). */
   let currentPath = null;
   let points = [];
   
   viewport.addEventListener('pointerdown', (e) => {
     if (!state.tool) return;
     if (e.button !== 0) return;
     e.stopPropagation();           // bloqueia pan / drag de card
     e.preventDefault();
     viewport.setPointerCapture(e.pointerId);
     console.log('[drawing] pointerdown tool=', state.tool);
   
     if (state.tool === 'pen')    startStroke(e);
     if (state.tool === 'eraser') eraseAt(e);
   }, true);
   
   viewport.addEventListener('pointermove', (e) => {
     if (!state.tool) return;
     if (state.tool === 'pen' && currentPath) extendStroke(e);
     if (state.tool === 'eraser' && (e.buttons & 1)) eraseAt(e);
   }, true);
   
   /* Sprint 5: pointerup/pointercancel/lostpointercapture — qualquer um
      encerra o traço. Sem isso, gesture cancelado (touchpad, alt+tab,
      dev-tools abrindo) deixava currentPath pendurado e nada persistia. */
   function pointerEndDraw(e) {
     console.log('[drawing]', e.type, 'currentPath=', !!currentPath);
     if (state.tool === 'pen' && currentPath) endStroke();
     try { viewport.releasePointerCapture(e.pointerId); } catch {}
   }
   viewport.addEventListener('pointerup',          pointerEndDraw, true);
   viewport.addEventListener('pointercancel',      pointerEndDraw, true);
   viewport.addEventListener('lostpointercapture', pointerEndDraw, true);
   
   function startStroke(e) {
     const w = screenToWorld(e.clientX, e.clientY);
     points = [w];
   
     currentPath = document.createElementNS(SVG_NS, 'path');
     currentPath.setAttribute('fill', 'none');
     currentPath.setAttribute('stroke', state.color);
     currentPath.setAttribute('stroke-width', String(state.size));
     currentPath.setAttribute('stroke-linecap', 'round');
     currentPath.setAttribute('stroke-linejoin', 'round');
     currentPath.setAttribute('d', `M ${w.x} ${w.y}`);
     currentPath._points = points;          // referência para a borracha
     svg.appendChild(currentPath);
   }
   
   function extendStroke(e) {
     const w = screenToWorld(e.clientX, e.clientY);
     // Pequeno filtro: ignora amostras muito próximas (reduz ruído).
     const last = points[points.length - 1];
     const dx = w.x - last.x, dy = w.y - last.y;
     if (dx * dx + dy * dy < 1) return;
     points.push(w);
     currentPath.setAttribute('d', smoothPath(points));
   }
   
   function endStroke() {
    // Se for só um ponto, vira um pingo (círculo) — visualmente mais fiel.
    if (points.length === 1) {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', points[0].x);
      dot.setAttribute('cy', points[0].y);
      dot.setAttribute('r',  String(state.size / 2));
      dot.setAttribute('fill', state.color);
      dot._points = points;
      svg.appendChild(dot);
      currentPath.remove();
    }
    currentPath = null;
    points = [];
    // Sprint 5: log explícito + dispatch. Se não aparecer no console
    // ao soltar o mouse, o problema é que pointerup não chega aqui.
    console.log('[drawing] endStroke → dispatching strokedone. svg tem', svg.children.length, 'filhos');
    document.dispatchEvent(new CustomEvent('strokedone'));
  }
   
   /* Suavização via midpoints. M → Q control=ponto_i, end=mid(i,i+1). */
   function smoothPath(pts) {
     if (pts.length < 3) {
       if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
       return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
     }
     let d = `M ${pts[0].x} ${pts[0].y}`;
     for (let i = 1; i < pts.length - 1; i++) {
       const mx = (pts[i].x + pts[i + 1].x) / 2;
       const my = (pts[i].y + pts[i + 1].y) / 2;
       d += ` Q ${pts[i].x} ${pts[i].y} ${mx} ${my}`;
     }
     const last = pts[pts.length - 1];
     d += ` L ${last.x} ${last.y}`;
     return d;
   }
   
   /* ────────────────────────────────────────────────────────────────────
      restoreStroke(data) — reconstrói um path/circle salvo da persistência
      data: { kind: 'path'|'circle', points: [[x,y]…], color, size }
      ──────────────────────────────────────────────────────────────────── */
   export function restoreStroke({ kind, points, color, size }) {
     if (!points || !points.length) return;
     const pts = points.map(([x, y]) => ({ x, y }));
   
     if (kind === 'circle') {
       const el = document.createElementNS(SVG_NS, 'circle');
       el.setAttribute('cx', pts[0].x);
       el.setAttribute('cy', pts[0].y);
       el.setAttribute('r',  String(size / 2));
       el.setAttribute('fill', color);
       el._points = pts;
       svg.appendChild(el);
       return el;
     }
   
     const el = document.createElementNS(SVG_NS, 'path');
     el.setAttribute('fill', 'none');
     el.setAttribute('stroke', color);
     el.setAttribute('stroke-width', String(size));
     el.setAttribute('stroke-linecap', 'round');
     el.setAttribute('stroke-linejoin', 'round');
     el.setAttribute('d', smoothPath(pts));
     el._points = pts;
     svg.appendChild(el);
     return el;
   }
   
   /* ───────── Borracha ─────────
      Hit-test: remove o stroke inteiro se QUALQUER ponto registrado está
      dentro do raio do cursor (em pixels de tela, convertido p/ mundo). */
   
      function eraseAt(e) {
        const w = screenToWorld(e.clientX, e.clientY);
        const radiusWorld = 10 / getScale();
        const r2 = radiusWorld * radiusWorld;
        let removed = false;
      
        [...svg.children].forEach((p) => {
          const pts = p._points;
          if (!pts) return;
          for (const pt of pts) {
            const dx = pt.x - w.x, dy = pt.y - w.y;
            if (dx * dx + dy * dy < r2) { p.remove(); removed = true; return; }
          }
        });
      
        // Sprint 3 fix: notifica que algo mudou na camada de desenho.
        if (removed) document.dispatchEvent(new CustomEvent('strokedone'));
      }
   
   /* ───────── Atalhos ───────── */
   document.addEventListener('keydown', (e) => {
     const t = e.target;
     if (t && (t.isContentEditable || /input|textarea|select/i.test(t.tagName))) return;
     if (e.metaKey || e.ctrlKey || e.altKey) return;
   
     if (e.key.toLowerCase() === 'p') setTool('pen');
     if (e.key.toLowerCase() === 'e') setTool('eraser');
     if (e.key === 'Escape' && state.tool) setTool(state.tool);  // toggle off
   });