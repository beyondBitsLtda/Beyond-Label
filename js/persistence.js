/* ════════════════════════════════════════════════════════════════════
   persistence.js — Autosave + Restore via localStorage
   ────────────────────────────────────────────────────────────────────
   MUDANÇAS (sprint UML/DB):
   · serializeCard cobre db-table + uml-class/actor/usecase/note
   · restoreCard chama as factories novas com cardId preservado
   · Conexões continuam adiadas por 2 RAFs pra layout estabilizar
   ════════════════════════════════════════════════════════════════════ */

   import { createCard, createShapeCard }                       from './cards.js';
   import { createImageCard, createYouTubeCard,
            createAudioCard, createVideoCard }                  from './media.js';
   import { createFrame, rebuildSnaps }                         from './storyboard.js';
   import { getActiveStorageKey }                               from './projects.js';
   import { restoreStroke }                                     from './drawing.js';
   import { getConnections, loadConnections, clearConnections } from './connections.js';
   import { getState, setStateRaw, onStateChange }              from './canvas.js';
   import { createFreetext, serializeFreetexts }                from './freetext.js';
   import { createDbTableCard, serializeDbTable }               from './db.js';
   import { createUmlClassCard, createUmlActorCard,
            createUmlUseCaseCard, createUmlNoteCard }           from './uml.js';
  import { createIdeCard, serializeIde } from './ide.js';

   const KEY       = getActiveStorageKey();
   const world     = document.getElementById('world');
   const drawLayer = document.getElementById('draw-layer');
   
   let isRestoring = true;
   
   /* ─── SERIALIZAÇÃO ─── */
   function serialize() {
     const cards = [...world.querySelectorAll('.card')]
       .sort((a, b) => (parseFloat(a.style.zIndex) || 0) - (parseFloat(b.style.zIndex) || 0))
       .map(serializeCard)
       .filter(Boolean);
   
     const strokes = [...drawLayer.children]
       .map(serializeStroke)
       .filter(Boolean);
   
     const connections = getConnections();
     const state       = getState();
     const freetexts   = serializeFreetexts();
   
     return { version: 3, cards, strokes, connections, state, freetexts };
   }
   
   function serializeCard(c) {
     const type = [...c.classList].find((cls) => cls.startsWith('card--'))?.slice(6);
     if (!type) return null;
     const base = {
       type,
       cardId: c.dataset.cardId || null,
       x: parseFloat(c.style.left)  || 0,
       y: parseFloat(c.style.top)   || 0,
       width:  parseFloat(c.style.width)  || null,
       height: parseFloat(c.style.height) || null,
     };
     if (c.dataset.frameId) base.frameId = c.dataset.frameId;
   
     switch (type) {
       case 'note': {
         const noteEl = c.querySelector('.card__note');
         base.content     = noteEl?.textContent || '';
         /* 🎯 guarda o HTML para preservar formatação (negrito, etc). */
         base.contentHtml = noteEl?.innerHTML || null;
         break;
       }
   
       case 'code':
         base.content  = c.querySelector('.card__code')?.dataset.raw
                       || c.querySelector('.card__code')?.textContent || '';
         base.language = c.querySelector('.card__lang')?.value || 'javascript';
         break;
   
       case 'shape':
         base.shape   = c.dataset.shape || 'process';
         base.content = c.querySelector('.card__shape-text')?.textContent || '';
         base.fill    = c.dataset.fill || '';
         break;
   
       case 'image':
         base.src  = c.querySelector('.card__image')?.src || '';
         base.name = c.querySelector('.card__image')?.alt || 'imagem';
         break;
   
       case 'youtube': {
         const iframe = c.querySelector('.card__yt-iframe');
         const input  = c.querySelector('.card__yt-input');
         base.url = iframe?.src || input?.value || '';
         break;
       }

       
   
       case 'frame':
         base.ratio = c.dataset.ratio || '9:16';
         base.label = c.querySelector('.card__frame-label')?.textContent || '';
         base.id    = c.id;
         break;
   
       /* 🎯 NOVOS — Banco de Dados */
       case 'db-table': {
         const dump = serializeDbTable(c);   // { name, columns }
         base.name    = dump.name;
         base.columns = dump.columns;
         break;
       }

       case 'ide': {
        const dump = serializeIde(c);
        base.lang    = dump.lang;
        base.content = dump.content;
        break;
      }
       /* 🎯 NOVOS — UML */
       case 'uml-class':
         base.name    = c.querySelector('.card__uml-name')?.textContent || '';
         base.attrs   = c.querySelector('.card__uml-section[data-part="attrs"]')?.textContent   || '';
         base.methods = c.querySelector('.card__uml-section[data-part="methods"]')?.textContent || '';
         break;
   
       case 'uml-actor':
         base.label = c.querySelector('.card__uml-actor-label')?.textContent || '';
         break;
   
       case 'uml-usecase':
         base.content = c.querySelector('.card__uml-usecase-text')?.textContent || '';
         break;
   
       case 'uml-note':
         base.content = c.querySelector('.card__uml-note')?.textContent || '';
         break;
     }
     return base;
   }
   
   function serializeStroke(p) {
     const points = p._points;
     if (!points || !points.length) return null;
     const kind = p.tagName.toLowerCase();
     return {
       kind,
       points: points.map((pt) => [pt.x, pt.y]),
       color:  kind === 'circle' ? p.getAttribute('fill') : p.getAttribute('stroke'),
       size:   kind === 'circle'
                 ? parseFloat(p.getAttribute('r')) * 2
                 : parseFloat(p.getAttribute('stroke-width')) || 2,
     };
   }
   
   /* ─── SAVE ─── */
   let saveTimer = null;
   function scheduleSave() {
     if (isRestoring) return;
     clearTimeout(saveTimer);
     saveTimer = setTimeout(save, 600);
   }
   
   function save() {
     let data;
     try {
       data = serialize();
       localStorage.setItem(KEY, JSON.stringify(data));
     } catch (e) {
       try {
         data.cards = data.cards.filter((c) => c.type !== 'image');
         localStorage.setItem(KEY, JSON.stringify(data));
         console.warn('persistence: imagens descartadas para caber no storage');
       } catch (e2) {
         console.warn('persistence: falha ao salvar', e2);
       }
     }
   }
   
   /* ─── RESTORE ─── */
   function restore() {
     let data;
     try {
       const raw = localStorage.getItem(KEY);
       if (!raw) return false;
       data = JSON.parse(raw);
     } catch (e) {
       console.warn('persistence: dados corrompidos, ignorando', e);
       return false;
     }
   
     (data.cards || []).forEach((item) => {
       const card = restoreCard(item);
       /* 🎯 FIX persistência de frame contents: restoreCard só chama as
          factories, que criam o card no #world sem nenhum vínculo com
          o frame. O `frameId` estava salvo no JSON mas era descartado
          no restore, então rebuildSnaps() não conseguia religar. Agora
          propagamos o frameId no dataset — rebuildSnaps() lê ele e faz
          o attach correto. */
       if (card && item.frameId) card.dataset.frameId = item.frameId;
     });
   
     (data.freetexts || []).forEach((ft) => {
       try { createFreetext({ ...ft, silent: true }); }
       catch (e) { console.warn('persistence: freetext pulado', ft, e); }
     });
   
     drawLayer.innerHTML = '';
     (data.strokes || []).forEach((s) => {
       try { restoreStroke(s); }
       catch (e) { console.warn('persistence: stroke pulado', s, e); }
     });
   
     clearConnections();
     requestAnimationFrame(() => {
       requestAnimationFrame(() => {
         loadConnections(data.connections || []);
       });
     });
   
     if (data.state) setStateRaw(data.state);
   
     return true;
   }
   
   function restoreCard(item) {
     try {
       switch (item.type) {
         case 'note':
           return createCard({
             type: 'note', x: item.x, y: item.y,
             width: item.width, height: item.height,
             content: item.content, contentHtml: item.contentHtml,
             silent: true, cardId: item.cardId,
           });
   
         case 'code':
           return createCard({
             type: 'code', x: item.x, y: item.y,
             width: item.width, height: item.height,
             content: item.content, language: item.language,
             silent: true, cardId: item.cardId,
           });
   
         case 'shape':
           return createShapeCard({
             shape: item.shape || 'process', x: item.x, y: item.y,
             width: item.width, height: item.height,
             content: item.content, fill: item.fill || '',
             silent: true, cardId: item.cardId,
           });
   
         case 'image':
           return createImageCard({
             src: item.src, x: item.x, y: item.y,
             width: item.width || 320, height: item.height,
             name: item.name || 'imagem',
             cardId: item.cardId,
           });

           case 'ide':
            return createIdeCard({
              x: item.x, y: item.y,
              width: item.width, height: item.height,
              lang: item.lang || 'javascript',
              content: item.content ?? null,
              silent: true,
              cardId: item.cardId,
            });
   
         case 'youtube':
           return createYouTubeCard({
             x: item.x, y: item.y, url: item.url,
             width: item.width, height: item.height,
             cardId: item.cardId,
           });
   
         case 'audio':
           return createAudioCard({
             x: item.x, y: item.y,
             cardId: item.cardId,
           });
   
         case 'video':
           return createVideoCard({
             x: item.x, y: item.y,
             cardId: item.cardId,
           });
   
         case 'frame': {
           const card = createFrame({
             x: item.x, y: item.y, ratio: item.ratio, label: item.label,
             cardId: item.cardId,
           });
           if (item.id) card.id = item.id;
           return card;
         }
   
         /* 🎯 NOVOS — Banco de Dados */
         case 'db-table':
           return createDbTableCard({
             x: item.x, y: item.y,
             width: item.width, height: item.height,
             name: item.name || '',
             columns: item.columns || [],
             silent: true,
             cardId: item.cardId,
           });
   
         /* 🎯 NOVOS — UML */
         case 'uml-class':
           return createUmlClassCard({
             x: item.x, y: item.y,
             width: item.width, height: item.height,
             name: item.name || '',
             attrs: item.attrs || '',
             methods: item.methods || '',
             silent: true,
             cardId: item.cardId,
           });
   
         case 'uml-actor':
           return createUmlActorCard({
             x: item.x, y: item.y,
             width: item.width, height: item.height,
             label: item.label || '',
             silent: true,
             cardId: item.cardId,
           });
   
         case 'uml-usecase':
           return createUmlUseCaseCard({
             x: item.x, y: item.y,
             width: item.width, height: item.height,
             content: item.content || '',
             silent: true,
             cardId: item.cardId,
           });
   
         case 'uml-note':
           return createUmlNoteCard({
             x: item.x, y: item.y,
             width: item.width, height: item.height,
             content: item.content || '',
             silent: true,
             cardId: item.cardId,
           });
   
         case 'project':
           return null;
       }
     } catch (e) {
       console.warn('persistence: card pulado', item, e);
     }
   }
   
   /* ─── APIs globais ─── */
   /* Carrega um quadro (objeto {cards,strokes,connections,state,freetexts})
      DIRETO na tela, sem recarregar a página. Usado pelo "abrir da nuvem".
      Limpa o canvas atual e renderiza o novo, depois persiste no localStorage
      do projeto ativo para sobreviver a um refresh. */
   window.__loadBoard = function (data, persist) {
     if (!data || typeof data !== 'object') return false;
     if (persist === undefined) persist = true;
     isRestoring = true;
     try {
       // 1) limpa tudo do canvas atual
       world.querySelectorAll('.card').forEach((c) => c.remove());
       world.querySelectorAll('.freetext').forEach((f) => f.remove());
       document.querySelectorAll('.canvas-watermark').forEach((w) => w.remove());
       drawLayer.innerHTML = '';
       clearConnections();

       // 2) renderiza o novo quadro
       (data.cards || []).forEach((item) => {
         const card = restoreCard(item);
         if (card && item.frameId) card.dataset.frameId = item.frameId;
       });
       (data.freetexts || []).forEach((ft) => {
         try { createFreetext({ ...ft, silent: true }); } catch (e) {}
       });
       (data.strokes || []).forEach((s) => {
         try { restoreStroke(s); } catch (e) {}
       });
       rebuildSnaps();
       requestAnimationFrame(() =>
         requestAnimationFrame(() => loadConnections(data.connections || [])));
       if (data.state) setStateRaw(data.state);
     } catch (e) {
       console.error('[persistence] __loadBoard falhou:', e);
     } finally {
       isRestoring = false;
     }
     // 3) persiste no projeto ativo (sobrevive a refresh) — a menos que
     //    persist=false (usado pela colaboração para limpar o canvas do
     //    convidado SEM sobrescrever o projeto salvo dele).
     if (persist) { try { save(); } catch (e) {} }
     return true;
   };

   window.__whiteboardClearAll = function () {
     if (!confirm('Limpar TUDO deste canvas? Esta ação não pode ser desfeita.')) return;
     localStorage.removeItem(KEY);
     location.reload();
   };
   
   window.__flushPersistence = function () {
     if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
     if (!isRestoring) save();
   };

   /* Expostos para a colaboração (collab.js) usar a serialização COMPLETA
      de cards — cobre todos os tipos (shape, frame, uml, db, ide, image,
      youtube…), não só note/code. */
   window.__serializeCardEl = serializeCard;   // (cardEl) → objeto completo
   window.__restoreCardData = function (item) {
     isRestoring = true;
     let el = null;
     try { el = restoreCard(item); if (el && item.frameId) el.dataset.frameId = item.frameId; }
     catch (e) { console.warn('[persistence] __restoreCardData', e); }
     finally { isRestoring = false; }
     return el;
   };
   
   /* ─── BOOT ─── */
   restore();
   rebuildSnaps();
   isRestoring = false;
   
   new MutationObserver(scheduleSave).observe(world,     { childList: true, subtree: true, attributes: true });
   new MutationObserver(scheduleSave).observe(drawLayer, { childList: true });
   document.addEventListener('cardmoved', scheduleSave);
   document.addEventListener('connectionschanged', scheduleSave);
   document.addEventListener('input',  (e) => { if (e.target.closest('.card')) scheduleSave(); });
   document.addEventListener('change', (e) => { if (e.target.closest('.card')) scheduleSave(); });
   onStateChange(scheduleSave);
   
   window.addEventListener('beforeunload', () => {
     if (saveTimer) { clearTimeout(saveTimer); save(); }
   });