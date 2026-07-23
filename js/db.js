/* ════════════════════════════════════════════════════════════════════
   db.js — Cards de modelagem de Banco de Dados
   ────────────────────────────────────────────────────────────────────
   Um card `db-table` representa uma tabela: nome + lista de colunas
   com flags PK / FK / NOT NULL. Cada linha é editável in-place, e o
   botão "+ coluna" adiciona novas. As conexões partem do card inteiro
   (usa o mesmo sistema de âncoras do connections.js).

   Persistência: serialize()/restore() em persistence.js chamam este
   módulo com { name, columns:[{name,type,pk,fk,nn}, ...] }.
   ════════════════════════════════════════════════════════════════════ */

   import { createShell, toast } from './cards.js';

   const DEFAULT_COLS = [
     { name: 'id',         type: 'INT',        pk: true,  fk: false, nn: true  },
     { name: 'created_at', type: 'TIMESTAMP',  pk: false, fk: false, nn: true  },
   ];
   
   export function createDbTableCard({
     x, y, width, height, cardId, silent,
     name = '', columns = null,
   } = {}) {
     const card = createShell({
       type: 'db-table', label: 'Tabela',
       x, y, width: width || 260, height, cardId,
     });
   
     const body = document.createElement('div');
     body.className = 'card__db';
     card.appendChild(body);
   
     /* Nome da tabela ------------------------------------------------ */
     const nameEl = document.createElement('div');
     nameEl.className = 'card__db-name';
     nameEl.contentEditable = 'true';
     nameEl.spellcheck = false;
     nameEl.dataset.placeholder = 'nome_da_tabela';
     nameEl.textContent = name;
     nameEl.addEventListener('pointerdown', (e) => e.stopPropagation());
     body.appendChild(nameEl);
   
     /* Container de colunas ----------------------------------------- */
     const colsEl = document.createElement('div');
     colsEl.className = 'card__db-cols';
     body.appendChild(colsEl);
   
     const initial = Array.isArray(columns) && columns.length
       ? columns
       : (silent ? [] : DEFAULT_COLS);
     initial.forEach((c) => colsEl.appendChild(buildColumnRow(c)));
   
     /* Botão "+ coluna" --------------------------------------------- */
     const addBtn = document.createElement('button');
     addBtn.type = 'button';
     addBtn.className = 'card__db-add';
     addBtn.textContent = '+ coluna';
     addBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
     addBtn.addEventListener('click', (e) => {
       e.stopPropagation();
       const row = buildColumnRow({ name: '', type: '' });
       colsEl.appendChild(row);
       row.querySelector('.card__db-colname')?.focus();
     });
     body.appendChild(addBtn);
   
     if (!silent) {
       requestAnimationFrame(() => nameEl.focus());
     }
   
     return card;
   }
   
   /* ─────────────────────────────────────────────────────────────────
      Row builder: nome + tipo + flags. Cada célula independe. */
   function buildColumnRow({ name = '', type = '', pk = false, fk = false, nn = false }) {
     const row = document.createElement('div');
     row.className = 'card__db-col';
     row.innerHTML = `
       <span class="card__db-flag" data-kind="pk" data-active="${pk ? '1' : ''}" title="Primary Key">PK</span>
       <span class="card__db-colname" contenteditable="true" spellcheck="false" data-placeholder="coluna"></span>
       <span class="card__db-coltype" contenteditable="true" spellcheck="false" data-placeholder="tipo"></span>
       <button type="button" class="card__db-del" title="Remover coluna" aria-label="Remover">×</button>
     `;
     row.querySelector('.card__db-colname').textContent = name;
     row.querySelector('.card__db-coltype').textContent = type;
   
     /* FK e NN ficam num tooltip via clique-direito ou atalho? Para não
        poluir a UI com 3 flags visíveis por linha, embutimos como uma
        "área secreta": clique com Shift na célula PK alterna FK; com Alt
        alterna NOT NULL. Além disso, expomos badges visíveis se ativos. */
     const pkFlag = row.querySelector('.card__db-flag[data-kind="pk"]');
     pkFlag.dataset.fk = fk ? '1' : '';
     pkFlag.dataset.nn = nn ? '1' : '';
     updateFlagLabel(pkFlag);
   
     pkFlag.addEventListener('pointerdown', (e) => e.stopPropagation());
     pkFlag.addEventListener('click', (e) => {
       e.stopPropagation();
       if (e.shiftKey) {
         pkFlag.dataset.fk = pkFlag.dataset.fk ? '' : '1';
       } else if (e.altKey) {
         pkFlag.dataset.nn = pkFlag.dataset.nn ? '' : '1';
       } else {
         pkFlag.dataset.active = pkFlag.dataset.active ? '' : '1';
       }
       updateFlagLabel(pkFlag);
       row.dispatchEvent(new CustomEvent('cardmoved', { bubbles: true }));
     });
   
     /* Bloqueia drag no corpo editável. */
     row.querySelectorAll('[contenteditable]').forEach((el) => {
       el.addEventListener('pointerdown', (e) => e.stopPropagation());
     });
   
     /* Remove linha */
     const del = row.querySelector('.card__db-del');
     del.addEventListener('pointerdown', (e) => e.stopPropagation());
     del.addEventListener('click', (e) => {
       e.stopPropagation();
       row.remove();
     });
   
     return row;
   }
   
   function updateFlagLabel(el) {
     const parts = [];
     if (el.dataset.active) parts.push('PK');
     if (el.dataset.fk)     parts.push('FK');
     if (el.dataset.nn)     parts.push('NN');
     el.textContent = parts.join('·') || 'PK';
     // Ativo se qualquer flag está ligada.
     const anyOn = !!(el.dataset.active || el.dataset.fk || el.dataset.nn);
     el.setAttribute('data-any', anyOn ? '1' : '');
     el.title = 'PK (clique) · FK (Shift+clique) · NN (Alt+clique)';
   }
   
   /* ─────────────────────────────────────────────────────────────────
      Serialização — usada pela persistence.js.
      Retorna { name, columns:[{name,type,pk,fk,nn}] }. */
   export function serializeDbTable(card) {
     const name = card.querySelector('.card__db-name')?.textContent || '';
     const columns = [...card.querySelectorAll('.card__db-col')].map((r) => {
       const pkFlag = r.querySelector('.card__db-flag[data-kind="pk"]');
       return {
         name: r.querySelector('.card__db-colname')?.textContent || '',
         type: r.querySelector('.card__db-coltype')?.textContent || '',
         pk: !!(pkFlag && pkFlag.dataset.active),
         fk: !!(pkFlag && pkFlag.dataset.fk),
         nn: !!(pkFlag && pkFlag.dataset.nn),
       };
     });
     return { name, columns };
   }