/* ════════════════════════════════════════════════════════════════════
   search.js — Paleta de comando (Cmd/Ctrl+K)
   ────────────────────────────────────────────────────────────────────
   Uma paleta unificada que indexa, em ordem de probabilidade de uso:

     1. AÇÕES rápidas — criar nota, código, frame; ligar storyboard;
        novo canvas; limpar tudo.
     2. CARDS do canvas atual — busca em texto de notas, código,
        labels de frame, URLs de YouTube etc. Clicar centra/zooma.
     3. PROJETOS — switch direto para outro canvas pelo nome.

     O ranqueamento é fuzzy-leve: pontos por match exato > prefix >
     substring; itens sem match são filtrados.
   ════════════════════════════════════════════════════════════════════ */

import { panTo, screenToWorld } from './canvas.js';
import { createCard }           from './cards.js';
import { createFrame }          from './storyboard.js';
import { pickTemplate, seedTemplate } from './templates.js';

const INDEX_KEY  = 'whiteboard:projects';
const ACTIVE_KEY = 'whiteboard:active';

/* ───────────────────────────────────────────────────────
   UI
   ─────────────────────────────────────────────────────── */

const overlay = document.createElement('div');
overlay.className = 'palette-overlay';
overlay.hidden = true;
overlay.innerHTML = `
  <div class="palette" role="dialog" aria-label="Busca rápida">
    <div class="palette__head">
      <span class="palette__icon">⌕</span>
      <input class="palette__input" type="text" autocomplete="off" spellcheck="false"
             placeholder="buscar cards, projetos, ações…">
      <kbd class="palette__esc">esc</kbd>
    </div>
    <div class="palette__results"></div>
    <div class="palette__foot">
      <span><kbd>↑↓</kbd> navegar</span>
      <span><kbd>↵</kbd> abrir</span>
      <span><kbd>esc</kbd> fechar</span>
    </div>
  </div>
`;
document.body.appendChild(overlay);

const input    = overlay.querySelector('.palette__input');
const resultsEl = overlay.querySelector('.palette__results');

let activeIdx = 0;
let currentResults = [];

/* ───────────────────────────────────────────────────────
   FONTES DE DADOS
   ─────────────────────────────────────────────────────── */

function getActions() {
  return [
    {
      kind: 'action', label: 'Criar nota', hint: 'no centro da tela',
      icon: '✎',
      run: () => {
        const c = screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
        createCard({ type: 'note', x: c.x - 130, y: c.y - 60, width: 260 });
      },
    },
    {
      kind: 'action', label: 'Criar frame de storyboard', hint: '9:16',
      icon: '▥',
      run: () => {
        const c = screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
        createFrame({ x: c.x - 135, y: c.y - 240, ratio: '9:16' });
      },
    },
    {
      kind: 'action', label: 'Criar snippet de código', hint: '',
      icon: '⌗',
      run: () => {
        const c = screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
        createCard({ type: 'code', x: c.x - 190, y: c.y - 100, width: 380, content: '' });
      },
    },
    {
      kind: 'action', label: 'Alternar modo storyboard', hint: 'Lente do Diretor',
      icon: '▶',
      run: () => document.getElementById('sb-toggle')?.click(),
    },
    {
      kind: 'action', label: 'Novo canvas a partir de template', hint: '',
      icon: '＋',
      run: async () => {
        const key = await pickTemplate({ title: 'novo canvas' });
        if (key) window.__createProjectWithTemplate?.(key);
      },
    },
    {
      kind: 'action', label: 'Semear template no canvas atual', hint: 'adiciona ao atual',
      icon: '✦',
      run: async () => {
        const key = await pickTemplate({ title: 'adicionar template' });
        if (key) seedTemplate(key);
      },
    },
    {
      kind: 'action', label: 'Compartilhar este canvas', hint: 'link com snapshot',
      icon: '↗',
      run: () => window.__openShareModal?.(),
    },
    {
      kind: 'action', label: 'Limpar canvas atual', hint: 'destrutivo',
      icon: '⌫', danger: true,
      run: () => window.__whiteboardClearAll?.(),
    },
  ];
}

function getProjects() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(INDEX_KEY) || '[]'); } catch {}
  const active = localStorage.getItem(ACTIVE_KEY);
  return list.map((p) => ({
    kind: 'project',
    label: p.name,
    hint:  p.id === active ? 'canvas atual' : 'trocar para este canvas',
    icon: '◍',
    isActive: p.id === active,
    run: () => {
      if (p.id === active) return;
      try { window.__flushPersistence?.(); } catch {}
      localStorage.setItem(ACTIVE_KEY, p.id);
      location.reload();
    },
  }));
}

function getCards() {
  const items = [];
  document.querySelectorAll('#world .card').forEach((card) => {
    const type = [...card.classList].find((c) => c.startsWith('card--'))?.slice(6);
    if (!type) return;
    let label = '', body = '';
    switch (type) {
      case 'note':
        body  = card.querySelector('.card__note')?.textContent || '';
        label = body.split('\n')[0].slice(0, 60) || 'nota vazia';
        break;
      case 'code':
        body  = card.querySelector('.card__code')?.dataset.raw ||
                card.querySelector('.card__code')?.textContent || '';
        label = body.split('\n')[0].slice(0, 60) || 'código vazio';
        break;
      case 'frame': {
        const num = card.querySelector('.card__frame-number')?.textContent || '';
        const lbl = card.querySelector('.card__frame-label')?.textContent || '';
        label = `Cena ${num} — ${lbl || 'sem descrição'}`;
        body  = lbl;
        break;
      }
      case 'image':
        label = card.querySelector('.card__image')?.alt || 'imagem';
        break;
      case 'youtube':
        label = card.querySelector('.card__yt-input')?.value ||
                card.querySelector('.card__yt-iframe')?.src || 'youtube';
        break;
      case 'audio': label = 'gravação de áudio'; break;
      case 'video': label = 'gravação de vídeo'; break;
      default: return;
    }
    items.push({
      kind: 'card',
      label,
      hint: type,
      icon: ICONS[type] || '·',
      body,
      run: () => focusCard(card),
    });
  });
  return items;
}

