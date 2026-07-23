/* ════════════════════════════════════════════════════════════════════
   uml.js — Cards para diagramas UML
   ────────────────────────────────────────────────────────────────────
   Tipos:
     · uml-class   — retângulo com 3 compartimentos (nome, atributos, métodos)
     · uml-actor   — figura palito estilizada + rótulo
     · uml-usecase — elipse com texto centralizado
     · uml-note    — post-it dobrado no canto (nota UML)

   Os relacionamentos (herança, composição, agregação, dependência,
   realização) são estilos de CONEXÃO — vivem em connections.js. Este
   módulo só constrói os shells e o conteúdo.
   ════════════════════════════════════════════════════════════════════ */

   import { createShell } from './cards.js';

   /* ───────────────────────── UML CLASS ───────────────────────── */
   
   export function createUmlClassCard({
     x, y, width, height, cardId, silent,
     name = '', attrs = '', methods = '',
   } = {}) {
     const card = createShell({
       type: 'uml-class', label: 'Classe',
       x, y, width: width || 220, height, cardId,
     });
   
     const body = document.createElement('div');
     body.className = 'card__uml-class';
   
     const nameEl = document.createElement('div');
     nameEl.className = 'card__uml-name';
     nameEl.contentEditable = 'true';
     nameEl.spellcheck = false;
     nameEl.dataset.placeholder = 'NomeDaClasse';
     nameEl.textContent = name;
     nameEl.addEventListener('pointerdown', (e) => e.stopPropagation());
   
     const attrsEl = document.createElement('div');
     attrsEl.className = 'card__uml-section';
     attrsEl.dataset.part = 'attrs';
     attrsEl.contentEditable = 'true';
     attrsEl.spellcheck = false;
     attrsEl.dataset.placeholder = '- atributo: Tipo';
     attrsEl.textContent = attrs;
     attrsEl.addEventListener('pointerdown', (e) => e.stopPropagation());
   
     const methodsEl = document.createElement('div');
     methodsEl.className = 'card__uml-section';
     methodsEl.dataset.part = 'methods';
     methodsEl.contentEditable = 'true';
     methodsEl.spellcheck = false;
     methodsEl.dataset.placeholder = '+ metodo(): Tipo';
     methodsEl.textContent = methods;
     methodsEl.addEventListener('pointerdown', (e) => e.stopPropagation());
   
     body.appendChild(nameEl);
     body.appendChild(attrsEl);
     body.appendChild(methodsEl);
     card.appendChild(body);
   
     if (!silent) {
       requestAnimationFrame(() => nameEl.focus());
     }
     return card;
   }
   
   /* ───────────────────────── UML ACTOR ───────────────────────── */
   
   export function createUmlActorCard({
     x, y, width, height, cardId, silent,
     label = '',
   } = {}) {
     const card = createShell({
       type: 'uml-actor', label: 'Ator',
       x, y, width: width || 90, height: height || 130, cardId,
     });
   
     const body = document.createElement('div');
     body.className = 'card__uml-actor';
     body.innerHTML = `
       <svg viewBox="0 0 60 90" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
         <circle cx="30" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>
         <line x1="30" y1="21" x2="30" y2="55" stroke="currentColor" stroke-width="2"/>
         <line x1="10" y1="35" x2="50" y2="35" stroke="currentColor" stroke-width="2"/>
         <line x1="30" y1="55" x2="15" y2="82" stroke="currentColor" stroke-width="2"/>
         <line x1="30" y1="55" x2="45" y2="82" stroke="currentColor" stroke-width="2"/>
       </svg>
       <div class="card__uml-actor-label" contenteditable="true" spellcheck="false"
            data-placeholder="Ator"></div>
     `;
     const labelEl = body.querySelector('.card__uml-actor-label');
     labelEl.textContent = label;
     labelEl.addEventListener('pointerdown', (e) => e.stopPropagation());
   
     card.appendChild(body);
   
     if (!silent) {
       requestAnimationFrame(() => labelEl.focus());
     }
     return card;
   }
   
   /* ─────────────────────── UML USE CASE ─────────────────────── */
   
   export function createUmlUseCaseCard({
     x, y, width, height, cardId, silent,
     content = '',
   } = {}) {
     const card = createShell({
       type: 'uml-usecase', label: 'Use case',
       x, y, width: width || 180, height: height || 90, cardId,
     });
   
     const body = document.createElement('div');
     body.className = 'card__uml-usecase';
     body.innerHTML = `
       <div class="card__uml-usecase-ellipse"></div>
       <div class="card__uml-usecase-text" contenteditable="true" spellcheck="false"
            data-placeholder="ação do usuário"></div>
     `;
     const text = body.querySelector('.card__uml-usecase-text');
     text.textContent = content;
     text.addEventListener('pointerdown', (e) => e.stopPropagation());
   
     card.appendChild(body);
   
     if (!silent) {
       requestAnimationFrame(() => text.focus());
     }
     return card;
   }
   
   /* ───────────────────────── UML NOTE ───────────────────────── */
   
   export function createUmlNoteCard({
     x, y, width, height, cardId, silent,
     content = '',
   } = {}) {
     const card = createShell({
       type: 'uml-note', label: 'Nota UML',
       x, y, width: width || 200, height, cardId,
     });
   
     const body = document.createElement('div');
     body.className = 'card__uml-note';
     body.contentEditable = 'true';
     body.spellcheck = false;
     body.dataset.placeholder = 'Comentário…';
     body.textContent = content;
     body.addEventListener('pointerdown', (e) => e.stopPropagation());
   
     card.appendChild(body);
   
     if (!silent) {
       requestAnimationFrame(() => body.focus());
     }
     return card;
   }