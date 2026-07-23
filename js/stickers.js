/* ════════════════════════════════════════════════════════════════════
   stickers.js — Adesivos Inteligentes
   ────────────────────────────────────────────────────────────────────
   Conceito (do PRD):
     "Elementos visuais (ícones/stickers) que podem ser arrastados
      para o quadro. Deixe a estrutura JS preparada para que eles
      tenham 'comportamentos' no futuro."

   Implementação:
     - Cada sticker é um pequeno elemento absoluto no `world` — NÃO
       reusa o chrome de card; é só o glifo + close button (hover).
     - Cada sticker tem `data-behavior` (string vazia por padrão).
       Um registry global (`window.__stickerBehaviors`) mapeia
       nome → função aplicada no elemento. Quando um sticker é criado,
       chamamos o behavior se existir.
     - Paleta: drawer no canto superior direito. Click no glifo → cria
       sticker no centro da viewport. Simples; pode crescer para drag.
   ════════════════════════════════════════════════════════════════════ */

import { screenToWorld } from './canvas.js';
import { enableDrag }     from './cards.js';

const world = document.getElementById('world');

/* ────── Registry de comportamentos (placeholder Fase 4+) ──────
   Exemplo de uso futuro:
     window.__stickerBehaviors.pulse = (el) => el.classList.add('sticker--pulse');
*/
window.__stickerBehaviors = window.__stickerBehaviors || {
  /* Aplicado no elemento do sticker quando criado. Adicionar mais aqui
     é trivial — cada um é só uma função (el) => void.                  */
  pulse:   (el) => el.classList.add('sticker--pulse'),
  spin:    (el) => el.classList.add('sticker--spin'),
  sparkle: (el) => el.classList.add('sticker--sparkle'),
  /* Vazio = sem comportamento: o sticker fica estático (útil para setas
     e marcadores que não devem chamar atenção constantemente).         */
  '':      () => {},
};

/* ────── Catálogo ──────
   SVGs pequenos, traço fino. Estética coerente com o resto do app.
   `behavior` é um nome conceitual; a função real vive no registry.   */
const CATALOG = [
  { id: 'star',   name: 'destaque',  behavior: 'sparkle',
    svg: `<path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7L12 17l-6.3 3.9 1.7-7L2 9.2l7.1-.6L12 2z"
                 stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/>` },
  { id: 'arrow',  name: 'fluxo',     behavior: '',
    svg: `<path d="M3 12h17M14 6l6 6-6 6"
                 stroke="currentColor" stroke-width="1.6" fill="none"
                 stroke-linecap="round" stroke-linejoin="round"/>` },
  { id: 'heart',  name: 'favorito',  behavior: 'pulse',
    svg: `<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"
                 stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/>` },
  { id: 'check',  name: 'feito',     behavior: '',
    svg: `<path d="M4 12l5 5 11-11"
                 stroke="currentColor" stroke-width="1.8" fill="none"
                 stroke-linecap="round" stroke-linejoin="round"/>` },
  { id: 'alert',  name: 'atenção',   behavior: 'pulse',
    svg: `<path d="M12 4l10 17H2L12 4z M12 10v5 M12 18v.5"
                 stroke="currentColor" stroke-width="1.4" fill="none"
                 stroke-linejoin="round" stroke-linecap="round"/>` },
  { id: 'idea',   name: 'ideia',     behavior: 'sparkle',
    svg: `<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"
                 stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/>` },
  { id: 'target', name: 'foco',      behavior: 'pulse',
    svg: `<circle cx="12" cy="12" r="9"   stroke="currentColor" stroke-width="1.4" fill="none"/>
          <circle cx="12" cy="12" r="5.5" stroke="currentColor" stroke-width="1.4" fill="none"/>
          <circle cx="12" cy="12" r="1.6" fill="currentColor"/>` },
  { id: 'flag',   name: 'marco',     behavior: 'spin',
    svg: `<path d="M5 3v18 M5 4h12l-3 4 3 4H5"
                 stroke="currentColor" stroke-width="1.4" fill="none"
                 stroke-linejoin="round" stroke-linecap="round"/>` },
];

/* ────── Criação de sticker no world ────── */
let zCounter = 9000;             // namespace de z separado dos cards
export function createSticker({ id, x, y }) {
  const def = CATALOG.find((c) => c.id === id) || CATALOG[0];

  const el = document.createElement('div');
  el.className = 'sticker';
  el.dataset.stickerId = def.id;
  el.dataset.behavior  = def.behavior;
  el.style.left   = `${x}px`;
  el.style.top    = `${y}px`;
  el.style.zIndex = ++zCounter;
  // O sticker INTEIRO é a área de arrasto.
  el.dataset.dragHandle = 'true';
  el.innerHTML = `
    <button class="sticker__close" aria-label="Remover" title="Remover">×</button>
    <svg class="sticker__glyph" viewBox="0 0 24 24" aria-hidden="true">${def.svg}</svg>
  `;
  el.querySelector('.sticker__close').addEventListener('click', (e) => {
    e.stopPropagation();
    el.remove();
  });

  world.appendChild(el);
  enableDrag(el);

  // Aplica behavior registrado, se houver.
  const behavior = window.__stickerBehaviors[def.behavior];
  if (typeof behavior === 'function') behavior(el);

  return el;
}

/* ────────────────────────────────────────────────────────────────────
   PALETA — drawer no canto superior direito
   ──────────────────────────────────────────────────────────────────── */

const trigger = document.getElementById('sticker-toggle');

const palette = document.createElement('div');
palette.className = 'sticker-palette';
palette.hidden = true;
palette.innerHTML = `
  <div class="sticker-palette__title">Smart stickers</div>
  <div class="sticker-palette__grid"></div>
  <div class="sticker-palette__hint">clique para adicionar no centro</div>
`;
document.body.appendChild(palette);

const grid = palette.querySelector('.sticker-palette__grid');
CATALOG.forEach((def) => {
  const btn = document.createElement('button');
  btn.className = 'sticker-palette__item';
  btn.title = def.name;
  btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${def.svg}</svg>`;
  btn.addEventListener('click', () => {
    const w = screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
    createSticker({ id: def.id, x: w.x - 24, y: w.y - 24 });
    close();
  });
  grid.appendChild(btn);
});

function toggle() { palette.hidden ? open() : close(); }
function open()   {
  palette.hidden = false;
  const r = trigger.getBoundingClientRect();
  palette.style.top   = `${r.bottom + 8}px`;
  palette.style.right = `${window.innerWidth - r.right}px`;
  trigger.classList.add('is-active');
}
function close() {
  palette.hidden = true;
  trigger.classList.remove('is-active');
}

trigger.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
document.addEventListener('pointerdown', (e) => {
  if (!palette.hidden && !palette.contains(e.target) && e.target !== trigger) close();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
