/* ════════════════════════════════════════════════════════════════════
   connections.js — Conexões entre cards (fluxograma)
   ────────────────────────────────────────────────────────────────────
   MODELO
     · Uma conexão liga dois cards:
         { id, from, to, fromAnchor, toAnchor, style, label }.
         - from/to            : data-card-id de origem/destino.
         - fromAnchor/toAnchor: 'top'|'right'|'bottom'|'left'|'auto'.
                                'auto' = ponto dinâmico em direção ao outro card
                                (comportamento legado, retrocompat).
         - style              : 'straight' | 'curved' | 'double'.
         - label              : texto opcional no meio da seta.
     · MÚLTIPLAS conexões entre os mesmos cards são permitidas.
     · As setas vivem numa camada SVG DENTRO do #world, então herdam
       o transform de pan/zoom (escalam junto com os cards).
     · Re-render é disparado em: 'cardmoved' (drag/resize), pan/zoom,
       cards adicionados/removidos.

   INTERAÇÃO
     · ÂNCORAS por borda: ao passar o mouse no card, 4 pontos aparecem
       (topo, direita, base, esquerda). Arrastar de uma âncora cria
       uma linha elástica curvada perpendicular à borda; durante o drag,
       a ponta "gruda" magneticamente na âncora mais próxima do alvo.
     · "Modo conectar" (tecla L ou botão da HUD): clique origem + destino.
       Útil quando se quer conexão sem precisar acertar a âncora.
     · Clique numa seta → seleção + mini-menu (estilo, rótulo, apagar).
     · Duplo-clique numa seta → foca direto o input de rótulo.
     · Delete/Backspace com conexão selecionada → apaga.
     · Escape → desseleciona / fecha menu.

   PERSISTÊNCIA
     · As conexões são expostas via getConnections()/loadConnections()
       para o persistence.js incluir no JSON (export/import).

   Este módulo é a fonte de verdade das conexões em memória.
   ════════════════════════════════════════════════════════════════════ */

   const SVG_NS = 'http://www.w3.org/2000/svg';
   const world = document.getElementById('world');
   
   /* Estado: mapa id → conexão. */
   const connections = new Map();
   let connectMode = false;
   let pendingFrom = null;     // card de origem aguardando destino
   let selectedId = null;
   
   /* ────────────────────────────────────────────────────────────────────
      Camada SVG das conexões (abaixo dos cards, acima do fundo)
      ──────────────────────────────────────────────────────────────────── */
   const svg = document.createElementNS(SVG_NS, 'svg');
   svg.setAttribute('id', 'connections-layer');
   svg.setAttribute('width', '40000');
   svg.setAttribute('height', '40000');
   svg.setAttribute('viewBox', '-20000 -20000 40000 40000');
   svg.style.position = 'absolute';
   svg.style.left = '-20000px';
   svg.style.top  = '-20000px';
   svg.style.overflow = 'visible';
   svg.style.pointerEvents = 'none';   // o SVG não bloqueia; paths reabilitam
   svg.style.zIndex = '1';             // acima do draw-layer (0), abaixo dos cards
   // Definições de marcadores de seta (uma cor neutra; herdada por currentColor).
   svg.innerHTML = `
     <defs>
       <marker id="arrow-end" viewBox="0 0 10 10" refX="9" refY="5"
               markerWidth="7" markerHeight="7" orient="auto-start-reverse">
         <path d="M0 0 L10 5 L0 10 z" fill="context-stroke"/>
       </marker>
       <marker id="arrow-start" viewBox="0 0 10 10" refX="1" refY="5"
               markerWidth="7" markerHeight="7" orient="auto-start-reverse">
         <path d="M10 0 L0 5 L10 10 z" fill="context-stroke"/>
       </marker>
       <!-- UML: herança (triângulo vazio) -->
       <marker id="uml-inheritance" viewBox="0 0 12 12" refX="11" refY="6"
               markerWidth="12" markerHeight="12" orient="auto-start-reverse">
         <path d="M0 0 L11 6 L0 12 z" fill="var(--bg-elevated, #fff)" stroke="context-stroke" stroke-width="1.4"/>
       </marker>
       <!-- UML: realização (mesmo triângulo, usado com linha tracejada) -->
       <marker id="uml-realization" viewBox="0 0 12 12" refX="11" refY="6"
               markerWidth="12" markerHeight="12" orient="auto-start-reverse">
         <path d="M0 0 L11 6 L0 12 z" fill="var(--bg-elevated, #fff)" stroke="context-stroke" stroke-width="1.4"/>
       </marker>
       <!-- BD/UML: composição (losango preenchido) -->
       <marker id="uml-composition" viewBox="0 0 14 10" refX="1" refY="5"
               markerWidth="12" markerHeight="10" orient="auto-start-reverse">
         <path d="M1 5 L7 1 L13 5 L7 9 z" fill="context-stroke"/>
       </marker>
       <!-- UML: agregação (losango vazio) -->
       <marker id="uml-aggregation" viewBox="0 0 14 10" refX="1" refY="5"
               markerWidth="12" markerHeight="10" orient="auto-start-reverse">
         <path d="M1 5 L7 1 L13 5 L7 9 z" fill="var(--bg-elevated, #fff)" stroke="context-stroke" stroke-width="1.4"/>
       </marker>
       <!-- BD Crow's Foot: "muitos" -->
       <marker id="db-many" viewBox="0 0 12 12" refX="11" refY="6"
               markerWidth="14" markerHeight="14" orient="auto-start-reverse">
         <path d="M11 6 L0 0 M11 6 L0 6 M11 6 L0 12" fill="none" stroke="context-stroke" stroke-width="1.4"/>
       </marker>
       <!-- BD Crow's Foot: "um" -->
       <marker id="db-one" viewBox="0 0 12 12" refX="11" refY="6"
               markerWidth="12" markerHeight="12" orient="auto-start-reverse">
         <path d="M6 1 L6 11" stroke="context-stroke" stroke-width="1.4" fill="none"/>
       </marker>
     </defs>
   `;
   world.appendChild(svg);
   
   /* ────────────────────────────────────────────────────────────────────
      Geometria — onde a seta toca cada card
      ──────────────────────────────────────────────────────────────────── */
   
   function cardRect(cardId) {
     const el = world.querySelector(`[data-card-id="${cardId}"]`);
     if (!el) return null;
     let x, y;
     const insideFrame = el.parentElement &&
       el.parentElement.classList.contains('card__frame-contents');
     /* 🎯 FIX: cards DENTRO de um frame não têm style.left/top (o
        attachToFrame remove — eles passam a ser posicionados pelo layout
        do frame). Ler style.left/top devolvia 0/0 e a seta ia parar na
        origem do mundo. Derivamos a posição de MUNDO a partir do
        retângulo em tela (getBoundingClientRect → screenToWorld). */
     if (!insideFrame && el.style.left !== '' && el.style.top !== '') {
       x = parseFloat(el.style.left) || 0;
       y = parseFloat(el.style.top)  || 0;
     } else {
       const r  = el.getBoundingClientRect();
       const tl = screenToWorld(r.left, r.top);
       x = tl.x; y = tl.y;
     }
     return { x, y, w: el.offsetWidth, h: el.offsetHeight,
              cx: x + el.offsetWidth / 2, cy: y + el.offsetHeight / 2 };
   }
   
   /* Ponto na borda do card na direção do alvo (modo 'auto'/legado).
      A seta não crava no centro, mas toca a borda do retângulo. */
   function edgePoint(rect, towardX, towardY) {
     const dx = towardX - rect.cx;
     const dy = towardY - rect.cy;
     if (dx === 0 && dy === 0) return { x: rect.cx, y: rect.cy };
     const hw = rect.w / 2, hh = rect.h / 2;
     // Escala para tocar a borda do retângulo.
     const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
     return { x: rect.cx + dx * scale, y: rect.cy + dy * scale };
   }

   /* Ponto FIXO numa âncora específica (top/right/bottom/left).
      Quando anchor='auto', volta ao comportamento legado de edgePoint. */
   function anchorPoint(rect, anchor, towardX, towardY) {
     switch (anchor) {
       case 'top':    return { x: rect.cx,             y: rect.y };
       case 'bottom': return { x: rect.cx,             y: rect.y + rect.h };
       case 'left':   return { x: rect.x,              y: rect.cy };
       case 'right':  return { x: rect.x + rect.w,     y: rect.cy };
       case 'auto':
       default:       return edgePoint(rect, towardX, towardY);
     }
   }

   /* Direção (vetor unitário) em que a curva DEVE SAIR de uma âncora.
      Curva perpendicular à borda = visual limpo, estilo Miro/draw.io. */
   function anchorDir(anchor) {
     switch (anchor) {
       case 'top':    return { x:  0, y: -1 };
       case 'bottom': return { x:  0, y:  1 };
       case 'left':   return { x: -1, y:  0 };
       case 'right':  return { x:  1, y:  0 };
       default:       return null;  // sem direção preferida
     }
   }

   /* Detecta a âncora mais próxima de (px,py) num retângulo de card. */
   function nearestAnchor(rect, px, py) {
     const candidates = [
       { name: 'top',    x: rect.cx,         y: rect.y },
       { name: 'bottom', x: rect.cx,         y: rect.y + rect.h },
       { name: 'left',   x: rect.x,          y: rect.cy },
       { name: 'right',  x: rect.x + rect.w, y: rect.cy },
     ];
     let best = candidates[0], bestD = Infinity;
     for (const c of candidates) {
       const d = (c.x - px) ** 2 + (c.y - py) ** 2;
       if (d < bestD) { bestD = d; best = c; }
     }
     return best.name;
   }

   /* Gera o atributo "d" do path conforme estilo + âncoras.
      Curva perpendicular: o handle de Bezier sai na direção da âncora,
      proporcional à distância entre os dois pontos. */
   function pathD(a, b, style, fromAnchor, toAnchor, bend) {
     /* Se há uma alça de curvatura (bend), a linha vira uma Bézier
        quadrática que PASSA pelo ponto arrastado. Para o ponto médio
        (t=0.5) coincidir com 'bend', o ponto de controle é
        C = 2·bend − (a+b)/2. Isso vale para qualquer estilo. */
     if (bend) {
       const cx = 2 * bend.x - (a.x + b.x) / 2;
       const cy = 2 * bend.y - (a.y + b.y) / 2;
       return `M ${a.x} ${a.y} Q ${cx} ${cy}, ${b.x} ${b.y}`;
     }
     /* Só 'curved' gera bezier. Todos os outros estilos usam linha reta;
        os marcadores (setas, losangos, triângulos, crow's foot) é que
        distinguem semanticamente cada tipo. */
     if (style !== 'curved') {
       return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
     }
     const dirA = anchorDir(fromAnchor);
     const dirB = anchorDir(toAnchor);
     const dist = Math.hypot(b.x - a.x, b.y - a.y);
     const offset = Math.max(40, Math.min(dist * 0.5, 200));

     // Controles de Bezier: saem perpendicular à âncora; se 'auto', usa
     // o vetor horizontal padrão para preservar o look anterior.
     const c1 = dirA
       ? { x: a.x + dirA.x * offset, y: a.y + dirA.y * offset }
       : { x: a.x + (b.x - a.x) * 0.5, y: a.y };
     const c2 = dirB
       ? { x: b.x + dirB.x * offset, y: b.y + dirB.y * offset }
       : { x: b.x - (b.x - a.x) * 0.5, y: b.y };
     return `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
   }
   
   /* ────────────────────────────────────────────────────────────────────
      Render de UMA conexão
      ──────────────────────────────────────────────────────────────────── */
   
   function renderConnection(conn) {
     const ra = cardRect(conn.from);
     const rb = cardRect(conn.to);
     if (!ra || !rb) return;   // card removido: a conexão fica órfã (limpa depois)

     /* Pontos de origem/destino: se a âncora é explícita (top/right/...),
        usa o ponto fixo daquela borda; senão, calcula edge dinâmica. */
     const a = anchorPoint(ra, conn.fromAnchor, rb.cx, rb.cy);
     const b = anchorPoint(rb, conn.toAnchor,   ra.cx, ra.cy);

     let group = svg.querySelector(`[data-conn-id="${conn.id}"]`);
     if (!group) {
       group = document.createElementNS(SVG_NS, 'g');
       group.setAttribute('data-conn-id', conn.id);
       group.style.pointerEvents = 'auto';  // este grupo é clicável
       svg.appendChild(group);
     }
     group.innerHTML = '';
   
     const isSelected = conn.id === selectedId;
     const baseColor = conn.color || 'var(--conn-color, rgba(26,26,24,0.5))';
     const color = isSelected ? 'var(--accent)' : baseColor;

     const dStr = pathD(a, b, conn.style, conn.fromAnchor, conn.toAnchor, conn.bend);

     /* Linha "fantasma" larga e invisível para facilitar o clique.
        CRÍTICO: pointer-events="stroke" garante que o stroke capture
        eventos mesmo sendo transparente (sem isso, browsers podem
        ignorar cliques pelo default "visiblePainted" + stroke transparente). */
     const hit = document.createElementNS(SVG_NS, 'path');
     hit.setAttribute('d', dStr);
     hit.setAttribute('fill', 'none');
     hit.setAttribute('stroke', 'transparent');
     hit.setAttribute('stroke-width', '20');
     hit.setAttribute('pointer-events', 'stroke');
     hit.style.cursor = 'pointer';
     group.appendChild(hit);

     // Linha visível — também captura cliques (caso usuário clique exato em cima).
     const path = document.createElementNS(SVG_NS, 'path');
     path.setAttribute('d', dStr);
     path.setAttribute('fill', 'none');
     path.setAttribute('stroke', color);
     const baseW = conn.width || 1.8;
     path.setAttribute('stroke-width', isSelected ? (baseW + 0.7) : baseW);
     path.setAttribute('stroke-linecap', 'round');
     path.setAttribute('pointer-events', 'stroke');

     /* Mapa: estilo → { markerEnd, markerStart, dash }. */
     const styleMap = {
       straight:     { end: 'arrow-end',       start: null,           dash: null   },
       curved:       { end: 'arrow-end',       start: null,           dash: null   },
       double:       { end: 'arrow-end',       start: 'arrow-start',  dash: null   },
       /* UML */
       inheritance:  { end: 'uml-inheritance', start: null,           dash: null   },
       realization:  { end: 'uml-realization', start: null,           dash: '6 4'  },
       composition:  { end: 'arrow-end',       start: 'uml-composition', dash: null },
       aggregation:  { end: 'arrow-end',       start: 'uml-aggregation', dash: null },
       dependency:   { end: 'arrow-end',       start: null,           dash: '5 3'  },
       /* BD (crow's foot leve) */
       'db-1-1':     { end: 'db-one',          start: 'db-one',       dash: null   },
       'db-1-n':     { end: 'db-many',         start: 'db-one',       dash: null   },
       'db-n-n':     { end: 'db-many',         start: 'db-many',      dash: null   },
     };
     const sm = styleMap[conn.style] || styleMap.straight;
     if (sm.end)   path.setAttribute('marker-end',   `url(#${sm.end})`);
     if (sm.start) path.setAttribute('marker-start', `url(#${sm.start})`);
     if (sm.dash)  path.setAttribute('stroke-dasharray', sm.dash);
     path.style.cursor = 'pointer';
     group.appendChild(path);

     /* Para o rótulo, calculamos o ponto médio da curva (não interpolação
        linear entre a/b — para curvas, o meio visual fica deslocado).
        Usamos uma aproximação: meio entre os controles e os pontos. */
     let midX, midY;
     if (conn.bend) {
       midX = conn.bend.x;
       midY = conn.bend.y;
     } else if (conn.style === 'curved') {
       const dirA = anchorDir(conn.fromAnchor);
       const dirB = anchorDir(conn.toAnchor);
       const dist = Math.hypot(b.x - a.x, b.y - a.y);
       const off = Math.max(40, Math.min(dist * 0.5, 200));
       const c1x = a.x + (dirA ? dirA.x * off : (b.x - a.x) * 0.5);
       const c1y = a.y + (dirA ? dirA.y * off : 0);
       const c2x = b.x + (dirB ? dirB.x * off : -(b.x - a.x) * 0.5);
       const c2y = b.y + (dirB ? dirB.y * off : 0);
       // t=0.5 numa Bezier cúbica
       midX = 0.125 * a.x + 0.375 * c1x + 0.375 * c2x + 0.125 * b.x;
       midY = 0.125 * a.y + 0.375 * c1y + 0.375 * c2y + 0.125 * b.y;
     } else {
       midX = (a.x + b.x) / 2;
       midY = (a.y + b.y) / 2;
     }

     if (conn.label) {
       const padding = 4;
       const text = document.createElementNS(SVG_NS, 'text');
       text.setAttribute('x', midX);
       text.setAttribute('y', midY);
       text.setAttribute('text-anchor', 'middle');
       text.setAttribute('dominant-baseline', 'middle');
       text.setAttribute('font-size', '13');
       text.setAttribute('font-family', 'var(--font-sans, sans-serif)');
       text.setAttribute('fill', 'var(--ink, #1a1a18)');
       text.textContent = conn.label;
       // Fundo do rótulo (retângulo branco) para legibilidade.
       const bg = document.createElementNS(SVG_NS, 'rect');
       const charW = 7.2;
       const w = conn.label.length * charW + padding * 2;
       bg.setAttribute('x', midX - w / 2);
       bg.setAttribute('y', midY - 11);
       bg.setAttribute('width', w);
       bg.setAttribute('height', 22);
       bg.setAttribute('rx', 5);
       bg.setAttribute('fill', 'var(--bg-elevated, #fff)');
       bg.setAttribute('stroke', color);
       bg.setAttribute('stroke-width', '1');
       group.appendChild(bg);
       group.appendChild(text);
     }
   
     /* Resposta IMEDIATA via pointerdown (não espera pointerup pra acertar
        no mesmo pixel — uma micro-movimentação cancelaria 'click').
        Anexamos em AMBAS as linhas para máxima robustez. */
     const onPick = (e) => {
       e.stopPropagation();
       selectConnection(conn.id, midX, midY);
     };
     hit.addEventListener('pointerdown', onPick);
     path.addEventListener('pointerdown', onPick);

     /* Duplo clique → foca direto o input de rótulo (UX miro-like). */
     const onDbl = (e) => {
       e.stopPropagation();
       selectConnection(conn.id, midX, midY);
       setTimeout(() => menuEl?.querySelector('.conn-menu__label')?.focus(), 0);
     };
     hit.addEventListener('dblclick', onDbl);
     path.addEventListener('dblclick', onDbl);

     /* 🎯 Alças de reancoragem: quando a conexão está selecionada, mostra
        um círculo em cada ponta. Arrastar a ponta sobre outro card (ou
        outra borda do mesmo) re-liga a seta SEM perder a conexão. */
     if (isSelected) {
       const makeEndpoint = (px, py, which) => {
         const c = document.createElementNS(SVG_NS, 'circle');
         c.setAttribute('cx', px);
         c.setAttribute('cy', py);
         c.setAttribute('r', 6);
         c.setAttribute('class', 'conn-endpoint');
         c.addEventListener('pointerdown', (e) => startEndpointDrag(e, conn.id, which));
         group.appendChild(c);
       };
       makeEndpoint(a.x, a.y, 'from');
       makeEndpoint(b.x, b.y, 'to');

       /* 🎯 Alça de curvatura: arraste pra entortar a linha; duplo-clique
          reseta pra reta. Fica no ponto médio (ou onde você a arrastou). */
       const bx = conn.bend ? conn.bend.x : (a.x + b.x) / 2;
       const by = conn.bend ? conn.bend.y : (a.y + b.y) / 2;
       const handle = document.createElementNS(SVG_NS, 'circle');
       handle.setAttribute('cx', bx);
       handle.setAttribute('cy', by);
       handle.setAttribute('r', 5.5);
       handle.setAttribute('class', 'conn-bend');
       handle.addEventListener('pointerdown', (e) => startBendDrag(e, conn.id));
       handle.addEventListener('dblclick', (e) => { e.stopPropagation(); resetBend(conn.id); });
       group.appendChild(handle);
     }
   }

   /* ─── Reancoragem por arraste das pontas ─── */
   let endpointDrag = null;
   function startEndpointDrag(e, connId, which) {
     e.stopPropagation();
     e.preventDefault();
     if (!connections.has(connId)) return;
     endpointDrag = { connId, which };
     document.body.classList.add('is-endpoint-dragging');
     window.addEventListener('pointermove', onEndpointDrag, true);
     window.addEventListener('pointerup', onEndpointUp, true);
   }
   function onEndpointDrag(e) {
     if (!endpointDrag) return;
     const conn = connections.get(endpointDrag.connId);
     if (!conn) return;
     const w = screenToWorld(e.clientX, e.clientY);
     const elUnder = document.elementFromPoint(e.clientX, e.clientY);
     const card = elUnder?.closest('.card');
     document.querySelectorAll('.card.is-drop-target').forEach((c) =>
       c.classList.remove('is-drop-target'));

     const otherId = endpointDrag.which === 'from' ? conn.to : conn.from;
     if (card && card.dataset.cardId && card.dataset.cardId !== otherId) {
       card.classList.add('is-drop-target');
       const rb = cardRect(card.dataset.cardId);
       if (rb) {
         const anchor = nearestAnchor(rb, w.x, w.y);
         if (endpointDrag.which === 'from') { conn.from = card.dataset.cardId; conn.fromAnchor = anchor; }
         else                               { conn.to   = card.dataset.cardId; conn.toAnchor   = anchor; }
       }
     }
     renderConnection(conn);
   }
   function onEndpointUp() {
     window.removeEventListener('pointermove', onEndpointDrag, true);
     window.removeEventListener('pointerup', onEndpointUp, true);
     document.body.classList.remove('is-endpoint-dragging');
     document.querySelectorAll('.card.is-drop-target').forEach((c) =>
       c.classList.remove('is-drop-target'));
     if (endpointDrag) {
       const c = connections.get(endpointDrag.connId);
       if (c) renderConnection(c);
       notifyChange();
     }
     endpointDrag = null;
   }

   /* ─── Curvatura por arraste da alça central ─── */
   let bendDrag = null;
   function startBendDrag(e, connId) {
     e.stopPropagation();
     e.preventDefault();
     if (!connections.has(connId)) return;
     bendDrag = connId;
     document.body.classList.add('is-endpoint-dragging');
     window.addEventListener('pointermove', onBendDrag, true);
     window.addEventListener('pointerup', onBendUp, true);
   }
   function onBendDrag(e) {
     if (!bendDrag) return;
     const conn = connections.get(bendDrag);
     if (!conn) return;
     const w = screenToWorld(e.clientX, e.clientY);
     conn.bend = { x: w.x, y: w.y };
     renderConnection(conn);
   }
   function onBendUp() {
     window.removeEventListener('pointermove', onBendDrag, true);
     window.removeEventListener('pointerup', onBendUp, true);
     document.body.classList.remove('is-endpoint-dragging');
     if (bendDrag) {
       const c = connections.get(bendDrag);
       if (c) renderConnection(c);
       notifyChange();
     }
     bendDrag = null;
   }
   function resetBend(id) {
     const c = connections.get(id);
     if (!c) return;
     c.bend = null;
     renderConnection(c);
     notifyChange();
   }
   
   /* Re-renderiza todas as conexões (chamado em cardmoved / mudanças).
      IMPORTANTE: não deleta conexões cujos cards não estão no DOM. Isso
      é essencial para o restore da persistência — durante o processo,
      pode haver janelas em que a conexão existe mas o card ainda não foi
      inserido. Se apagássemos aqui, o próximo autosave zeraria o JSON.
      A remoção real de órfãs só acontece via pruneOrphans(), disparada
      quando um card é EXPLICITAMENTE removido. */
   function renderAll() {
     // Limpa nodes SVG de conexões que não existem mais no Map (segurança).
     svg.querySelectorAll('[data-conn-id]').forEach((g) => {
       if (!connections.has(g.getAttribute('data-conn-id'))) g.remove();
     });
     connections.forEach((conn) => renderConnection(conn));
   }

   /* Remove do Map (e do SVG) as conexões cujos cards sumiram. Chamado
      quando um card é apagado pelo usuário. */
   function pruneOrphans() {
     let changed = false;
     for (const [id, conn] of connections) {
       if (!cardRect(conn.from) || !cardRect(conn.to)) {
         connections.delete(id);
         svg.querySelector(`[data-conn-id="${id}"]`)?.remove();
         changed = true;
       }
     }
     if (changed) notifyChange();
   }

   /* Detecta remoções de cards no #world e limpa conexões associadas.
      Roda uma vez, no boot do módulo. */
   new MutationObserver((mutations) => {
     let removed = false;
     for (const m of mutations) {
       for (const node of m.removedNodes) {
         if (node.nodeType === 1 && node.dataset && node.dataset.cardId) {
           removed = true;
         }
       }
     }
     if (removed) pruneOrphans();
   }).observe(world, { childList: true });
   
   /* ────────────────────────────────────────────────────────────────────
      Criar / editar / remover conexões
      ──────────────────────────────────────────────────────────────────── */
   
   function addConnection(from, to, style = 'straight', opts = {}) {
     if (from === to) return null;       // não conecta card consigo mesmo
     /* Múltiplas conexões entre os MESMOS cards são permitidas agora:
        cada uma vira uma rota independente com âncoras próprias. */
     const id = 'conn_' + Math.random().toString(36).slice(2, 10);
     const conn = {
       id, from, to, style,
       fromAnchor: opts.fromAnchor || 'auto',
       toAnchor:   opts.toAnchor   || 'auto',
       label: opts.label || '',
     };
     connections.set(id, conn);
     renderConnection(conn);
     notifyChange();
     return id;
   }
   
   function removeConnection(id) {
     connections.delete(id);
     svg.querySelector(`[data-conn-id="${id}"]`)?.remove();
     if (selectedId === id) selectedId = null;
     hideMenu();
     notifyChange();
   }
   
   function setStyle(id, style) {
     const c = connections.get(id);
     if (!c) return;
     c.style = style;
     renderConnection(c);
     notifyChange();
   }
   
   function setLabel(id, label) {
     const c = connections.get(id);
     if (!c) return;
     c.label = label;
     renderConnection(c);
     notifyChange();
   }
   
   function setColor(id, color) {
     const c = connections.get(id);
     if (!c) return;
     c.color = color || null;   // '' / null → volta à cor do tema
     renderConnection(c);
     notifyChange();
   }
   
   function setWidth(id, width) {
     const c = connections.get(id);
     if (!c) return;
     c.width = width ? parseFloat(width) : null;
     renderConnection(c);
     notifyChange();
   }
   
   /* ────────────────────────────────────────────────────────────────────
      Modo conectar
      ──────────────────────────────────────────────────────────────────── */
   
   function setConnectMode(on) {
     connectMode = on;
     pendingFrom = null;
     document.body.classList.toggle('is-connecting', on);
     const btn = document.getElementById('connect-toggle');
     if (btn) btn.classList.toggle('is-active', on);
     clearPendingHighlight();
   }
   
   function clearPendingHighlight() {
     world.querySelectorAll('.card.is-connect-source').forEach((c) =>
       c.classList.remove('is-connect-source'));
   }
   
   /* Captura cliques em cards enquanto em modo conectar. */
   world.addEventListener('click', (e) => {
     if (!connectMode) return;
     const card = e.target.closest('.card');
     if (!card) return;
     e.stopPropagation();
     const id = card.dataset.cardId;
     if (!id) return;
   
     if (!pendingFrom) {
       pendingFrom = id;
       card.classList.add('is-connect-source');
     } else {
       addConnection(pendingFrom, id, 'curved');
       clearPendingHighlight();
       pendingFrom = null;
       // Sai do modo, a menos que Shift esteja pressionado (conexões em série).
       if (!e.shiftKey) setConnectMode(false);
     }
   }, true);
   
   /* ────────────────────────────────────────────────────────────────────
      Mini-menu de conexão selecionada
      ──────────────────────────────────────────────────────────────────── */
   
   let menuEl = null;
   
   function selectConnection(id, worldX, worldY) {
     selectedId = id;
     renderAll();
     showMenu(id);
   }
   
   function showMenu(id) {
     const conn = connections.get(id);
     if (!conn) return;
     hideMenu();
   
     menuEl = document.createElement('div');
     menuEl.className = 'conn-menu';
     menuEl.innerHTML = `
       <div class="conn-menu__group">
         <button class="conn-menu__btn" data-style="straight" title="Reta">╱</button>
         <button class="conn-menu__btn" data-style="curved" title="Curva">⌒</button>
         <button class="conn-menu__btn" data-style="double" title="Seta dupla">⇄</button>
       </div>
       <button class="conn-menu__btn conn-menu__more" title="Mais estilos (UML / BD)">…</button>
       <div class="conn-menu__group conn-menu__uml" hidden>
         <button class="conn-menu__btn" data-style="inheritance" title="UML — Herança">◁</button>
         <button class="conn-menu__btn" data-style="realization" title="UML — Realização">◁┅</button>
         <button class="conn-menu__btn" data-style="composition" title="UML — Composição">◆</button>
         <button class="conn-menu__btn" data-style="aggregation" title="UML — Agregação">◇</button>
         <button class="conn-menu__btn" data-style="dependency" title="UML — Dependência">→┅</button>
       </div>
       <div class="conn-menu__group conn-menu__db" hidden>
         <button class="conn-menu__btn" data-style="db-1-1" title="BD — 1 : 1">1—1</button>
         <button class="conn-menu__btn" data-style="db-1-n" title="BD — 1 : N">1—N</button>
         <button class="conn-menu__btn" data-style="db-n-n" title="BD — N : N">N—N</button>
       </div>
       <div class="conn-menu__group conn-menu__colors">
         <button class="conn-menu__sw conn-menu__sw--default" data-color="" title="Cor do tema"></button>
         <button class="conn-menu__sw" data-color="#e5484d" title="Vermelho" style="background:#e5484d"></button>
         <button class="conn-menu__sw" data-color="#f5a524" title="Âmbar" style="background:#f5a524"></button>
         <button class="conn-menu__sw" data-color="#30a46c" title="Verde" style="background:#30a46c"></button>
         <button class="conn-menu__sw" data-color="#3b82f6" title="Azul" style="background:#3b82f6"></button>
         <button class="conn-menu__sw" data-color="#8b5cf6" title="Roxo" style="background:#8b5cf6"></button>
       </div>
       <div class="conn-menu__group conn-menu__widths">
         <button class="conn-menu__w" data-width="1.4" title="Fina">▁</button>
         <button class="conn-menu__w" data-width="2.6" title="Média">▃</button>
         <button class="conn-menu__w" data-width="4"   title="Grossa">▅</button>
       </div>
       <input class="conn-menu__label" type="text" placeholder="rótulo…" value="${escapeHTML(conn.label || '')}">
       <button class="conn-menu__btn conn-menu__del" title="Apagar conexão">✕</button>
     `;
     document.body.appendChild(menuEl);
   
     // Posiciona o menu perto do meio da seta (converte mundo → tela).
     const ra = cardRect(conn.from), rb = cardRect(conn.to);
     if (ra && rb) {
       const mid = worldToScreen((ra.cx + rb.cx) / 2, (ra.cy + rb.cy) / 2);
       menuEl.style.left = `${mid.x}px`;
       menuEl.style.top  = `${mid.y}px`;
     }
   
     // Marca o estilo ativo.
     menuEl.querySelectorAll('[data-style]').forEach((b) =>
       b.classList.toggle('is-active', b.dataset.style === conn.style));
   
     menuEl.querySelectorAll('[data-style]').forEach((b) =>
       b.addEventListener('click', (e) => {
         e.stopPropagation();
         setStyle(id, b.dataset.style);
         menuEl.querySelectorAll('[data-style]').forEach((x) =>
           x.classList.toggle('is-active', x === b));
       }));
   
     // Cores: marca a ativa e aplica ao clicar.
     const curColor = conn.color || '';
     menuEl.querySelectorAll('.conn-menu__sw').forEach((b) =>
       b.classList.toggle('is-active', (b.dataset.color || '') === curColor));
     menuEl.querySelectorAll('.conn-menu__sw').forEach((b) =>
       b.addEventListener('click', (e) => {
         e.stopPropagation();
         setColor(id, b.dataset.color);
         menuEl.querySelectorAll('.conn-menu__sw').forEach((x) =>
           x.classList.toggle('is-active', x === b));
       }));

     // Espessura: marca a ativa e aplica.
     const curW = String(conn.width || '');
     menuEl.querySelectorAll('.conn-menu__w').forEach((b) =>
       b.classList.toggle('is-active', b.dataset.width === curW));
     menuEl.querySelectorAll('.conn-menu__w').forEach((b) =>
       b.addEventListener('click', (e) => {
         e.stopPropagation();
         setWidth(id, b.dataset.width);
         menuEl.querySelectorAll('.conn-menu__w').forEach((x) =>
           x.classList.toggle('is-active', x === b));
       }));

     const labelInput = menuEl.querySelector('.conn-menu__label');
     labelInput.addEventListener('input', () => setLabel(id, labelInput.value));
     labelInput.addEventListener('click', (e) => e.stopPropagation());
   
     menuEl.querySelector('.conn-menu__del').addEventListener('click', (e) => {
       e.stopPropagation();
       removeConnection(id);
     });

     /* Alterna os grupos UML/BD quando o botão "…" é clicado. Se o estilo
        atual já é UML ou BD, exibe direto. */
     const umlGroup = menuEl.querySelector('.conn-menu__uml');
     const dbGroup  = menuEl.querySelector('.conn-menu__db');
     const moreBtn  = menuEl.querySelector('.conn-menu__more');
     const isUmlStyle = ['inheritance','realization','composition','aggregation','dependency'].includes(conn.style);
     const isDbStyle  = ['db-1-1','db-1-n','db-n-n'].includes(conn.style);
     if (isUmlStyle || isDbStyle) {
       umlGroup.hidden = false; dbGroup.hidden = false;
       moreBtn.classList.add('is-active');
     }
     moreBtn.addEventListener('click', (e) => {
       e.stopPropagation();
       const show = umlGroup.hidden;
       umlGroup.hidden = !show;
       dbGroup.hidden  = !show;
       moreBtn.classList.toggle('is-active', show);
     });

     menuEl.addEventListener('pointerdown', (e) => e.stopPropagation());
   }
   
   function hideMenu() {
     if (menuEl) { menuEl.remove(); menuEl = null; }
   }
   
   /* Fecha menu / desseleciona ao clicar fora. */
   document.addEventListener('pointerdown', (e) => {
     if (menuEl && !menuEl.contains(e.target) && !e.target.closest('[data-conn-id]')) {
       hideMenu();
       if (selectedId) { selectedId = null; renderAll(); }
     }
   });
   
   /* ────────────────────────────────────────────────────────────────────
      Conversão mundo → tela (lê o transform do #world)
      ──────────────────────────────────────────────────────────────────── */
   function worldToScreen(wx, wy) {
     const t = world.style.transform;
     const tr = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(t);
     const sc = /scale\(([-\d.]+)\)/.exec(t);
     const tx = tr ? parseFloat(tr[1]) : 0;
     const ty = tr ? parseFloat(tr[2]) : 0;
     const z  = sc ? parseFloat(sc[1]) : 1;
     return { x: wx * z + tx, y: wy * z + ty };
   }
   
   /* ────────────────────────────────────────────────────────────────────
      Reatividade — re-render quando cards movem / mudam / canvas pan-zoom
      ──────────────────────────────────────────────────────────────────── */
   
   document.addEventListener('cardmoved', () => {
     renderAll();
     if (menuEl && selectedId) {
       // Reposiciona o menu junto com a seta.
       const conn = connections.get(selectedId);
       if (conn) {
         const ra = cardRect(conn.from), rb = cardRect(conn.to);
         if (ra && rb) {
           const mid = worldToScreen((ra.cx + rb.cx) / 2, (ra.cy + rb.cy) / 2);
           menuEl.style.left = `${mid.x}px`;
           menuEl.style.top  = `${mid.y}px`;
         }
       }
     }
   });
   
   // Pan/zoom: o SVG está no world, então as setas acompanham sozinhas.
   // Mas o mini-menu (que está em coords de tela) precisa reposicionar.
   import { onStateChange, screenToWorld } from './canvas.js';
   onStateChange(() => {
     if (menuEl && selectedId) {
       const conn = connections.get(selectedId);
       if (conn) {
         const ra = cardRect(conn.from), rb = cardRect(conn.to);
         if (ra && rb) {
           const mid = worldToScreen((ra.cx + rb.cx) / 2, (ra.cy + rb.cy) / 2);
           menuEl.style.left = `${mid.x}px`;
           menuEl.style.top  = `${mid.y}px`;
         }
       }
     }
   });
   
   // Cards adicionados/removidos: re-render (pega órfãs).
   new MutationObserver(() => renderAll()).observe(world, { childList: true });
   
   /* ────────────────────────────────────────────────────────────────────
      Notificação de mudança → persistência
      ──────────────────────────────────────────────────────────────────── */
   function notifyChange() {
     document.dispatchEvent(new CustomEvent('connectionschanged'));
   }
   
   /* ────────────────────────────────────────────────────────────────────
      Wireup do botão / atalho
      ──────────────────────────────────────────────────────────────────── */
   
   const toggle = document.getElementById('connect-toggle');
   if (toggle) {
     toggle.addEventListener('click', (e) => {
       e.stopPropagation();
       setConnectMode(!connectMode);
     });
   }
   
   document.addEventListener('keydown', (e) => {
     const t = e.target;
     if (t && (t.isContentEditable || /input|textarea|select/i.test(t.tagName))) return;
     if (e.metaKey || e.ctrlKey || e.altKey) return;
     if (e.key.toLowerCase() === 'l') setConnectMode(!connectMode);
     if (e.key === 'Escape') { if (connectMode) setConnectMode(false); hideMenu(); selectedId = null; renderAll(); }
     /* Delete/Backspace numa conexão selecionada → apaga.
        Só age se NENHUM card estiver selecionado (deixar Delete de card
        ter prioridade, gerenciado em cards.js). */
     if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
       const cardSel = document.querySelector('.card.is-selected, .sticker.is-selected');
       if (cardSel) return;  // delegação: cards.js cuida
       e.preventDefault();
       removeConnection(selectedId);
     }
   });
   
   /* ════════════════════════════════════════════════════════════════════
      ARRASTAR DA BORDA PARA CONECTAR (estilo Miro/draw.io)
      ────────────────────────────────────────────────────────────────────
      Ao passar o mouse sobre um card, mostramos 4 âncoras (topo, base,
      esquerda, direita). Arrastar de uma âncora cria uma linha elástica
      que segue o cursor; soltar sobre outro card cria a conexão.
      ════════════════════════════════════════════════════════════════════ */
   
   let anchorHost = null;
   let dragLine = null;
   let dragFrom = null;
   let dragFromAnchor = null;     // âncora de origem (top/right/bottom/left)
   let dragHoverTarget = null;    // card sobre o qual o mouse está
   let dragHoverAnchor = null;    // âncora do alvo mais próxima do mouse

   function showAnchors(card) {
     if (connectMode) return;
     if (anchorHost === card) return;
     hideAnchors();
     anchorHost = card;
     const host = document.createElement('div');
     host.className = 'card-anchors';
     ['top', 'right', 'bottom', 'left'].forEach((pos) => {
       const a = document.createElement('div');
       a.className = `card-anchor card-anchor--${pos}`;
       a.dataset.pos = pos;
       a.addEventListener('pointerdown', (e) => startAnchorDrag(e, card, pos));
       host.appendChild(a);
     });
     card.appendChild(host);
   }
   
   function hideAnchors() {
     if (anchorHost) {
       anchorHost.querySelector('.card-anchors')?.remove();
       anchorHost = null;
     }
   }

   /* Mostra âncoras no card sob o mouse. Sem delay: usa relatedTarget
      para distinguir "saiu pra outra parte do mesmo card" de "saiu pra fora". */
   world.addEventListener('pointerover', (e) => {
     if (connectMode || dragFrom) return;
     const card = e.target.closest('.card');
     if (card && card.dataset.cardId && anchorHost !== card) showAnchors(card);
   });
   world.addEventListener('pointerout', (e) => {
     if (dragFrom) return;
     if (!anchorHost) return;
     const going = e.relatedTarget;
     /* Se o ponteiro foi para uma âncora OU para outro ponto do MESMO card,
        mantém visível. Sem setTimeout → sem delay perceptível. */
     if (going && (anchorHost === going || anchorHost.contains(going))) return;
     hideAnchors();
   });
   
   function startAnchorDrag(e, card, anchorPos) {
     e.stopPropagation();
     e.preventDefault();
     dragFrom = card.dataset.cardId;
     dragFromAnchor = anchorPos;
     dragHoverTarget = null;
     dragHoverAnchor = null;
     dragLine = document.createElementNS(SVG_NS, 'path');
     dragLine.setAttribute('fill', 'none');
     dragLine.setAttribute('stroke', 'var(--accent)');
     dragLine.setAttribute('stroke-width', '2');
     dragLine.setAttribute('stroke-dasharray', '5 4');
     dragLine.setAttribute('marker-end', 'url(#arrow-end)');
     svg.appendChild(dragLine);
     document.body.classList.add('is-anchor-dragging');
     window.addEventListener('pointermove', onAnchorDrag, true);
     window.addEventListener('pointerup', onAnchorUp, true);
   }
   
   function onAnchorDrag(e) {
     if (!dragLine) return;
     const ra = cardRect(dragFrom);
     if (!ra) return;
     const w = screenToWorld(e.clientX, e.clientY);
     /* Ponto de origem: fixo na âncora escolhida. */
     const a = anchorPoint(ra, dragFromAnchor, w.x, w.y);

     /* Detecta card sob o cursor; se for diferente do origem, calcula
        a âncora-alvo mais próxima para que a linha "grude" nela. */
     const elUnder = document.elementFromPoint(e.clientX, e.clientY);
     const target = elUnder?.closest('.card');
     document.querySelectorAll('.card.is-drop-target').forEach((c) =>
       c.classList.remove('is-drop-target'));

     let endX = w.x, endY = w.y;
     dragHoverTarget = null;
     dragHoverAnchor = null;
     if (target && target.dataset.cardId && target.dataset.cardId !== dragFrom) {
       target.classList.add('is-drop-target');
       const rb = cardRect(target.dataset.cardId);
       if (rb) {
         dragHoverTarget = target.dataset.cardId;
         dragHoverAnchor = nearestAnchor(rb, w.x, w.y);
         const snap = anchorPoint(rb, dragHoverAnchor, w.x, w.y);
         endX = snap.x; endY = snap.y;
       }
     }

     /* Curva preview usa as mesmas regras do path final → preview fiel. */
     const dStr = pathD(
       a, { x: endX, y: endY }, 'curved',
       dragFromAnchor,
       dragHoverAnchor || 'auto'
     );
     dragLine.setAttribute('d', dStr);
   }
   
   function onAnchorUp(e) {
     window.removeEventListener('pointermove', onAnchorDrag, true);
     window.removeEventListener('pointerup', onAnchorUp, true);
     document.body.classList.remove('is-anchor-dragging');
     document.querySelectorAll('.card.is-drop-target').forEach((c) =>
       c.classList.remove('is-drop-target'));

     /* Usa o alvo capturado no último pointermove (mais confiável que
        elementFromPoint no pointerup, que pode pegar a dragLine). */
     if (dragHoverTarget) {
       addConnection(dragFrom, dragHoverTarget, 'curved', {
         fromAnchor: dragFromAnchor,
         toAnchor:   dragHoverAnchor,
       });
     }
     if (dragLine) { dragLine.remove(); dragLine = null; }
     dragFrom = null;
     dragFromAnchor = null;
     dragHoverTarget = null;
     dragHoverAnchor = null;
     hideAnchors();
   }
   
   /* ════════════════════════════════════════════════════════════════════
      API pública para persistência (export/import JSON)
      ──────────────────────────────────────────────────────────────────── */
   
   export function getConnections() {
     return [...connections.values()].map((c) => ({ ...c }));
   }
   
   export function loadConnections(arr) {
     if (!Array.isArray(arr)) return;
     arr.forEach((c) => {
       if (c && c.id && c.from && c.to) {
         connections.set(c.id, {
           id: c.id, from: c.from, to: c.to,
           style: c.style || 'straight',
           /* Retrocompat: conexões salvas antes do suporte a âncoras
              herdam 'auto' (comportamento dinâmico original). */
           fromAnchor: c.fromAnchor || 'auto',
           toAnchor:   c.toAnchor   || 'auto',
           label: c.label || '',
           color: c.color || null,
           width: c.width || null,
           bend: (c.bend && typeof c.bend.x === 'number') ? c.bend : null,
         });
       }
     });
     renderAll();
   }
   
   export function clearConnections() {
     connections.clear();
     svg.querySelectorAll('[data-conn-id]').forEach((g) => g.remove());
     selectedId = null;
     hideMenu();
   }
   
   function escapeHTML(s) {
     return String(s).replace(/[&<>"]/g, (c) =>
       ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
   }
   
   /* Render inicial (caso a persistência carregue antes deste módulo). */
   renderAll();