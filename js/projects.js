/* ════════════════════════════════════════════════════════════════════
   projects.js — Projetos = canvases independentes
   ────────────────────────────────────────────────────────────────────
   Cada projeto é um canvas próprio, com estado isolado (cards, desenho,
   pan/zoom) no localStorage.

   Layout no localStorage:
     · whiteboard:projects        → índice [{ id, name }, ...]
     · whiteboard:active          → id do projeto ativo
     · whiteboard:v1:<id>         → estado completo daquele canvas
     · whiteboard:seed:<id>       → template a aplicar no próximo boot

   Recursos do painel:
     · Lista de projetos com PREVIEW ao vivo (mini-render do JSON salvo).
     · Renomear explícito (botão de lápis) além do duplo-clique.
     · Criar novo canvas via picker de template + nome opcional.
   ════════════════════════════════════════════════════════════════════ */

   import { pickTemplate } from './templates.js';
   import { promptModal, confirmModal, chooseModal } from './modal.js';
   
   const INDEX_KEY   = 'whiteboard:projects';
   const ACTIVE_KEY  = 'whiteboard:active';
   const DATA_PREFIX = 'whiteboard:v1:';
   const SEED_PREFIX = 'whiteboard:seed:';
   
   const uid = () => 'p_' + Math.random().toString(36).slice(2, 9);
   
   /* Cores por tipo — consistente com o mini-mapa (minimap.js). */
   const PREVIEW_COLORS = {
     note:    'oklch(0.55 0.17 295)',
     code:    'oklch(0.65 0.13 220)',
     image:   'oklch(0.55 0.17 295)',
     youtube: 'oklch(0.55 0.20 25)',
     audio:   'oklch(0.65 0.13 220)',
     video:   'oklch(0.55 0.20 25)',
     frame:   'rgba(26, 26, 24, 0.18)',
   };
   
   function loadIndex() {
     try {
       const raw = localStorage.getItem(INDEX_KEY);
       if (raw) {
         const arr = JSON.parse(raw);
         if (Array.isArray(arr) && arr.length) return arr;
       }
     } catch {}
     return null;
   }
   function saveIndex(list) { localStorage.setItem(INDEX_KEY, JSON.stringify(list)); }
   
   /** Lê o estado salvo de um projeto (sem carregá-lo). Para o preview. */
   function loadProjectData(id) {
     try {
       const raw = localStorage.getItem(DATA_PREFIX + id);
       if (!raw) return null;
       return JSON.parse(raw);
     } catch { return null; }
   }
   
   /* ────── Bootstrap ────── */
   function bootstrap() {
     let list = loadIndex();
     if (!list) {
       const id = uid();
       list = [{ id, name: 'Canvas 1' }];
       const oldData = localStorage.getItem('whiteboard:v1');
       if (oldData) {
         localStorage.setItem(DATA_PREFIX + id, oldData);
         localStorage.removeItem('whiteboard:v1');
       }
       saveIndex(list);
       localStorage.setItem(ACTIVE_KEY, id);
     }
     let active = localStorage.getItem(ACTIVE_KEY);
     if (!active || !list.some(p => p.id === active)) {
       active = list[0].id;
       localStorage.setItem(ACTIVE_KEY, active);
     }
     return active;
   }
   
   const ACTIVE_AT_BOOT = bootstrap();
   
   export function getActiveStorageKey() { return DATA_PREFIX + ACTIVE_AT_BOOT; }
   export function getActiveId()         { return ACTIVE_AT_BOOT; }
   
   /* ────────────────────────────────────────────────────────────────────
      PREVIEW — mini-render do conteúdo de um projeto
      ────────────────────────────────────────────────────────────────────
      Lê os cards salvos e desenha cada um como um <rect> num SVG, com
      viewBox ajustado aos bounds do conteúdo. Igual ao mini-mapa, mas
      estático e a partir do JSON (não do DOM).
      ──────────────────────────────────────────────────────────────────── */
   
   function buildPreviewSVG(data, W = 148, H = 96) {
     const cards = (data?.cards || []).filter((c) => c && typeof c.x === 'number');
     if (!cards.length) {
       // Canvas vazio: SVG cinza com texto sutil.
       return `<svg viewBox="0 0 ${W} ${H}" class="proj-preview__svg" preserveAspectRatio="xMidYMid slice">
                 <rect width="${W}" height="${H}" fill="var(--bg)"/>
                 <text x="${W/2}" y="${H/2}" text-anchor="middle" dominant-baseline="middle"
                       font-size="9" fill="var(--ink-faint)" font-family="var(--font-sans)">vazio</text>
               </svg>`;
     }
   
     // Bounds do conteúdo.
     let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
     cards.forEach((c) => {
       const w = c.width || 240;
       const h = estimateHeight(c);
       minX = Math.min(minX, c.x);
       minY = Math.min(minY, c.y);
       maxX = Math.max(maxX, c.x + w);
       maxY = Math.max(maxY, c.y + h);
     });
   
     // Padding e ajuste de aspect ratio.
     const padX = (maxX - minX) * 0.08 || 20;
     const padY = (maxY - minY) * 0.08 || 20;
     minX -= padX; maxX += padX; minY -= padY; maxY += padY;
   
     const bw = maxX - minX, bh = maxY - minY;
     // Ajusta para o aspect do preview sem distorcer.
     const targetAspect = W / H;
     const curAspect = bw / bh;
     if (curAspect > targetAspect) {
       const th = bw / targetAspect;
       const pad = (th - bh) / 2;
       minY -= pad; maxY += pad;
     } else {
       const tw = bh * targetAspect;
       const pad = (tw - bw) / 2;
       minX -= pad; maxX += pad;
     }
     const vw = maxX - minX, vh = maxY - minY;
   
     let rects = '';
     cards.forEach((c) => {
       const w = c.width || 240;
       const h = estimateHeight(c);
       const color = PREVIEW_COLORS[c.type] || PREVIEW_COLORS.note;
       const isFrame = c.type === 'frame';
       if (isFrame) {
         rects += `<rect x="${c.x}" y="${c.y}" width="${w}" height="${h}" fill="none"
                         stroke="rgba(26,26,24,0.35)" stroke-width="${vw*0.004}"
                         stroke-dasharray="${vw*0.012} ${vw*0.008}"/>`;
       } else {
         rects += `<rect x="${c.x}" y="${c.y}" width="${w}" height="${h}" fill="${color}"
                         opacity="0.82" rx="${Math.min(w,h)*0.05}"/>`;
       }
     });
   
     return `<svg viewBox="${minX} ${minY} ${vw} ${vh}" class="proj-preview__svg" preserveAspectRatio="xMidYMid slice">
               <rect x="${minX}" y="${minY}" width="${vw}" height="${vh}" fill="var(--bg)"/>
               ${rects}
             </svg>`;
   }
   
   /** Estima altura de um card salvo (não temos offsetHeight do JSON). */
   function estimateHeight(c) {
     if (c.type === 'frame') {
       const ratios = { '9:16': 480, '16:9': 270, '1:1': 360 };
       return ratios[c.ratio] || 480;
     }
     if (c.type === 'code')  return 200;
     if (c.type === 'image') return 220;
     if (c.type === 'youtube') return 230;
     if (c.type === 'audio') return 90;
     if (c.type === 'video') return 220;
     // Nota: estima por tamanho do conteúdo.
     const len = (c.content || '').length;
     return Math.max(80, Math.min(360, 60 + len * 0.35));
   }
   
   /* ────────────────────────────────────────────────────────────────────
      API global — criar projeto com template (+ nome opcional)
      ──────────────────────────────────────────────────────────────────── */
   
   async function createProjectWithTemplate(templateKey) {
     let key = templateKey;
     if (key === undefined) {
       key = await pickTemplate({ title: 'novo canvas' });
       if (!key) return null;
     }
   
     // Pergunta o nome do canvas (opcional — Enter vazio usa nome padrão).
     const list = loadIndex() || [];
     const defaultName = `Canvas ${list.length + 1}`;
     const typed = await promptModal({
       title: 'Novo canvas',
       message: 'Dê um nome para o seu novo quadro (opcional).',
       value: defaultName,
       placeholder: defaultName,
       confirmText: 'Criar',
     });
     if (typed === null) return null;          // cancelou o modal → aborta
     const name = typed.trim() || defaultName;
   
     try { window.__flushPersistence?.(); } catch {}
   
     const id = uid();
     list.push({ id, name });
     saveIndex(list);
     localStorage.setItem(ACTIVE_KEY, id);
   
     if (key && key !== 'blank') {
       localStorage.setItem(SEED_PREFIX + id, key);
     }
   
     location.reload();
     return id;
   }
   
   window.__createProjectWithTemplate = createProjectWithTemplate;
   
   /* ────────────────────────────────────────────────────────────────────
      UI — painel "projetos" no HUD
      ──────────────────────────────────────────────────────────────────── */
   
   function getActiveName() {
     const list = loadIndex() || [];
     return list.find(p => p.id === ACTIVE_AT_BOOT)?.name || 'Canvas';
   }
   const titleEl = document.querySelector('.hud__title');
   function updateTitle() { if (titleEl) titleEl.textContent = getActiveName(); }
   updateTitle();
   
   const trigger = document.getElementById('proj-toggle');
   if (trigger) {
     const panel = document.createElement('div');
     panel.className = 'projects-panel projects-panel--gallery';
     panel.hidden = true;
     document.body.appendChild(panel);
   
     function switchTo(id) {
       if (id === ACTIVE_AT_BOOT) return close();
       try { window.__flushPersistence?.(); } catch {}
       localStorage.setItem(ACTIVE_KEY, id);
       location.reload();
     }
   
     function deleteProject(id) {
       const list = loadIndex() || [];
       if (list.length <= 1) return;
       const next = list.filter(p => p.id !== id);
       saveIndex(next);
       localStorage.removeItem(DATA_PREFIX + id);
       localStorage.removeItem(SEED_PREFIX + id);
       if (id === ACTIVE_AT_BOOT) {
         localStorage.setItem(ACTIVE_KEY, next[0].id);
         location.reload();
       } else {
         render();
       }
     }
   
     async function deleteAllProjects() {
       const ok = await confirmModal({
         title: 'Apagar TODOS os projetos?',
         message: 'Todos os canvases, cards e desenhos serão apagados permanentemente. Esta ação não pode ser desfeita.',
         confirmText: 'Apagar tudo',
         danger: true,
       });
       if (!ok) return;
       const list = loadIndex() || [];
       list.forEach((p) => {
         localStorage.removeItem(DATA_PREFIX + p.id);
         localStorage.removeItem(SEED_PREFIX + p.id);
       });
       localStorage.removeItem(INDEX_KEY);
       localStorage.removeItem(ACTIVE_KEY);
       // bootstrap() recria um "Canvas 1" limpo no reload.
       location.reload();
     }
   
     function renameProject(id, newName) {
       const list = loadIndex() || [];
       const p = list.find(x => x.id === id);
       if (!p) return;
       p.name = (newName || '').trim() || p.name;
       saveIndex(list);
       if (id === ACTIVE_AT_BOOT) updateTitle();
     }
   
     /* ───────────────────────────────────────────────────────────────────
        EXPORT / IMPORT — backup e restauração via arquivo JSON
        ───────────────────────────────────────────────────────────────────
        Formato do arquivo exportado (envelope versionado para permitir
        evolução futura sem quebrar imports antigos):
   
          {
            format: 'whiteboard-export',
            version: 1,
            exportedAt: <ISO timestamp>,
            scope: 'single' | 'all',
            projects: [ { id, name, data } ]   // data = estado do canvas
          }
   
        - scope 'single': um projeto (o atual).
        - scope 'all': todos os projetos (backup completo).
        ─────────────────────────────────────────────────────────────────── */
   
     function downloadJSON(filename, obj) {
       const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
       const url = URL.createObjectURL(blob);
       const a = document.createElement('a');
       a.href = url;
       a.download = filename;
       document.body.appendChild(a);
       a.click();
       a.remove();
       // Libera o objeto URL após o clique (evita vazamento de memória).
       setTimeout(() => URL.revokeObjectURL(url), 1000);
     }
   
     /* Garante que o estado em memória do canvas atual está salvo antes
        de exportar — senão o último edit (ainda no debounce) fica de fora. */
     function flushBeforeExport() {
       try { window.__flushPersistence?.(); } catch {}
     }
   
     function exportCurrent() {
       flushBeforeExport();
       const list = loadIndex() || [];
       const p = list.find(x => x.id === ACTIVE_AT_BOOT);
       if (!p) return;
       const data = loadProjectData(ACTIVE_AT_BOOT);
       const envelope = {
         format: 'whiteboard-export',
         version: 1,
         exportedAt: new Date().toISOString(),
         scope: 'single',
         projects: [{ id: p.id, name: p.name, data }],
       };
       const safeName = p.name.replace(/[^\w\-]+/g, '_');
       downloadJSON(`canvas_${safeName}.json`, envelope);
     }
   
     function exportAll() {
       flushBeforeExport();
       const list = loadIndex() || [];
       const projects = list.map((p) => ({
         id: p.id,
         name: p.name,
         data: loadProjectData(p.id),
       }));
       const envelope = {
         format: 'whiteboard-export',
         version: 1,
         exportedAt: new Date().toISOString(),
         scope: 'all',
         projects,
       };
       const stamp = new Date().toISOString().slice(0, 10);
       downloadJSON(`whiteboard_backup_${stamp}.json`, envelope);
     }
   
     /* Valida o envelope importado. Retorna {ok, msg, projects}. */
     function parseImport(raw) {
       let obj;
       try { obj = JSON.parse(raw); }
       catch { return { ok: false, msg: 'Arquivo não é um JSON válido.' }; }
   
       if (!obj || obj.format !== 'whiteboard-export') {
         return { ok: false, msg: 'Arquivo não é um backup de Whiteboard válido.' };
       }
       if (!Array.isArray(obj.projects) || !obj.projects.length) {
         return { ok: false, msg: 'O arquivo não contém projetos.' };
       }
       return { ok: true, projects: obj.projects, scope: obj.scope };
     }
   
     /* Importa: pergunta ao usuário se quer criar NOVO(s) ou SOBRESCREVER
        o atual. Sobrescrever só faz sentido para import de 1 projeto. */
     async function handleImportedData(parsed) {
       const multi = parsed.projects.length > 1;
   
       let modo;
       if (multi) {
         // Vários projetos: só faz sentido importar como novos.
         const ok = await confirmModal({
           title: 'Importar backup',
           message: `O arquivo contém ${parsed.projects.length} projetos. Importar todos como canvases novos?`,
           confirmText: 'Importar',
         });
         if (!ok) return;
         modo = 'new';
       } else {
         // Um projeto: pergunta novo vs sobrescrever.
         const choice = await chooseModal({
           title: 'Como importar este canvas?',
           options: [
             { value: 'new',       label: 'Criar como canvas novo',     hint: 'não altera nada' },
             { value: 'overwrite', label: 'Sobrescrever o canvas atual', hint: 'substitui' },
           ],
         });
         if (choice === null) return;     // cancelado
         modo = choice;
       }
   
       const list = loadIndex() || [];
   
       if (modo === 'overwrite') {
         const incoming = parsed.projects[0];
         // Sobrescreve os DADOS do projeto atual, mantendo id e nome atuais.
         flushBeforeExport();
         localStorage.setItem(DATA_PREFIX + ACTIVE_AT_BOOT, JSON.stringify(incoming.data || {}));
         alert('Canvas atual sobrescrito. Recarregando…');
         location.reload();
         return;
       }
   
       // modo 'new': cada projeto importado vira um canvas novo com id novo.
       let firstNewId = null;
       parsed.projects.forEach((proj) => {
         const newId = uid();
         if (!firstNewId) firstNewId = newId;
         const baseName = (proj.name || 'Canvas importado').trim();
         // Evita nome duplicado: acrescenta "(importado)".
         const name = list.some(x => x.name === baseName) ? `${baseName} (importado)` : baseName;
         list.push({ id: newId, name });
         localStorage.setItem(DATA_PREFIX + newId, JSON.stringify(proj.data || {}));
       });
       saveIndex(list);
   
       // Abre o primeiro projeto importado.
       if (firstNewId) {
         localStorage.setItem(ACTIVE_KEY, firstNewId);
         alert(`${parsed.projects.length} canvas importado(s). Abrindo…`);
         location.reload();
       }
     }
   
     function startImport() {
       const inp = document.createElement('input');
       inp.type = 'file';
       inp.accept = 'application/json,.json';
       inp.style.display = 'none';
       document.body.appendChild(inp);
       inp.addEventListener('change', () => {
         const file = inp.files?.[0];
         inp.remove();
         if (!file) return;
         const reader = new FileReader();
         reader.onload = () => {
           const parsed = parseImport(reader.result);
           if (!parsed.ok) { alert('Não foi possível importar: ' + parsed.msg); return; }
           handleImportedData(parsed);
         };
         reader.onerror = () => alert('Falha ao ler o arquivo.');
         reader.readAsText(file);
       });
       inp.click();
     }
   
     /* ───── Render: galeria de cards com preview ───── */
     function render() {
       const list = loadIndex() || [];
       panel.innerHTML = `
         <div class="projects-panel__head">
           <span class="projects-panel__title">projetos · ${list.length}</span>
           <button class="projects-panel__new" type="button" title="Novo canvas">
             <span class="projects-panel__plus">+</span> novo
           </button>
         </div>
         <div class="projects-panel__gallery"></div>
         <div class="projects-panel__foot">
           <button class="projects-panel__io" data-io="export-current" type="button" title="Exportar o canvas atual">
             <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 11V2M5 5l3-3 3 3M3 11v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
             exportar atual
           </button>
           <button class="projects-panel__io" data-io="export-all" type="button" title="Exportar todos os projetos (backup)">
             <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M2 4h12v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4zM2 4l1-2h10l1 2M6 7h4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
             backup tudo
           </button>
           <button class="projects-panel__io" data-io="import" type="button" title="Importar de um arquivo JSON">
             <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 2v9M5 8l3 3 3-3M3 11v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
             importar
           </button>
         </div>
         <button class="projects-panel__danger" data-io="delete-all" type="button" title="Apagar TODOS os projetos">
           <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 4h10M6 4V3h4v1M5 4l.5 9h5L11 4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
           apagar todos os projetos
         </button>
       `;
       const gallery = panel.querySelector('.projects-panel__gallery');
   
       list.forEach((p, i) => {
         const isActive = p.id === ACTIVE_AT_BOOT;
         const data = loadProjectData(p.id);
         const cardCount = (data?.cards || []).length;
   
         const item = document.createElement('div');
         item.className = 'proj-card' + (isActive ? ' is-active' : '');
         item.innerHTML = `
           <div class="proj-card__preview">${buildPreviewSVG(data)}</div>
           <div class="proj-card__meta">
             <span class="proj-card__name" title="${escapeHTML(p.name)}">${escapeHTML(p.name)}</span>
             <span class="proj-card__count">${cardCount} ${cardCount === 1 ? 'item' : 'itens'}${isActive ? ' · atual' : ''}</span>
           </div>
           <div class="proj-card__actions">
             <button class="proj-card__btn proj-card__rename" title="Renomear" aria-label="Renomear">
               <svg viewBox="0 0 16 16" width="12" height="12"><path d="M11 2l3 3L6 13H3v-3L11 2z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
             </button>
             ${list.length > 1 ? `<button class="proj-card__btn proj-card__del" title="Apagar" aria-label="Apagar">
               <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 4h10M6 4V3h4v1M5 4l.5 9h5L11 4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
             </button>` : ''}
           </div>
         `;
   
         // Clique no preview/meta → abrir projeto.
         const openZones = [item.querySelector('.proj-card__preview'), item.querySelector('.proj-card__meta')];
         openZones.forEach((z) => z.addEventListener('click', () => switchTo(p.id)));
   
         // Renomear.
         item.querySelector('.proj-card__rename').addEventListener('click', async (e) => {
           e.stopPropagation();
           const novo = await promptModal({
             title: 'Renomear canvas',
             value: p.name,
             confirmText: 'Salvar',
           });
           if (novo !== null) { renameProject(p.id, novo); render(); }
         });
   
         // Apagar.
         const del = item.querySelector('.proj-card__del');
         if (del) del.addEventListener('click', async (e) => {
           e.stopPropagation();
           const ok = await confirmModal({
             title: `Apagar "${p.name}"?`,
             message: 'Os cards e desenhos deste canvas serão perdidos. Esta ação não pode ser desfeita.',
             confirmText: 'Apagar',
             danger: true,
           });
           if (ok) deleteProject(p.id);
         });
   
         gallery.appendChild(item);
       });
   
       const newBtn = panel.querySelector('.projects-panel__new');
       newBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
       newBtn.addEventListener('click', (e) => {
         e.preventDefault();
         e.stopPropagation();
         close();
         setTimeout(() => {
           createProjectWithTemplate().catch((err) => console.error('[projects]', err));
         }, 16);
       });
   
       // Botões de export/import no rodapé.
       panel.querySelector('[data-io="export-current"]').addEventListener('click', (e) => {
         e.stopPropagation();
         exportCurrent();
       });
       panel.querySelector('[data-io="export-all"]').addEventListener('click', (e) => {
         e.stopPropagation();
         exportAll();
       });
       panel.querySelector('[data-io="import"]').addEventListener('click', (e) => {
         e.stopPropagation();
         startImport();
       });
       panel.querySelector('[data-io="delete-all"]').addEventListener('click', async (e) => {
         e.stopPropagation();
         await deleteAllProjects();
       });
     }
   
     function open() {
       render();
       panel.hidden = false;
       const r = trigger.getBoundingClientRect();
       panel.style.top   = `${r.bottom + 8}px`;
       panel.style.right = `${window.innerWidth - r.right}px`;
       trigger.classList.add('is-active');
     }
     function close() {
       panel.hidden = true;
       trigger.classList.remove('is-active');
     }
     function toggle() { panel.hidden ? open() : close(); }
   
     trigger.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
   
     document.addEventListener('pointerdown', (e) => {
       if (document.querySelector('.modal-overlay')) return;
       if (panel.hidden) return;
       if (panel.contains(e.target)) return;
       if (e.target === trigger || trigger.contains(e.target)) return;
       close();
     });
     document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
   }
   
   function escapeHTML(s) {
     return String(s).replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
   }