const ICONS = {
  note: '✎', code: '⌗', frame: '▥', image: '▦',
  youtube: '▶', audio: '◉', video: '▷',
};

/* ───────────────────────────────────────────────────────
   FOCO em um card (pan + zoom suave)
   ─────────────────────────────────────────────────────── */

function focusCard(card) {
  // Se está dentro de um frame, foca o frame (que o contém visualmente).
  let target = card;
  let inFrame = target.closest('.card--frame');
  if (inFrame && inFrame !== target) target = inFrame;

  const x = parseFloat(target.style.left) || 0;
  const y = parseFloat(target.style.top)  || 0;
  const w = target.offsetWidth, h = target.offsetHeight;

  const vw = window.innerWidth, vh = window.innerHeight;
  const z = Math.min(vw * 0.7 / w, vh * 0.7 / h, 1.5);

  panTo({ worldX: x + w / 2, worldY: y + h / 2, z, duration: 500 });
  flash(card);
}

function flash(el) {
  el.classList.add('is-flashing');
  setTimeout(() => el.classList.remove('is-flashing'), 1200);
}

/* ───────────────────────────────────────────────────────
   RANK & RENDER
   ─────────────────────────────────────────────────────── */

function score(text, q) {
  if (!q) return 1;
  const t = text.toLowerCase(), s = q.toLowerCase();
  if (t === s) return 100;
  if (t.startsWith(s)) return 50;
  const i = t.indexOf(s);
  if (i >= 0) return 25 - Math.min(i, 24);
  // Fuzzy: todos os chars de q ocorrem em ordem?
  let j = 0;
  for (const c of t) if (c === s[j]) j++;
  return j === s.length ? 5 : 0;
}

function search(q) {
  const all = [
    ...getActions(),
    ...getCards(),
    ...getProjects(),
  ];
  if (!q.trim()) {
    // Sem query: mostre ações + projetos (cards seriam ruído).
    return [...getActions(), ...getProjects()];
  }
  return all
    .map((it) => ({ it, s: Math.max(score(it.label, q), score(it.body || '', q) * 0.6) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 20)
    .map((r) => r.it);
}

function render() {
  currentResults = search(input.value);
  activeIdx = 0;
  resultsEl.innerHTML = '';

  if (!currentResults.length) {
    const empty = document.createElement('div');
    empty.className = 'palette__empty';
    empty.textContent = 'sem resultados';
    resultsEl.appendChild(empty);
    return;
  }

  let lastKind = null;
  currentResults.forEach((it, i) => {
    if (it.kind !== lastKind) {
      const h = document.createElement('div');
      h.className = 'palette__group';
      h.textContent = ({ action: 'ações', card: 'no canvas', project: 'projetos' })[it.kind];
      resultsEl.appendChild(h);
      lastKind = it.kind;
    }
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'palette__row' + (it.danger ? ' is-danger' : '');
    row.dataset.idx = i;
    row.innerHTML = `
      <span class="palette__row-icon">${it.icon}</span>
      <span class="palette__row-label">${escapeHTML(it.label)}</span>
      <span class="palette__row-hint">${escapeHTML(it.hint || '')}</span>
    `;
    row.addEventListener('click', () => commit(i));
    row.addEventListener('mousemove', () => highlight(i));
    resultsEl.appendChild(row);
  });
  highlight(0);
}

function highlight(i) {
  activeIdx = i;
  [...resultsEl.querySelectorAll('.palette__row')].forEach((r, idx) => {
    r.classList.toggle('is-active', idx === i);
  });
  const cur = resultsEl.querySelector('.palette__row.is-active');
  cur?.scrollIntoView({ block: 'nearest' });
}

function commit(i) {
  const it = currentResults[i];
  close();
  // Pequeno delay garante que o overlay desapareça antes do efeito visual.
  requestAnimationFrame(() => it?.run?.());
}

/* ───────────────────────────────────────────────────────
   OPEN / CLOSE
   ─────────────────────────────────────────────────────── */

export function openPalette() {
  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add('is-visible'));
  input.value = '';
  render();
  input.focus();
}
function close() {
  overlay.classList.remove('is-visible');
  setTimeout(() => { overlay.hidden = true; }, 160);
}

input.addEventListener('input', render);
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(activeIdx + 1, currentResults.length - 1)); }
  if (e.key === 'ArrowUp')   { e.preventDefault(); highlight(Math.max(activeIdx - 1, 0)); }
  if (e.key === 'Enter')     { e.preventDefault(); commit(activeIdx); }
  if (e.key === 'Escape')    { e.preventDefault(); close(); }
});
overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    overlay.hidden ? openPalette() : close();
  }
});

function escapeHTML(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]));
}
