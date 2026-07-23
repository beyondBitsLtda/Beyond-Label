/* ════════════════════════════════════════════════════════════════════
   ide.js — Card IDE: 1 linguagem por card, com trocador manual
   ────────────────────────────────────────────────────────────────────
   Toolbar tem um <select> com HTML/CSS/JS/SQL. Trocar linguagem:
   · Reconstrói o EditorView com o language pack certo (highlight muda)
   · Preserva o conteúdo digitado (não zera)
   · Se o buffer atual for igual ao starter da linguagem anterior,
     substitui pelo starter da nova (evita "código antigo em contexto
     novo" quando o usuário só quer experimentar).

   Preview:
     · html/js → iframe sandbox
     · css     → iframe com HTML de amostra
     · sql     → sql.js in-memory + tabela

   Persistência: { lang, content }.
   ════════════════════════════════════════════════════════════════════ */

   import { createShell, toast } from './cards.js';

   /* ───────── CodeMirror ───────── */
   let CM = null;
   async function loadCodeMirror() {
     if (CM) return CM;
     const [
       { EditorState },
       { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection,
         highlightActiveLineGutter },
       { defaultKeymap, indentWithTab, history, historyKeymap },
       { bracketMatching, indentOnInput, foldGutter, foldKeymap,
         syntaxHighlighting, defaultHighlightStyle },
       { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap },
       { lintKeymap, linter, lintGutter },
       { oneDark, oneDarkHighlightStyle },
       js, html, css, sql,
     ] = await Promise.all([
       import('@codemirror/state'),
       import('@codemirror/view'),
       import('@codemirror/commands'),
       import('@codemirror/language'),
       import('@codemirror/autocomplete'),
       import('@codemirror/lint'),
       import('@codemirror/theme-one-dark'),
       import('@codemirror/lang-javascript'),
       import('@codemirror/lang-html'),
       import('@codemirror/lang-css'),
       import('@codemirror/lang-sql'),
     ]);
     CM = {
       EditorState, EditorView, keymap, lineNumbers, highlightActiveLine,
       highlightActiveLineGutter, drawSelection,
       defaultKeymap, indentWithTab, history, historyKeymap,
       bracketMatching, indentOnInput, foldGutter, foldKeymap,
       syntaxHighlighting, defaultHighlightStyle,
       autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap,
       lintKeymap, linter, lintGutter,
       oneDark, oneDarkHighlightStyle,
       langFor: (key) => ({
         javascript: js.javascript(),
         html:       html.html(),
         css:        css.css(),
         sql:        sql.sql(),
       }[key]),
     };
     return CM;
   }
   
   /* ───────── sql.js ───────── */
   let SQL = null;
   async function loadSqlJs() {
     if (SQL) return SQL;
     const initSqlJs = (await import('sql.js')).default;
     SQL = await initSqlJs({
       locateFile: (f) => `https://esm.sh/sql.js@1.10.3/dist/${f}`,
     });
     return SQL;
   }
   
   /* ───────── Linter JS ───────── */
   function makeJsLinter(cm) {
     return cm.linter((view) => {
       const code = view.state.doc.toString();
       if (!code.trim()) return [];
       try { new Function(code); return []; }
       catch (e) {
         const msg = String(e.message || e);
         const m = msg.match(/line (\d+)/i);
         const lineNo = m ? Math.max(1, parseInt(m[1], 10)) : 1;
         const line = view.state.doc.line(Math.min(lineNo, view.state.doc.lines));
         return [{ from: line.from, to: line.to, severity: 'error', message: msg }];
       }
     });
   }
   
   /* ───────── Config por linguagem ───────── */
   const LANG_DEFS = {
     html: {
       label: 'HTML',
       starter: '<h1>Olá!</h1>\n<p>Edite e clique em ▶ Run</p>',
     },
     css: {
       label: 'CSS',
       starter: 'body {\n  font-family: system-ui;\n  padding: 24px;\n  color: #1a1a18;\n}\n\nh1 { color: oklch(0.55 0.17 295); }\nbutton { padding: 8px 14px; border-radius: 6px; }',
     },
     javascript: {
       label: 'JavaScript',
       starter: '// Sandbox. console.log aparece no painel de output.\nconsole.log("olá, mundo");\n\nfunction saudacao(nome) {\n  return `oi, ${nome}`;\n}\n\nconsole.log(saudacao("Brayan"));',
     },
     sql: {
       label: 'SQL',
       starter: "-- SQLite em memória por card.\nCREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\nINSERT INTO users (name) VALUES ('Brayan'), ('Ada'), ('Turing');\n\nSELECT * FROM users;",
     },
   };
   
   const CSS_SAMPLE_HTML = `
   <h1>Título</h1>
   <p>Parágrafo de exemplo com <a href="#">link</a> e <strong>ênfase</strong>.</p>
   <button>Botão</button>
   <ul><li>Item A</li><li>Item B</li><li>Item C</li></ul>
   `;
   
   /* Conjunto de starters — usado pra detectar "conteúdo intocado" na hora
      de trocar linguagem e substituir pelo starter novo. */
   const STARTERS = new Set(Object.values(LANG_DEFS).map((d) => d.starter));
   
   /* ════════════════════════════════════════════════════════════════════
      createIdeCard
      ════════════════════════════════════════════════════════════════════ */
   export async function createIdeCard({
     x, y, width, height, cardId, silent,
     lang = 'javascript', content = null,
   } = {}) {
     const card = createShell({
       type: 'ide', label: 'IDE',
       x, y,
       width:  width  || 560,
       height: height || 380,
       cardId,
     });
     card.dataset.lang = lang;
   
     const body = document.createElement('div');
     body.className = 'card__ide';
     card.appendChild(body);
   
     /* Toolbar com seletor de linguagem */
     const toolbar = document.createElement('div');
     toolbar.className = 'card__ide-toolbar';
     toolbar.innerHTML = `
       <select class="card__ide-lang-select" title="Trocar linguagem">
         ${Object.entries(LANG_DEFS).map(([key, def]) =>
           `<option value="${key}"${key === lang ? ' selected' : ''}>${def.label}</option>`
         ).join('')}
       </select>
       <div class="card__ide-actions">
         <button type="button" class="card__ide-run" title="Run (Ctrl+Enter)">▶ Run</button>
         <button type="button" class="card__ide-clear" title="Fechar preview">⌫</button>
       </div>
     `;
     toolbar.addEventListener('pointerdown', (e) => e.stopPropagation());
     body.appendChild(toolbar);
   
     const editorWrap = document.createElement('div');
     editorWrap.className = 'card__ide-editor';
     editorWrap.addEventListener('pointerdown', (e) => e.stopPropagation());
     body.appendChild(editorWrap);
   
     const previewWrap = document.createElement('div');
     previewWrap.className = 'card__ide-preview';
     previewWrap.hidden = true;
     previewWrap.addEventListener('pointerdown', (e) => e.stopPropagation());
     body.appendChild(previewWrap);
   
     editorWrap.innerHTML = `<div class="card__ide-loading">Carregando editor…</div>`;
   
     const cm = await loadCodeMirror();
     editorWrap.innerHTML = '';
   
     /* Estado mutável */
     let currentLang = lang;
     let currentDoc  = content ?? LANG_DEFS[lang].starter;
     let view = null;
   
     function buildExtensions(langKey) {
       return [
         cm.lineNumbers(),
         cm.highlightActiveLineGutter(),
         cm.foldGutter(),
         cm.history(),
         cm.drawSelection(),
         cm.highlightActiveLine(),
         cm.bracketMatching(),
         cm.closeBrackets(),
         cm.autocompletion(),
         cm.indentOnInput(),
         cm.langFor(langKey),
         cm.syntaxHighlighting(cm.oneDarkHighlightStyle, { fallback: true }),
         cm.oneDark,
         cm.lintGutter(),
         ...(langKey === 'javascript' ? [makeJsLinter(cm)] : []),
         cm.keymap.of([
           cm.indentWithTab,
           ...cm.defaultKeymap,
           ...cm.historyKeymap,
           ...cm.foldKeymap,
           ...cm.completionKeymap,
           ...cm.lintKeymap,
           { key: 'Ctrl-Enter', mac: 'Cmd-Enter', run: () => { run(); return true; } },
         ]),
         cm.EditorView.updateListener.of((u) => {
           if (u.docChanged) {
             currentDoc = u.state.doc.toString();
             card.dispatchEvent(new CustomEvent('cardmoved', { bubbles: true }));
           }
         }),
         cm.EditorView.theme({
           '&':            { height: '100%', fontSize: '12px' },
           '.cm-scroller': { fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)' },
         }),
       ];
     }
   
     function mountEditor(langKey, doc) {
       if (view) { view.destroy(); view = null; }
       view = new cm.EditorView({
         state: cm.EditorState.create({
           doc,
           extensions: buildExtensions(langKey),
         }),
         parent: editorWrap,
       });
     }
   
     mountEditor(currentLang, currentDoc);
   
     /* ── SELECT: troca de linguagem ── */
     const langSelect = toolbar.querySelector('.card__ide-lang-select');
     langSelect.addEventListener('change', () => {
       const newLang = langSelect.value;
       if (newLang === currentLang) return;
   
       /* Se o conteúdo atual é intocado (é um dos starters), oferece
          substituir pelo starter da nova linguagem. Se o usuário já
          digitou algo próprio, preserva. */
       let newDoc = currentDoc;
       if (STARTERS.has(currentDoc)) {
         newDoc = LANG_DEFS[newLang].starter;
       }
   
       currentLang = newLang;
       currentDoc  = newDoc;
       card.dataset.lang = newLang;
   
       mountEditor(currentLang, currentDoc);
   
       /* Fecha preview: contexto mudou, preview antigo não faz sentido. */
       previewWrap.hidden = true;
       previewWrap.innerHTML = '';
   
       /* Refoca o editor pra continuar digitando */
       requestAnimationFrame(() => view?.focus());
       card.dispatchEvent(new CustomEvent('cardmoved', { bubbles: true }));
     });
   
     /* ── RUN / CLEAR ── */
     toolbar.querySelector('.card__ide-run').addEventListener('click', run);
     toolbar.querySelector('.card__ide-clear').addEventListener('click', () => {
       previewWrap.hidden = true;
       previewWrap.innerHTML = '';
     });
   
     function run() {
       if (currentLang === 'sql') {
         runSql().catch((e) => showOutput(`Erro: ${e.message || e}`, 'error'));
       } else {
         runWeb();
       }
     }
   
     function runWeb() {
       previewWrap.hidden = false;
       previewWrap.innerHTML = '';
   
       const hookScript = `
         <script>
           (function() {
             const send = (level, args) => {
               try {
                 parent.postMessage({
                   __ide: true,
                   level,
                   text: Array.from(args).map(a => {
                     try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
                     catch { return String(a); }
                   }).join(' ')
                 }, '*');
               } catch {}
             };
             ['log', 'warn', 'error', 'info'].forEach(k => {
               const orig = console[k];
               console[k] = function() { send(k, arguments); orig.apply(console, arguments); };
             });
             window.addEventListener('error', (e) =>
               send('error', [e.message + ' (' + (e.filename||'') + ':' + e.lineno + ')']));
           })();
         </script>
       `;
   
       let srcdoc;
       if (currentLang === 'html') {
         srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
   <body>${currentDoc}
   ${hookScript}
   </body></html>`;
       } else if (currentLang === 'css') {
         srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8">
   <style>${currentDoc}</style></head>
   <body>${CSS_SAMPLE_HTML}
   ${hookScript}
   </body></html>`;
       } else {
         srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8">
   <style>body{font-family:ui-monospace,Menlo,monospace;padding:12px;color:#e5e7eb;background:#21252b;font-size:12px;margin:0}</style>
   </head><body>
   ${hookScript}
   <script>
   try { ${currentDoc} } catch (e) { console.error(e.message); }
   </script>
   </body></html>`;
       }
   
       const iframe = document.createElement('iframe');
       iframe.className = 'card__ide-iframe';
       iframe.setAttribute('sandbox', 'allow-scripts');
       iframe.srcdoc = srcdoc;
       previewWrap.appendChild(iframe);
   
       const outputPanel = document.createElement('div');
       outputPanel.className = 'card__ide-output';
       previewWrap.appendChild(outputPanel);
       previewWrap._output = outputPanel;
     }
   
     async function runSql() {
       previewWrap.hidden = false;
       previewWrap.innerHTML = `<div class="card__ide-output"><div class="card__ide-output-empty">Carregando SQLite…</div></div>`;
   
       const S = await loadSqlJs();
       const db = new S.Database();
       try {
         const results = db.exec(currentDoc);
         previewWrap.innerHTML = '';
         const outputPanel = document.createElement('div');
         outputPanel.className = 'card__ide-output card__ide-output--sql';
         previewWrap.appendChild(outputPanel);
   
         if (!results.length) {
           outputPanel.innerHTML = `<div class="card__ide-log card__ide-log--ok">OK (sem resultado)</div>`;
         } else {
           results.forEach((r, idx) => {
             if (results.length > 1) {
               const cap = document.createElement('div');
               cap.className = 'card__ide-sql-caption';
               cap.textContent = `Result ${idx + 1}`;
               outputPanel.appendChild(cap);
             }
             const table = document.createElement('table');
             table.className = 'card__ide-sql-table';
             table.innerHTML = `
               <thead><tr>${r.columns.map((c) => `<th>${escapeHTML(c)}</th>`).join('')}</tr></thead>
               <tbody>${r.values.map((row) =>
                 `<tr>${row.map((v) => `<td>${escapeHTML(v == null ? 'NULL' : String(v))}</td>`).join('')}</tr>`
               ).join('')}</tbody>
             `;
             outputPanel.appendChild(table);
           });
         }
       } finally {
         db.close();
       }
     }
   
     function showOutput(msg, kind = 'log') {
       const panel = previewWrap._output;
       if (!panel) return;
       const line = document.createElement('div');
       line.className = `card__ide-log card__ide-log--${kind}`;
       line.textContent = msg;
       panel.appendChild(line);
       panel.scrollTop = panel.scrollHeight;
     }
   
     const onMsg = (e) => {
       if (!e.data || !e.data.__ide) return;
       const iframe = previewWrap.querySelector('iframe');
       if (!iframe || e.source !== iframe.contentWindow) return;
       showOutput(e.data.text, e.data.level || 'log');
     };
     window.addEventListener('message', onMsg);
   
     new MutationObserver((muts) => {
       for (const m of muts) {
         for (const n of m.removedNodes) {
           if (n === card || n.contains?.(card)) {
             window.removeEventListener('message', onMsg);
             view?.destroy();
           }
         }
       }
     }).observe(card.parentNode || document.body, { childList: true, subtree: true });
   
     if (!silent) requestAnimationFrame(() => view?.focus());
   
     card._ide = {
       getLang: () => currentLang,
       getContent: () => currentDoc,
     };
   
     return card;
   }
   
   export function serializeIde(card) {
     const api = card._ide;
     if (!api) return { lang: card.dataset.lang || 'javascript', content: '' };
     return { lang: api.getLang(), content: api.getContent() };
   }
   
   function escapeHTML(s) {
     return String(s).replace(/[&<>]/g, (c) =>
       ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]));
   }