/* ════════════════════════════════════════════════════════════════════
   modal.js — Modais customizados no estilo da aplicação
   ────────────────────────────────────────────────────────────────────
   Substitui os prompt()/confirm() nativos do navegador (que mostram o
   nome da página e quebram a estética) por diálogos próprios.

   API (todas retornam Promise):
     · promptModal({ title, message, value, placeholder, confirmText })
         → resolve com a string digitada, ou null se cancelado.
     · confirmModal({ title, message, confirmText, cancelText, danger })
         → resolve com true (confirmou) ou false (cancelou).
     · chooseModal({ title, message, options: [{ value, label, hint }] })
         → resolve com o `value` escolhido, ou null se cancelado.

   Acessibilidade: foco preso no diálogo, Enter confirma, Esc cancela,
   clique no backdrop cancela. Injeta o próprio CSS uma única vez.
   ════════════════════════════════════════════════════════════════════ */

   let stylesInjected = false;
   function ensureStyles() {
     if (stylesInjected) return;
     stylesInjected = true;
     const s = document.createElement('style');
     s.id = 'modal-styles';
     s.textContent = `
       .app-modal-overlay{position:fixed;inset:0;z-index:9999;display:flex;
         align-items:center;justify-content:center;padding:24px;opacity:1;
         background:rgba(20,20,18,0.42);backdrop-filter:blur(3px);
         animation:modalFade .16s ease;}
       .modal-card{background:var(--bg-elevated,#fdfcf9);color:var(--ink,#1a1a18);
         width:min(420px,100%);border-radius:16px;padding:22px 22px 18px;
         box-shadow:0 24px 60px rgba(0,0,0,0.28),0 2px 8px rgba(0,0,0,0.12);
         border:1px solid var(--border,rgba(26,26,24,0.08));
         font-family:var(--font-sans,system-ui,sans-serif);
         animation:modalPop .18s cubic-bezier(.2,.9,.3,1.2);}
       .modal-card__title{font-size:15px;font-weight:600;letter-spacing:.01em;margin:0 0 6px;}
       .modal-card__msg{font-size:13px;line-height:1.5;color:var(--ink-soft,#6b6a64);
         margin:0 0 16px;white-space:pre-line;}
       .modal-card__input{width:100%;box-sizing:border-box;font-size:14px;
         font-family:inherit;color:var(--ink,#1a1a18);
         background:var(--bg,#f6f5f1);border:1.5px solid var(--border,rgba(26,26,24,0.12));
         border-radius:10px;padding:10px 12px;outline:none;transition:border-color .12s;}
       .modal-card__input:focus{border-color:var(--accent,#7c3aed);}
       .modal-card__opts{display:flex;flex-direction:column;gap:6px;margin-bottom:14px;}
       .modal-card__opt{display:flex;align-items:center;gap:10px;text-align:left;
         font-family:inherit;font-size:13px;color:var(--ink,#1a1a18);cursor:pointer;
         background:var(--bg,#f6f5f1);border:1.5px solid transparent;
         border-radius:10px;padding:11px 13px;transition:border-color .12s,background .12s;}
       .modal-card__opt:hover{border-color:var(--accent,#7c3aed);
         background:var(--accent-soft,rgba(124,58,237,0.08));}
       .modal-card__opt-hint{margin-left:auto;font-size:11px;color:var(--ink-faint,#b8b6ad);}
       .modal-card__row{display:flex;justify-content:flex-end;gap:8px;margin-top:16px;}
       .modal-card__btn{font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;
         border-radius:9px;padding:9px 16px;border:1.5px solid transparent;transition:all .12s;}
       .modal-card__btn--ghost{background:transparent;color:var(--ink-soft,#6b6a64);
         border-color:var(--border,rgba(26,26,24,0.14));}
       .modal-card__btn--ghost:hover{background:var(--bg,#f6f5f1);color:var(--ink,#1a1a18);}
       .modal-card__btn--primary{background:var(--accent,#7c3aed);color:#fff;}
       .modal-card__btn--primary:hover{filter:brightness(1.06);}
       .modal-card__btn--danger{background:oklch(0.55 0.20 25);color:#fff;}
       .modal-card__btn--danger:hover{filter:brightness(1.06);}
       @keyframes modalFade{from{opacity:0}to{opacity:1}}
       @keyframes modalPop{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
     `;
     document.head.appendChild(s);
   }
   
   function buildOverlay() {
     const overlay = document.createElement('div');
     overlay.className = 'app-modal-overlay';
     const card = document.createElement('div');
     card.className = 'modal-card';
     overlay.appendChild(card);
     return { overlay, card };
   }
   
   function esc(s) {
     return String(s).replace(/[&<>"]/g, (c) =>
       ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
   }
   
   /* ────── promptModal ────── */
   export function promptModal({
     title = 'Digite um valor',
     message = '',
     value = '',
     placeholder = '',
     confirmText = 'OK',
     cancelText = 'Cancelar',
   } = {}) {
     ensureStyles();
     return new Promise((resolve) => {
       const { overlay, card } = buildOverlay();
       card.innerHTML = `
         <h3 class="modal-card__title">${esc(title)}</h3>
         ${message ? `<p class="modal-card__msg">${esc(message)}</p>` : ''}
         <input class="modal-card__input" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}">
         <div class="modal-card__row">
           <button class="modal-card__btn modal-card__btn--ghost" data-act="cancel">${esc(cancelText)}</button>
           <button class="modal-card__btn modal-card__btn--primary" data-act="ok">${esc(confirmText)}</button>
         </div>
       `;
       document.body.appendChild(overlay);
       const input = card.querySelector('.modal-card__input');
       const done = (val) => { cleanup(overlay, onKey); resolve(val); };
   
       card.querySelector('[data-act="ok"]').addEventListener('click', () => done(input.value));
       card.querySelector('[data-act="cancel"]').addEventListener('click', () => done(null));
       overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) done(null); });
       function onKey(e) {
         if (e.key === 'Enter') { e.preventDefault(); done(input.value); }
         if (e.key === 'Escape') { e.preventDefault(); done(null); }
       }
       window.addEventListener('keydown', onKey, true);
       requestAnimationFrame(() => { input.focus(); input.select(); });
     });
   }
   
   /* ────── confirmModal ────── */
   export function confirmModal({
     title = 'Tem certeza?',
     message = '',
     confirmText = 'Confirmar',
     cancelText = 'Cancelar',
     danger = false,
   } = {}) {
     ensureStyles();
     return new Promise((resolve) => {
       const { overlay, card } = buildOverlay();
       card.innerHTML = `
         <h3 class="modal-card__title">${esc(title)}</h3>
         ${message ? `<p class="modal-card__msg">${esc(message)}</p>` : ''}
         <div class="modal-card__row">
           <button class="modal-card__btn modal-card__btn--ghost" data-act="cancel">${esc(cancelText)}</button>
           <button class="modal-card__btn modal-card__btn--${danger ? 'danger' : 'primary'}" data-act="ok">${esc(confirmText)}</button>
         </div>
       `;
       document.body.appendChild(overlay);
       const done = (val) => { cleanup(overlay, onKey); resolve(val); };
   
       card.querySelector('[data-act="ok"]').addEventListener('click', () => done(true));
       card.querySelector('[data-act="cancel"]').addEventListener('click', () => done(false));
       overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) done(false); });
       function onKey(e) {
         if (e.key === 'Enter') { e.preventDefault(); done(true); }
         if (e.key === 'Escape') { e.preventDefault(); done(false); }
       }
       window.addEventListener('keydown', onKey, true);
       requestAnimationFrame(() => card.querySelector('[data-act="ok"]').focus());
     });
   }
   
   /* ────── chooseModal (lista de opções) ────── */
   export function chooseModal({
     title = 'Escolha',
     message = '',
     options = [],
     cancelText = 'Cancelar',
   } = {}) {
     ensureStyles();
     return new Promise((resolve) => {
       const { overlay, card } = buildOverlay();
       const optsHtml = options.map((o, i) => `
         <button class="modal-card__opt" data-idx="${i}">
           <span>${esc(o.label)}</span>
           ${o.hint ? `<span class="modal-card__opt-hint">${esc(o.hint)}</span>` : ''}
         </button>`).join('');
       card.innerHTML = `
         <h3 class="modal-card__title">${esc(title)}</h3>
         ${message ? `<p class="modal-card__msg">${esc(message)}</p>` : ''}
         <div class="modal-card__opts">${optsHtml}</div>
         <div class="modal-card__row">
           <button class="modal-card__btn modal-card__btn--ghost" data-act="cancel">${esc(cancelText)}</button>
         </div>
       `;
       document.body.appendChild(overlay);
       const done = (val) => { cleanup(overlay, onKey); resolve(val); };
   
       card.querySelectorAll('.modal-card__opt').forEach((btn) =>
         btn.addEventListener('click', () => done(options[+btn.dataset.idx].value)));
       card.querySelector('[data-act="cancel"]').addEventListener('click', () => done(null));
       overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) done(null); });
       function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); done(null); } }
       window.addEventListener('keydown', onKey, true);
     });
   }
   
   function cleanup(overlay, onKey) {
     window.removeEventListener('keydown', onKey, true);
     overlay.style.animation = 'modalFade .12s ease reverse';
     setTimeout(() => overlay.remove(), 110);
   }