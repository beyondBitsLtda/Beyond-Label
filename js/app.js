/* ════════════════════════════════════════════════════════════════════
   app.js — Bootstrap
   ────────────────────────────────────────────────────────────────────
   Responsabilidades:
     - Dica contextual que some na primeira interação
     - Seed pendente requisitado pelo projects.js (novo canvas + template)
     - Seed de onboarding na PRIMEIRA VISITA EVER (template 'welcome')
     - Watermark de boas-vindas em QUALQUER canvas vazio (robusto, não
       depende de flag frágil)
   ════════════════════════════════════════════════════════════════════ */

import { seedTemplate, paintWelcomeMessage } from './templates.js';
import { getActiveId }                        from './projects.js';

/* ────── Versão / deploy check ────── */
const BUILD_VERSION = '2.1.0-ux-upgrade';
const BUILD_DATE    = '2026-06-16';
console.log(
  `%c[Whiteboard] v${BUILD_VERSION} — build ${BUILD_DATE}`,
  'color: #7c3aed; font-weight: bold; font-size: 13px;'
);
console.log('[Whiteboard] Módulos: drag full-body, resize 8-dir, delete universal, paste imagem, seleção global');

const hint = document.getElementById('hint');

function dismissHint() {
  hint.classList.add('is-hidden');
  ['pointerdown', 'wheel', 'keydown'].forEach((ev) =>
    window.removeEventListener(ev, dismissHint, true)
  );
}
['pointerdown', 'wheel', 'keydown'].forEach((ev) =>
  window.addEventListener(ev, dismissHint, { capture: true, once: false })
);

/* ────── Seed pendente (canvas criado via picker em projects.js) ────── */
queueMicrotask(() => {
  const seedKey = `whiteboard:seed:${getActiveId()}`;
  const pending = localStorage.getItem(seedKey);
  if (pending) {
    localStorage.removeItem(seedKey);
    try { seedTemplate(pending); } catch (e) { console.warn('seed pendente falhou', e); }
  }
});

/* ────── Primeira visita ever → welcome completo ────── */
if (!localStorage.getItem('whiteboard:visited')) {
  localStorage.setItem('whiteboard:visited', '1');
  queueMicrotask(() => {
    try { seedTemplate('welcome'); } catch (e) { console.warn('welcome seed falhou', e); }
  });
}

/* ────────────────────────────────────────────────────────────────────
   WATERMARK em canvas vazio
   ────────────────────────────────────────────────────────────────────
   Robusto: não depende de flag de "visitado". Se, após o restore e os
   seeds, o #world não tiver NENHUM card, pintamos a frase manuscrita.
   Assim ela aparece sempre que o usuário está num canvas em branco —
   não só na primeira visita. Verificação adiada para garantir que
   restore + seeds já rodaram.
──────────────────────────────────────────────────────────────────── */
setTimeout(() => {
  const world = document.getElementById('world');
  if (!world) return;
  const temCards = world.querySelector('.card');
  const jaTemWatermark = world.querySelector('.canvas-watermark');
  if (!temCards && !jaTemWatermark) {
    try { paintWelcomeMessage(); } catch (e) { console.warn('watermark falhou', e); }
  }
}, 120);