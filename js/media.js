/* ════════════════════════════════════════════════════════════════════
   media.js — Cards de mídia: Imagem, YouTube, Áudio, Vídeo
   ────────────────────────────────────────────────────────────────────
   MUDANÇA (fix conexões): todas as 4 factories agora aceitam `cardId`
   e o repassam para createShell. Sem isso, ao restaurar do localStorage
   o card ganhava um id novo aleatório e as conexões viravam órfãs.
   ════════════════════════════════════════════════════════════════════ */

   import { createShell, toast } from './cards.js';
   import { screenToWorld }      from './canvas.js';
   
   const viewport = document.getElementById('viewport');
   
   console.log('[media.js] ✓ loaded — cardId propagation enabled');
   
   /* ════════ 1) IMAGE ════════ */
   export function createImageCard({ src, x, y, width = 320, height, name = 'imagem', cardId }) {
     const card = createShell({ type: 'image', label: 'Imagem', x, y, width, height, cardId });
     const img = document.createElement('img');
     img.className = 'card__image';
     img.src = src;
     img.alt = name;
     img.draggable = false;
     card.appendChild(img);
   
     img.addEventListener('load', () => {
       if (!card.style.height) {
         const handleH = card.querySelector('.card__handle')?.offsetHeight || 32;
         const w = card.offsetWidth || width;
         const ratio = img.naturalHeight / img.naturalWidth || 0.75;
         card.style.height = `${handleH + w * ratio}px`;
       }
       // 🎯 Dispara cardmoved para que connections.js re-renderize as setas
       //    já com o offsetWidth/offsetHeight corretos após load da imagem.
       card.dispatchEvent(new CustomEvent('cardmoved', { bubbles: true }));
     }, { once: true });
   
     return card;
   }
   
   export function pickImage(at) {
     const inp = document.createElement('input');
     inp.type = 'file';
     inp.accept = 'image/*';
     inp.style.display = 'none';
     document.body.appendChild(inp);
     inp.addEventListener('change', () => {
       const file = inp.files?.[0];
       if (file) readImageFile(file, at);
       inp.remove();
     });
     inp.click();
   }
   
   function readImageFile(file, at) {
     const reader = new FileReader();
     reader.onload = () => createImageCard({
       src: reader.result, x: at.x, y: at.y, name: file.name,
     });
     reader.readAsDataURL(file);
   }
   
   viewport.addEventListener('dragover', (e) => {
     if (!hasFiles(e.dataTransfer)) return;
     e.preventDefault();
     viewport.classList.add('is-drop-target');
   });
   viewport.addEventListener('dragleave', (e) => {
     if (e.target === viewport) viewport.classList.remove('is-drop-target');
   });
   viewport.addEventListener('drop', (e) => {
     if (!hasFiles(e.dataTransfer)) return;
     e.preventDefault();
     viewport.classList.remove('is-drop-target');
   
     const at = screenToWorld(e.clientX, e.clientY);
     let offset = 0;
     [...e.dataTransfer.files]
       .filter((f) => f.type.startsWith('image/'))
       .forEach((file) => {
         readImageFile(file, { x: at.x + offset, y: at.y + offset });
         offset += 24;
       });
   });
   
   function hasFiles(dt) {
     return dt && [...(dt.types || [])].includes('Files');
   }
   
   /* ════════ 2) YOUTUBE ════════ */
   export function createYouTubeCard({ x, y, url = '', width, height, cardId }) {
     const initialWidth  = width  || 400;
     const initialHeight = height || 32 + Math.round(initialWidth * 9 / 16);
     const card = createShell({
       type: 'youtube', label: 'YouTube',
       x, y, width: initialWidth, height: initialHeight, cardId,
     });
     const body = document.createElement('div');
     body.className = 'card__yt';
     card.appendChild(body);
   
     render(url);
   
     function render(currentUrl) {
       const id = extractYoutubeId(currentUrl);
       if (id) {
         body.innerHTML = `
           <iframe class="card__yt-iframe"
                   src="https://www.youtube.com/embed/${id}"
                   allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                   allowfullscreen
                   referrerpolicy="strict-origin-when-cross-origin">
           </iframe>
           <div class="card__yt-overlay"></div>
         `;
         return;
       }
       body.innerHTML = `
         <div class="card__yt-empty">
           <div class="card__yt-glyph">▶</div>
           <input class="card__yt-input" type="url" placeholder="cole a URL do YouTube…" value="${currentUrl || ''}">
         </div>
       `;
       const inp = body.querySelector('input');
       inp.focus();
       const tryRender = () => {
         if (extractYoutubeId(inp.value)) render(inp.value);
       };
       inp.addEventListener('input', tryRender);
       inp.addEventListener('paste', () => setTimeout(tryRender, 0));
     }
   
     return card;
   }
   
   function extractYoutubeId(url) {
     if (!url || typeof url !== 'string') return null;
     const patterns = [
       /youtube\.com\/watch\?(?:.*&)?v=([A-Za-z0-9_-]{11})/,
       /youtu\.be\/([A-Za-z0-9_-]{11})/,
       /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
       /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
     ];
     for (const p of patterns) {
       const m = url.match(p);
       if (m) return m[1];
     }
     return null;
   }
   
   document.addEventListener('paste', (e) => {
     const t = e.target;
     if (t && (t.isContentEditable || /input|textarea/i.test(t.tagName))) return;
   
     const items = e.clipboardData?.items;
     if (items) {
       for (const item of items) {
         if (item.type.startsWith('image/')) {
           e.preventDefault();
           const file = item.getAsFile();
           if (!file) return;
           const w = screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
           readImageFile(file, { x: w.x - 160, y: w.y - 110 });
           toast('Imagem colada');
           return;
         }
       }
     }
   
     const text = e.clipboardData?.getData('text/plain') || '';
     if (!extractYoutubeId(text)) return;
     const w = screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
     createYouTubeCard({ x: w.x - 200, y: w.y - 120, url: text });
     toast('YouTube adicionado');
   });
   
   /* ════════ 3) AUDIO ════════ */
   export function createAudioCard({ x, y, cardId }) {
     const card = createShell({ type: 'audio', label: 'Áudio', x, y, width: 320, cardId });
     const body = document.createElement('div');
     body.className = 'card__audio';
     body.innerHTML = `
       <button class="card__audio-rec" title="Gravar (simulado)" aria-label="Gravar">
         <span class="card__audio-dot"></span>
       </button>
       <svg class="card__audio-wave" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true"></svg>
       <span class="card__audio-time">0:00</span>
     `;
     card.appendChild(body);
   
     drawFakeWaveform(body.querySelector('svg'));
   
     const rec  = body.querySelector('.card__audio-rec');
     const time = body.querySelector('.card__audio-time');
     let recording = false, t0 = 0, tick = null;
   
     rec.addEventListener('click', (e) => {
       e.stopPropagation();
       recording = !recording;
       rec.classList.toggle('is-recording', recording);
       if (recording) {
         t0 = Date.now();
         tick = setInterval(() => {
           const s = Math.floor((Date.now() - t0) / 1000);
           time.textContent = `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
         }, 250);
       } else {
         clearInterval(tick);
       }
     });
     return card;
   }
   
   function drawFakeWaveform(svg) {
     const W = 200, H = 40, bars = 56;
     const bw = W / bars;
     let html = '';
     for (let i = 0; i < bars; i++) {
       const a = Math.sin(i * 0.55) * 0.5 + 0.5;
       const b = Math.sin(i * 0.18 + 1.3) * 0.5 + 0.5;
       const v = (a * b + 0.18) * (H - 8);
       const y = (H - v) / 2;
       html += `<rect x="${i*bw + 1}" y="${y}" width="${bw - 2}" height="${v}" rx="0.8" fill="currentColor" opacity="${0.45 + a*0.4}"/>`;
     }
     svg.innerHTML = html;
   }
   
   /* ════════ 4) VIDEO ════════ */
   export function createVideoCard({ x, y, cardId }) {
     const card = createShell({ type: 'video', label: 'Vídeo', x, y, width: 380, cardId });
     const body = document.createElement('div');
     body.className = 'card__video';
     body.innerHTML = `
       <div class="card__video-frame">
         <div class="card__video-noise" aria-hidden="true"></div>
         <button class="card__video-rec" title="Gravar (simulado)" aria-label="Gravar">
           <span class="card__video-dot"></span>
         </button>
         <span class="card__video-label">câmera</span>
         <span class="card__video-time">0:00</span>
       </div>
     `;
     card.appendChild(body);
   
     const rec   = body.querySelector('.card__video-rec');
     const label = body.querySelector('.card__video-label');
     const time  = body.querySelector('.card__video-time');
     let recording = false, t0 = 0, tick = null;
   
     rec.addEventListener('click', (e) => {
       e.stopPropagation();
       recording = !recording;
       rec.classList.toggle('is-recording', recording);
       label.textContent = recording ? 'rec' : 'câmera';
       if (recording) {
         t0 = Date.now();
         tick = setInterval(() => {
           const s = Math.floor((Date.now() - t0) / 1000);
           time.textContent = `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
         }, 250);
       } else {
         clearInterval(tick);
         time.textContent = '0:00';
       }
     });
     return card;
   }