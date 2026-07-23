/* ════════════════════════════════════════════════════════════════════
   contextMenu.js — Menu horizontal com submenus dropdown
   ────────────────────────────────────────────────────────────────────
   Layout: barra de categorias em linha. Hover/click numa categoria
   abre um submenu com os itens daquela categoria. Sai do menu inteiro
   → fecha. Ícones por categoria pra dar densidade sem virar texto puro.
   ════════════════════════════════════════════════════════════════════ */

   import { screenToWorld } from './canvas.js';
   import { createCard, createShapeCard } from './cards.js';
   import {
     createYouTubeCard, createAudioCard, createVideoCard, pickImage,
   } from './media.js';
   import { createFrame }   from './storyboard.js';
   import { createFreetext } from './freetext.js';
   import { createDbTableCard } from './db.js';
   import { createUmlClassCard, createUmlActorCard,
            createUmlUseCaseCard, createUmlNoteCard } from './uml.js';
   import { createIdeCard } from './ide.js';
   
   const menu = document.getElementById('context-menu');
   const viewport = document.getElementById('viewport');
   
   /* Ícones por categoria — dão personalidade ao menu horizontal */
   const CATEGORY_ICONS = {
     'Criar':          '✎',
     'Fluxograma':     '◇',
     'Mídia':          '▶',
     'Storyboard':     '▥',
     'Banco de Dados': '▤',
     'UML':            '▦',
     'IDE':            '⌗',
     'Canvas':         '⚙',
   };
   
   /* Fonte da verdade das ferramentas. Itens com `group` iniciam categoria. */
   const tools = [
     { group: 'Criar' },
     { icon: '¶', label: 'Nota', hint: 'N',
       action: (w) => createCard({ type: 'note', x: w.x, y: w.y, width: 240 }) },
     { icon: 'T', label: 'Texto solto', hint: 'T',
       action: (w) => createFreetext({ x: w.x, y: w.y }) },
     { icon: '<>', label: 'Código', hint: 'C',
       action: (w) => createCard({
         type: 'code', x: w.x, y: w.y, width: 360,
         content: '// snippet\nfunction hello(name) {\n  return `oi, ${name}`;\n}',
       }) },
   
     { group: 'Fluxograma' },
     { icon: '⬭', label: 'Início/Fim', hint: '',
       action: (w) => createShapeCard({ shape: 'oval', x: w.x, y: w.y }) },
     { icon: '▭', label: 'Processo', hint: '',
       action: (w) => createShapeCard({ shape: 'process', x: w.x, y: w.y }) },
     { icon: '◇', label: 'Decisão', hint: '',
       action: (w) => createShapeCard({ shape: 'decision', x: w.x, y: w.y }) },
     { icon: '▱', label: 'Dados', hint: '',
       action: (w) => createShapeCard({ shape: 'data', x: w.x, y: w.y }) },
   
     { group: 'Mídia' },
     { icon: '▢', label: 'Imagem', hint: '',
       action: (w) => pickImage(w) },
     { icon: '▶', label: 'YouTube', hint: 'Y',
       action: (w) => createYouTubeCard({ x: w.x, y: w.y }) },
     { icon: '~', label: 'Áudio', hint: '',
       action: (w) => createAudioCard({ x: w.x, y: w.y }) },
     { icon: '▶', label: 'Vídeo', hint: '',
       action: (w) => createVideoCard({ x: w.x, y: w.y }) },
   
     { group: 'Storyboard' },
     { icon: '┃', label: 'Frame mobile', hint: '9:16',
       action: (w) => createFrame({ x: w.x, y: w.y, ratio: '9:16' }) },
     { icon: '▭', label: 'Frame YouTube', hint: '16:9',
       action: (w) => createFrame({ x: w.x, y: w.y, ratio: '16:9' }) },
     { icon: '▢', label: 'Frame quadrado', hint: '1:1',
       action: (w) => createFrame({ x: w.x, y: w.y, ratio: '1:1' }) },
   
     { group: 'Banco de Dados' },
     { icon: '▤', label: 'Tabela', hint: '',
       action: (w) => createDbTableCard({ x: w.x, y: w.y }) },
   
     { group: 'UML' },
     { icon: '▦', label: 'Classe', hint: '',
       action: (w) => createUmlClassCard({ x: w.x, y: w.y }) },
     { icon: '☺', label: 'Ator', hint: '',
       action: (w) => createUmlActorCard({ x: w.x, y: w.y }) },
     { icon: '◯', label: 'Use case', hint: '',
       action: (w) => createUmlUseCaseCard({ x: w.x, y: w.y }) },
     { icon: '✎', label: 'Nota UML', hint: '',
       action: (w) => createUmlNoteCard({ x: w.x, y: w.y }) },
   
     { group: 'IDE' },
     { icon: '⌗', label: 'JavaScript', hint: '',
       action: (w) => createIdeCard({ x: w.x, y: w.y, lang: 'javascript' }) },
     { icon: '<>', label: 'HTML', hint: '',
       action: (w) => createIdeCard({ x: w.x, y: w.y, lang: 'html' }) },
     { icon: '#', label: 'CSS', hint: '',
       action: (w) => createIdeCard({ x: w.x, y: w.y, lang: 'css' }) },
     { icon: '▤', label: 'SQL', hint: '',
       action: (w) => createIdeCard({ x: w.x, y: w.y, lang: 'sql' }) },
   
     { group: 'Canvas' },
     { icon: '✕', label: 'Limpar tudo', hint: '', danger: true,
       action: () => window.__whiteboardClearAll?.() },
   ];
   
   /* ───────── Agrupa tools em categorias ───────── */
   function groupTools() {
     const groups = [];
     let current = null;
     for (const t of tools) {
       if (t.group) {
         current = { name: t.group, items: [] };
         groups.push(current);
       } else if (current) {
         current.items.push(t);
       }
     }
     return groups;
   }
   
   /* ───────── Render ───────── */
   function renderMenu(frameInfo) {
     menu.innerHTML = '';
     menu.classList.add('context-menu--horizontal');
   
     /* Banner de anexação ao frame — fica em cima da linha de categorias. */
     if (frameInfo) {
       const banner = document.createElement('div');
       banner.className = 'context-menu__banner';
       banner.textContent = `anexando à cena ${frameInfo.num}`;
       menu.appendChild(banner);
     }
   
     const row = document.createElement('div');
     row.className = 'context-menu__row';
     menu.appendChild(row);
   
     const groups = groupTools();
   
     groups.forEach((g) => {
       const cat = document.createElement('button');
       cat.type = 'button';
       cat.className = 'context-menu__cat';
       cat.innerHTML = `
         <span class="context-menu__cat-icon">${CATEGORY_ICONS[g.name] || '·'}</span>
         <span class="context-menu__cat-label">${g.name}</span>
       `;
       row.appendChild(cat);
   
       /* Submenu popover — irmão da row, absolute dentro do menu. */
       const submenu = document.createElement('div');
       submenu.className = 'context-menu__submenu';
       submenu.hidden = true;
       g.items.forEach((t) => {
         const item = document.createElement('div');
         item.className = 'context-menu__item' + (t.danger ? ' is-danger' : '');
         item.innerHTML = `
           <span class="context-menu__icon">${t.icon}</span>
           <span class="context-menu__label">${t.label}</span>
           <span class="context-menu__hint">${t.hint || ''}</span>
         `;
         item.addEventListener('click', () => {
           t.action(menu._world);
           hide();
         });
         submenu.appendChild(item);
       });
       menu.appendChild(submenu);
   
       /* Abre submenu ao hover ou click. Fecha os outros. */
       const openSub = () => {
         menu.querySelectorAll('.context-menu__submenu').forEach((s) => {
           if (s !== submenu) s.hidden = true;
         });
         menu.querySelectorAll('.context-menu__cat').forEach((c) =>
           c.classList.toggle('is-active', c === cat));
         positionSubmenu(cat, submenu);
       };
       cat.addEventListener('mouseenter', openSub);
       cat.addEventListener('click', openSub);
       cat.addEventListener('focus', openSub);
     });
   
     /* Sai do menu inteiro → fecha submenu ativo. */
     menu.addEventListener('mouseleave', () => {
       menu.querySelectorAll('.context-menu__submenu').forEach((s) => s.hidden = true);
       menu.querySelectorAll('.context-menu__cat').forEach((c) => c.classList.remove('is-active'));
     });
   }
   
   /* Posiciona o submenu abaixo da categoria; se overflow horizontal
      ou vertical, ajusta pra caber. */
   function positionSubmenu(cat, submenu) {
     submenu.hidden = false;
     submenu.style.left = '0';
     submenu.style.top  = '100%';
     submenu.style.bottom = 'auto';
     submenu.style.marginTop = '4px';
     submenu.style.marginBottom = '0';
   
     /* Precisa estar visível pra medir. */
     const catRect  = cat.getBoundingClientRect();
     const menuRect = menu.getBoundingClientRect();
     const subW = submenu.offsetWidth;
     const subH = submenu.offsetHeight;
   
     /* Horizontal: alinha ao início da categoria; recua se estourar. */
     let left = catRect.left - menuRect.left;
     const overflowRight = catRect.left + subW - window.innerWidth + 8;
     if (overflowRight > 0) left -= overflowRight;
     if (menuRect.left + left < 8) left = 8 - menuRect.left;
     submenu.style.left = `${left}px`;
   
     /* Vertical: se não cabe embaixo, flipa pra cima. */
     const bottomOverflow = menuRect.bottom + 4 + subH > window.innerHeight - 8;
     if (bottomOverflow) {
       submenu.style.top = 'auto';
       submenu.style.bottom = '100%';
       submenu.style.marginTop = '0';
       submenu.style.marginBottom = '4px';
     }
   }
   
   /* ───────── Frame no ponto? ───────── */
   function frameAt(worldX, worldY) {
     let target = null;
     let smallest = Infinity;
     for (const f of document.querySelectorAll('.card--frame')) {
       const x = parseFloat(f.style.left) || 0;
       const y = parseFloat(f.style.top)  || 0;
       const w = f.offsetWidth, h = f.offsetHeight;
       if (worldX >= x && worldX <= x + w && worldY >= y && worldY <= y + h) {
         const area = w * h;
         if (area < smallest) { target = f; smallest = area; }
       }
     }
     if (!target) return null;
     return { num: target.querySelector('.card__frame-number')?.textContent || '' };
   }
   
   /* ───────── Abertura / fechamento ───────── */
   function show(clientX, clientY) {
     menu._world = screenToWorld(clientX, clientY);
     renderMenu(frameAt(menu._world.x, menu._world.y));
   
     menu.hidden = false;
     const { innerWidth: vw, innerHeight: vh } = window;
     const rect = menu.getBoundingClientRect();
     const x = Math.min(clientX, vw - rect.width  - 8);
     const y = Math.min(clientY, vh - rect.height - 8);
     menu.style.left = `${Math.max(8, x)}px`;
     menu.style.top  = `${Math.max(8, y)}px`;
   }
   function hide() { menu.hidden = true; }
   
   viewport.addEventListener('contextmenu', (e) => {
     if (document.body.classList.contains('is-drawing')) return;
     e.preventDefault();
     show(e.clientX, e.clientY);
   });
   
   document.addEventListener('pointerdown', (e) => {
     if (!menu.hidden && !menu.contains(e.target)) hide();
   });
   document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
   window.addEventListener('blur', hide);
   
   /* ───────── Atalhos: N / C / Y no centro da viewport ───────── */
   document.addEventListener('keydown', (e) => {
     const t = e.target;
     if (t && (t.isContentEditable || /input|textarea|select/i.test(t.tagName))) return;
     if (e.metaKey || e.ctrlKey || e.altKey) return;
     if (document.body.classList.contains('is-drawing')) return;
   
     const w = screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
     const k = e.key.toLowerCase();
   
     if (k === 'n') createCard({ type: 'note', x: w.x - 120, y: w.y - 40, width: 240 });
     if (k === 'c') createCard({
       type: 'code', x: w.x - 180, y: w.y - 60, width: 360,
       content: '// snippet\nfunction hello(name) {\n  return `oi, ${name}`;\n}',
     });
     if (k === 'y') createYouTubeCard({ x: w.x - 200, y: w.y - 120 });
   });