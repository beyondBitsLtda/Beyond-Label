/* ════════════════════════════════════════════════════════════════════
   theme.js — Sistema de temas (tokens CSS trocados por data-theme)
   ────────────────────────────────────────────────────────────────────
   Os valores de cor de cada tema vivem em patches.css, sob os seletores
   [data-theme="..."]. Este módulo só aplica o atributo em <html>,
   persiste a escolha e desenha um seletor discreto na HUD.

   Temas:
     · claro    — o papel original (default)
     · escuro   — dark mode neutro
     · neon     — fundo grafite + accent ciano/magenta (criativo)
     · sepia    — tons quentes de pergaminho (criativo)
     · terminal — verde-fósforo sobre preto (criativo)

   Aplicado o mais cedo possível para evitar "flash" do tema claro.
   ════════════════════════════════════════════════════════════════════ */

   const KEY = 'whiteboard:theme';

   const THEMES = [
     { id: 'claro',    label: 'Claro',    swatch: '#f6f5f1' },
     { id: 'escuro',   label: 'Escuro',   swatch: '#1c1c20' },
     { id: 'neon',     label: 'Neon',     swatch: '#16181d' },
     { id: 'sepia',    label: 'Sépia',    swatch: '#e9ddc4' },
     { id: 'terminal', label: 'Terminal', swatch: '#0a0e0a' },
   ];
   
   function current() {
     return localStorage.getItem(KEY) || 'claro';
   }
   
   export function applyTheme(id) {
     const valid = THEMES.some((t) => t.id === id) ? id : 'claro';
     document.documentElement.setAttribute('data-theme', valid);
     localStorage.setItem(KEY, valid);
     // Atualiza a cor da barra do navegador (mobile) se houver meta.
     let meta = document.querySelector('meta[name="theme-color"]');
     if (!meta) {
       meta = document.createElement('meta');
       meta.name = 'theme-color';
       document.head.appendChild(meta);
     }
     const sw = THEMES.find((t) => t.id === valid)?.swatch || '#f6f5f1';
     meta.content = sw;
     // Notifica quem quiser reagir (ex.: minimap redesenhar cores).
     document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: valid } }));
   }
   
   /* Aplica imediatamente (antes do primeiro paint completo). */
   applyTheme(current());
   
   /* ────── Seletor na HUD (bottom-right, ao lado do zoom) ────── */
   function buildSelector() {
     const host = document.querySelector('.hud--bottomright');
     if (!host || document.getElementById('theme-toggle')) return;
   
     const sep = document.createElement('span');
     sep.className = 'hud__sep';
     host.insertBefore(sep, host.firstChild);
   
     const wrap = document.createElement('div');
     wrap.className = 'theme-picker';
     wrap.style.cssText = 'position:relative;display:inline-flex;';
   
     const btn = document.createElement('button');
     btn.id = 'theme-toggle';
     btn.className = 'hud__btn';
     btn.title = 'Tema';
     btn.setAttribute('aria-label', 'Trocar tema');
     btn.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 1.5a6.5 6.5 0 1 0 0 13c.6 0 1-.5.7-1-.4-.7-.2-1.6.5-2 .6-.4 1.5-.2 1.9.4.3.5 1 .4 1.3-.1A6.5 6.5 0 0 0 8 1.5zm-3 7a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm1.5-3a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm3 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" fill="currentColor"/></svg>';
   
     const pop = document.createElement('div');
     pop.className = 'theme-pop';
     pop.hidden = true;
     pop.style.cssText = `position:absolute;bottom:calc(100% + 8px);right:0;
       background:var(--bg-elevated,#fdfcf9);border:1px solid var(--border,rgba(26,26,24,0.1));
       border-radius:12px;padding:6px;box-shadow:0 12px 32px rgba(0,0,0,0.22);
       display:flex;flex-direction:column;gap:2px;min-width:150px;z-index:60;`;
   
     THEMES.forEach((t) => {
       const opt = document.createElement('button');
       opt.type = 'button';
       opt.className = 'theme-opt';
       opt.dataset.theme = t.id;
       opt.style.cssText = `display:flex;align-items:center;gap:9px;padding:7px 9px;
         border:none;background:transparent;border-radius:8px;cursor:pointer;
         font-family:var(--font-sans,sans-serif);font-size:12.5px;color:var(--ink,#1a1a18);
         text-align:left;transition:background .12s;`;
       opt.innerHTML = `<span style="width:14px;height:14px;border-radius:4px;flex:0 0 auto;
         border:1px solid rgba(128,128,128,0.4);background:${t.swatch};"></span>
         <span>${t.label}</span>`;
       opt.addEventListener('mouseenter', () => opt.style.background = 'var(--accent-soft,rgba(124,58,237,0.1))');
       opt.addEventListener('mouseleave', () => opt.style.background = 'transparent');
       opt.addEventListener('click', () => {
         applyTheme(t.id);
         markActive();
         pop.hidden = true;
       });
       pop.appendChild(opt);
     });
   
     function markActive() {
       const cur = current();
       pop.querySelectorAll('.theme-opt').forEach((o) =>
         o.style.fontWeight = o.dataset.theme === cur ? '600' : '400');
     }
   
     btn.addEventListener('click', (e) => {
       e.stopPropagation();
       pop.hidden = !pop.hidden;
       if (!pop.hidden) markActive();
     });
     document.addEventListener('pointerdown', (e) => {
       if (!wrap.contains(e.target)) pop.hidden = true;
     });
   
     wrap.appendChild(btn);
     wrap.appendChild(pop);
     host.insertBefore(wrap, host.firstChild);
   }
   
   if (document.readyState === 'loading') {
     document.addEventListener('DOMContentLoaded', buildSelector);
   } else {
     buildSelector();
   }