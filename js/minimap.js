/* ════════════════════════════════════════════════════════════════════
   minimap.js — Mini-mapa navegável
   ────────────────────────────────────────────────────────────────────
   - SVG no canto inferior direito (acima do HUD de zoom).
   - Renderiza cada card/sticker/frame como um <rect> colorido por tipo.
   - Mostra a área visível como um retângulo de contorno terracota.
   - Clique → panTo() suave até aquele ponto.
   - Re-renderiza quando:
       · estado de pan/zoom muda (onStateChange do canvas.js)
       · cards são adicionados/removidos (MutationObserver)
       · cards se movem (evento 'cardmoved' borbulhando do drag)
   ════════════════════════════════════════════════════════════════════ */

   import { onStateChange, screenToWorld, panTo } from './canvas.js';

   const world = document.getElementById('world');
   
   /* ────── Estrutura DOM ────── */
   const mm = document.createElement('div');
   mm.className = 'minimap';
   mm.innerHTML = `
     <div class="minimap__label">mapa</div>
     <svg class="minimap__svg" preserveAspectRatio="xMidYMid meet">
       <g class="minimap__items"></g>
       <rect class="minimap__viewport" fill="none"
             stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"
             rx="2"/>
     </svg>
   `;
   document.body.appendChild(mm);
   
   const svg     = mm.querySelector('.minimap__svg');
   const itemsG  = mm.querySelector('.minimap__items');
   const vpRect  = mm.querySelector('.minimap__viewport');
   
   const MAP_W = 184, MAP_H = 124;
   let currentBounds = null;
   
   /* ────── Cores por tipo (consistente com os dots dos cards) ────── */
   const COLORS = {
     note:    'oklch(0.55 0.17 295)',    // roxo (accent)
     code:    'oklch(0.65 0.13 220)',    // azul
     image:   'oklch(0.55 0.17 295)',
     youtube: 'oklch(0.55 0.20 25)',     // vermelho dessat
     audio:   'oklch(0.65 0.13 220)',
     video:   'oklch(0.55 0.20 25)',
     frame:   'rgba(26, 26, 24, 0.18)',  // moldura: cor de papel "fantasma"
   };
   
   /* ────── Computa bounds englobando tudo + viewport ──────
      Pad para deixar respirar; ajusta aspect ratio do mapa para que clicks
      mapeiem linearmente sem distorção.                                  */
   function computeBounds() {
     const els = [...world.querySelectorAll('.card')];
   
     let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
     els.forEach((el) => {
       const x = parseFloat(el.style.left) || 0;
       const y = parseFloat(el.style.top)  || 0;
       const w = el.offsetWidth;
       const h = el.offsetHeight;
       if (!w || !h) return;
       if (x < minX) minX = x;
       if (y < minY) minY = y;
       if (x + w > maxX) maxX = x + w;
       if (y + h > maxY) maxY = y + h;
     });
   
     // Inclui a viewport atual nos limites.
     const tl = screenToWorld(0, 0);
     const br = screenToWorld(window.innerWidth, window.innerHeight);
     minX = Math.min(minX, tl.x); minY = Math.min(minY, tl.y);
     maxX = Math.max(maxX, br.x); maxY = Math.max(maxY, br.y);
   
     if (!isFinite(minX)) { minX = tl.x; minY = tl.y; maxX = br.x; maxY = br.y; }
   
     // Padding 12% para visual respirar.
     const px = (maxX - minX) * 0.12;
     const py = (maxY - minY) * 0.12;
     minX -= px; maxX += px; minY -= py; maxY += py;
   
     // Ajusta para o aspect ratio do mapa (sem distorção em click→world).
     const mapAspect = MAP_W / MAP_H;
     const curAspect = (maxX - minX) / (maxY - minY);
     if (curAspect > mapAspect) {
       const targetH = (maxX - minX) / mapAspect;
       const pad = (targetH - (maxY - minY)) / 2;
       minY -= pad; maxY += pad;
     } else {
       const targetW = (maxY - minY) * mapAspect;
       const pad = (targetW - (maxX - minX)) / 2;
       minX -= pad; maxX += pad;
     }
   
     return { minX, minY, maxX, maxY };
   }
   
   /* ────── Render ────── */
   function render() {
     const b = computeBounds();
     currentBounds = b;
     const w = b.maxX - b.minX, h = b.maxY - b.minY;
     svg.setAttribute('viewBox', `${b.minX} ${b.minY} ${w} ${h}`);
   
     /* Items */
     let html = '';
     [...world.querySelectorAll('.card')].forEach((c) => {
       const type = [...c.classList].find((cls) => cls.startsWith('card--'))?.slice(6) || 'note';
       const x = parseFloat(c.style.left) || 0;
       const y = parseFloat(c.style.top)  || 0;
       const cw = c.offsetWidth, ch = c.offsetHeight;
       if (!cw || !ch) return;
       const color = COLORS[type] || COLORS.note;
       const isFrame = type === 'frame';
       html += isFrame
         ? `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" fill="none"
                 stroke="rgba(26,26,24,0.35)" stroke-width="${w*0.003}" stroke-dasharray="${w*0.01} ${w*0.006}"/>`
         : `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" fill="${color}" opacity="0.85"
                 rx="${Math.min(cw, ch) * 0.06}"/>`;
     });
     /* (Projetos como cards-rótulo foram removidos: agora cada projeto é
        um canvas separado, gerenciado por projects.js + persistence.js. ) */
     itemsG.innerHTML = html;
   
     /* Viewport indicator */
     const tl = screenToWorld(0, 0);
     const br = screenToWorld(window.innerWidth, window.innerHeight);
     vpRect.setAttribute('x', tl.x);
     vpRect.setAttribute('y', tl.y);
     vpRect.setAttribute('width',  br.x - tl.x);
     vpRect.setAttribute('height', br.y - tl.y);
   }
   
   /* ────── Re-render triggers ────── */
   
   /* Coalesce múltiplas chamadas em um único frame. */
   let rafPending = false;
   function scheduleRender() {
     if (rafPending) return;
     rafPending = true;
     requestAnimationFrame(() => { rafPending = false; render(); });
   }
   
   onStateChange(() => scheduleRender());
   document.addEventListener('cardmoved', () => scheduleRender());
   new MutationObserver(scheduleRender).observe(world, { childList: true });
   window.addEventListener('resize', scheduleRender);
   
   /* ────── Click → panTo ──────
      getBoundingClientRect do SVG dá o tamanho EFETIVO renderizado;
      currentBounds dá as coordenadas de MUNDO. Mapeamento linear.   */
   mm.addEventListener('click', (e) => {
     if (!currentBounds || e.target.closest('.minimap__label')) return;
     const svgRect = svg.getBoundingClientRect();
     const fx = (e.clientX - svgRect.left) / svgRect.width;
     const fy = (e.clientY - svgRect.top)  / svgRect.height;
     if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
     const b = currentBounds;
     panTo({
       worldX: b.minX + fx * (b.maxX - b.minX),
       worldY: b.minY + fy * (b.maxY - b.minY),
       duration: 500,
     });
   });
   
   /* Render inicial. */
   render();