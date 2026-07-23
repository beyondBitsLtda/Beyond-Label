/* ════════════════════════════════════════════════════════════════════
   canvas.js — Pan, Zoom e conversão de coordenadas
   ────────────────────────────────────────────────────────────────────
   Modelo mental:
   - viewport: a janela do navegador (fixa).
   - world:    plano infinito; sofre translate(tx, ty) scale(z).
   - Cards vivem em coordenadas do MUNDO (não da tela).
   - Para criar um card no ponto onde o usuário clicou, convertemos
     coordenadas de tela → mundo via screenToWorld().

   Sprint atual (zoom sem escorregar):
   - Wheel só zooma com Ctrl/Meta (ou pinch de trackpad, que envia
     ctrlKey=true nativamente). Scroll comum = pan (Sprint anterior).
   - Zoom guarda uma ÂNCORA (ponto do mundo sob o cursor). A cada
     frame da animação, tx/ty é DERIVADO de z + âncora — nunca
     interpolado separadamente. Assim o ponto sob o cursor fica
     cravado o tempo inteiro, sem salto ao soltar o gesto.
   - Botão +/− do HUD e reset limpam a âncora (fallback antigo).
   ════════════════════════════════════════════════════════════════════ */

   const viewport  = document.getElementById('viewport');
   const world     = document.getElementById('world');
   const zoomLabel = document.getElementById('zoom-level');
   
   /* Âncora do zoom — ponto do mundo sob o cursor no início do gesto.
      Cada frame da animação recalcula tx/ty a partir daqui pra manter
      esse ponto do mundo cravado na posição da tela. */
   let zoomAnchor = null;   // { sx, sy, wx, wy } | null
   
   /* Estado do canvas. Único ponto de verdade. */
   const state = {
     tx: 0,             // translação x (em px de tela)
     ty: 0,             // translação y (em px de tela)
     z:  1,             // zoom (1 = 100%)
     min: 0.2,
     max: 4,
   };
   
   /* Alvo do zoom suave — o handler do wheel atualiza este alvo, e um
      RAF interpola state em direção a ele. Mantido sincronizado com
      state quando outras vias (pan, botões, atalhos) movem o canvas. */
   let target = { tx: 0, ty: 0, z: 1 };
   let zoomRaf = null;
   
   /* Aplica o transform e atualiza o HUD de zoom. */
   function apply() {
     world.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.z})`;
     zoomLabel.textContent = `${Math.round(state.z * 100)}%`;
     subscribers.forEach((cb) => cb(state));
   }
   
   /* Assinaturas externas para o estado do canvas (ler-apenas). */
   const subscribers = new Set();
   export function onStateChange(cb) {
     subscribers.add(cb);
     cb(state);
     return () => subscribers.delete(cb);
   }
   
   /* Cancela o RAF de zoom e trava o alvo no estado atual. Chamado
      sempre que uma interação nova começa ou termina, para que a
      animação em curso não "puxe" o canvas para outro lugar. */
   function cancelZoomAnimation() {
     if (zoomRaf != null) {
       cancelAnimationFrame(zoomRaf);
       zoomRaf = null;
     }
     target.tx = state.tx;
     target.ty = state.ty;
     target.z  = state.z;
     zoomAnchor = null;
   }
   
   /* ───────── Pan via arrasto com botão esquerdo no fundo ─────────
      Pan NÃO acontece quando o usuário clica dentro de um card — esse
      caso é tratado em cards.js (drag de card). */
   
   let isPanning = false;
   let panStart  = { x: 0, y: 0, tx: 0, ty: 0 };
   
   viewport.addEventListener('pointerdown', (e) => {
     if (e.button !== 0) return;
     if (document.body.classList.contains('is-drawing')) return;
     if (e.target.closest('.card')) return;
     if (e.target.closest('.draw-fab, .context-menu, .hud, .minimap')) return;
   
     cancelZoomAnimation();
   
     isPanning = true;
     panStart.x  = e.clientX;
     panStart.y  = e.clientY;
     panStart.tx = state.tx;
     panStart.ty = state.ty;
     viewport.classList.add('is-panning');
     try { viewport.setPointerCapture(e.pointerId); } catch {}
   });
   
   viewport.addEventListener('pointermove', (e) => {
     if (!isPanning) return;
     state.tx = panStart.tx + (e.clientX - panStart.x);
     state.ty = panStart.ty + (e.clientY - panStart.y);
     target.tx = state.tx;
     target.ty = state.ty;
     apply();
   });
   
   function endPan(e) {
     if (!isPanning) return;
     isPanning = false;
     viewport.classList.remove('is-panning');
     try { viewport.releasePointerCapture(e.pointerId); } catch {}
     cancelZoomAnimation();
   }
   viewport.addEventListener('pointerup',     endPan);
   viewport.addEventListener('pointercancel', endPan);
   
   /* ───────── Constantes do zoom ───────── */
   const SMOOTHING = 0.22;
   const WHEEL_INT = 0.0012;   // sensibilidade pra roda de mouse
   const PINCH_INT = 0.012;    // sensibilidade pra pinch (deltas pequenos)
   const MAX_STEP  = 1.15;     // fator máx por evento
   
   /* ═════════════════════════════════════════════════════════════════
      stepZoom — interpola SÓ o zoom; tx/ty é derivado da âncora
      ─────────────────────────────────────────────────────────────────
      Bug antigo: interpolava tx/ty separadamente de z. Durante os
      frames intermediários o ponto sob o cursor escorregava e "saltava"
      ao final. Agora tx/ty é uma FUNÇÃO de z e da âncora, garantindo
      que o worldPoint (wx,wy) permaneça sob (sx,sy) o tempo inteiro.
      ═════════════════════════════════════════════════════════════════ */
   function stepZoom() {
     zoomRaf = null;
     const dz = target.z - state.z;
   
     /* Sem âncora (ex.: zoom por botão do HUD): interpola tudo, comportamento antigo. */
     if (!zoomAnchor) {
       const dtx = target.tx - state.tx;
       const dty = target.ty - state.ty;
       if (Math.abs(dz) < 0.001 && Math.abs(dtx) < 0.5 && Math.abs(dty) < 0.5) {
         state.z  = target.z;
         state.tx = target.tx;
         state.ty = target.ty;
         apply();
         return;
       }
       state.z  += dz  * SMOOTHING;
       state.tx += dtx * SMOOTHING;
       state.ty += dty * SMOOTHING;
       apply();
       scheduleZoom();
       return;
     }
   
     /* Com âncora (wheel do usuário): interpola z, deriva tx/ty. */
     if (Math.abs(dz) < 0.001) {
       state.z  = target.z;
       state.tx = zoomAnchor.sx - zoomAnchor.wx * state.z;
       state.ty = zoomAnchor.sy - zoomAnchor.wy * state.z;
       target.tx = state.tx;
       target.ty = state.ty;
       apply();
       return;
     }
   
     state.z  += dz * SMOOTHING;
     state.tx  = zoomAnchor.sx - zoomAnchor.wx * state.z;
     state.ty  = zoomAnchor.sy - zoomAnchor.wy * state.z;
     apply();
     scheduleZoom();
   }
   
   function scheduleZoom() {
     if (zoomRaf == null) zoomRaf = requestAnimationFrame(stepZoom);
   }
   
   /* ═════════════════════════════════════════════════════════════════
      WHEEL — scroll = pan; Ctrl/Cmd+scroll = zoom
      ─────────────────────────────────────────────────────────────────
      · Roda sem modificador  → pan vertical (e horizontal em touchpads)
      · Shift+wheel           → força pan horizontal
      · Ctrl/Cmd+wheel        → zoom com âncora no cursor
      · Pinch de trackpad     → ctrlKey=true nativamente, cai no zoom
      ═════════════════════════════════════════════════════════════════ */
   viewport.addEventListener('wheel', (e) => {
     e.preventDefault();
   
     /* ── Modo ZOOM (Ctrl/Cmd ou pinch do trackpad) ──
        Aplicação DIRETA (sem RAF/smoothing) — motivo:
        cada evento de wheel ocorre num ponto ligeiramente diferente
        do cursor (o mouse balança 1-2 px enquanto o usuário gira a
        rodinha). Com smoothing por 5 frames, a âncora era recomputada
        num ponto do mundo levemente diferente a cada evento, e o alvo
        interpolado "escorregava" — dando o salto ao soltar.
        Sem smoothing, o ponto do mundo sob o cursor fica cravado no
        cursor evento por evento. Wheel já é discreto, então não perde
        nada em suavidade visual. Botões do HUD continuam animados. */
     if (e.ctrlKey || e.metaKey) {
       cancelPanAnimation();
       if (zoomRaf != null) { cancelAnimationFrame(zoomRaf); zoomRaf = null; }
       zoomAnchor = null;

       const rect = viewport.getBoundingClientRect();
       const sx = e.clientX - rect.left;
       const sy = e.clientY - rect.top;

       const wx = (sx - state.tx) / state.z;
       const wy = (sy - state.ty) / state.z;

       const intensity = Math.abs(e.deltaY) < 20 ? PINCH_INT : WHEEL_INT;
       const factor  = Math.exp(-e.deltaY * intensity);
       const clamped = Math.max(1 / MAX_STEP, Math.min(MAX_STEP, factor));

       const newZ = clamp(state.z * clamped, state.min, state.max);
       if (newZ === state.z) return;

       state.z  = newZ;
       state.tx = sx - wx * newZ;
       state.ty = sy - wy * newZ;
       target.z  = state.z;
       target.tx = state.tx;
       target.ty = state.ty;
       apply();
       return;
     }
   
     /* ── Modo PAN (scroll comum) ── */
     cancelPanAnimation();
     if (zoomRaf) { cancelAnimationFrame(zoomRaf); zoomRaf = null; }
     zoomAnchor = null;
   
     let dx = e.deltaX;
     let dy = e.deltaY;
   
     /* Shift força horizontal quando o dispositivo só manda deltaY
        (típico de mouse comum). */
     if (e.shiftKey && dx === 0) {
       dx = dy;
       dy = 0;
     }
   
     /* Normaliza deltaMode: 1=linhas, 2=páginas. */
     if (e.deltaMode === 1)      { dx *= 16;  dy *= 16;  }
     else if (e.deltaMode === 2) { dx *= viewport.clientWidth; dy *= viewport.clientHeight; }
   
     state.tx  -= dx;
     state.ty  -= dy;
     target.tx  = state.tx;
     target.ty  = state.ty;
     apply();
   }, { passive: false });
   
   /* ───────── Botões +/− do HUD ───────── */
   document.getElementById('zoom-in') ?.addEventListener('click', () => zoomBy(1.2));
   document.getElementById('zoom-out')?.addEventListener('click', () => zoomBy(1 / 1.2));
   document.getElementById('zoom-reset')?.addEventListener('click', () => {
     cancelZoomAnimation();
     zoomAnchor = null;
     state.tx = 0; state.ty = 0; state.z = 1;
     target.tx = 0; target.ty = 0; target.z = 1;
     apply();
   });
   
   function zoomBy(factor) {
     /* Zoom via botão: sem âncora do cursor (usa centro da viewport).
        Isso força o stepZoom a cair no ramo "sem âncora" e interpolar
        tx/ty separadamente — comportamento original que funciona bem. */
     zoomAnchor = null;
     const rect = viewport.getBoundingClientRect();
     const sx = rect.width  / 2;
     const sy = rect.height / 2;
     const newZ = clamp(target.z * factor, state.min, state.max);
     if (newZ === target.z) return;
     const wx = (sx - target.tx) / target.z;
     const wy = (sy - target.ty) / target.z;
     target.z  = newZ;
     target.tx = sx - wx * target.z;
     target.ty = sy - wy * target.z;
     scheduleZoom();
   }
   
   /* ───────── Atalhos de teclado ───────── */
   document.addEventListener('keydown', (e) => {
     const t = e.target;
     if (t && (t.isContentEditable || /input|textarea/i.test(t.tagName))) return;
   
     if (e.key === '0' && !e.ctrlKey && !e.metaKey && !e.altKey) {
       cancelZoomAnimation();
       zoomAnchor = null;
       state.tx = 0; state.ty = 0; state.z = 1;
       target.tx = 0; target.ty = 0; target.z = 1;
       apply();
     }
     if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
       e.preventDefault();
       zoomBy(1.2);
     }
     if ((e.ctrlKey || e.metaKey) && e.key === '-') {
       e.preventDefault();
       zoomBy(1 / 1.2);
     }
   });
   
   /* ───────── API pública ───────── */
   
   export function screenToWorld(clientX, clientY) {
     const rect = viewport.getBoundingClientRect();
     return {
       x: (clientX - rect.left - state.tx) / state.z,
       y: (clientY - rect.top  - state.ty) / state.z,
     };
   }
   
   export function getState() { return { tx: state.tx, ty: state.ty, z: state.z }; }
   
   export function setStateRaw({ tx, ty, z }) {
     cancelZoomAnimation();
     zoomAnchor = null;
     state.tx = tx;
     state.ty = ty;
     state.z  = clamp(z, state.min, state.max);
     target.tx = state.tx;
     target.ty = state.ty;
     target.z  = state.z;
     apply();
   }
   
   export function getScale() { return state.z; }
   
   /* Init */
   apply();
   
   function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
   
   /* ────────────────────────────────────────────────────────────────────
      panTo() — animação suave até um ponto do mundo
      Usado pelo modo Storyboard (fly-through) e pelo mini-mapa (jump).
      ──────────────────────────────────────────────────────────────────── */
   let panAnimation = null;
   function cancelPanAnimation() {
     if (panAnimation) {
       panAnimation.cancelled = true;
       panAnimation = null;
     }
   }
   
   export function panTo({ worldX, worldY, z, viewportX, viewportY, duration = 700 } = {}) {
     cancelPanAnimation();
     cancelZoomAnimation();
   
     const vpX = viewportX ?? window.innerWidth  / 2;
     const vpY = viewportY ?? window.innerHeight / 2;
     const targetZ  = z != null ? clamp(z, state.min, state.max) : state.z;
     const targetTx = vpX - worldX * targetZ;
     const targetTy = vpY - worldY * targetZ;
   
     const startTx = state.tx, startTy = state.ty, startZ = state.z;
     const dTx = targetTx - startTx;
     const dTy = targetTy - startTy;
     const dZ  = targetZ  - startZ;
   
     const t0 = performance.now();
     const anim = { cancelled: false };
     panAnimation = anim;
   
     return new Promise((resolve) => {
       function frame(now) {
         if (anim.cancelled) return resolve();
         const t = Math.min(1, (now - t0) / duration);
         const ease = 1 - Math.pow(1 - t, 3); // ease-out cúbica
         state.tx = startTx + dTx * ease;
         state.ty = startTy + dTy * ease;
         state.z  = startZ  + dZ  * ease;
         target.tx = state.tx;
         target.ty = state.ty;
         target.z  = state.z;
         apply();
         if (t < 1) requestAnimationFrame(frame);
         else { panAnimation = null; resolve(); }
       }
       requestAnimationFrame(frame);
     });
   }