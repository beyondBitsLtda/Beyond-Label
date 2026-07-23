/* ════════════════════════════════════════════════════════════════════
   collab-supabase.js — Transporte do Yjs sobre o Supabase Realtime
   ────────────────────────────────────────────────────────────────────
   O collab.js já mantém um Y.Doc (CRDT) espelhando o canvas. Este módulo
   só troca o "cano" por onde os updates viajam: em vez de WebRTC (com
   servidores públicos instáveis), usamos o Realtime do Supabase — um
   WebSocket gerenciado que você já tem. Sem servidor extra.

   Como funciona:
     • Cada update binário do Y.Doc é enviado (base64) por broadcast.
     • Ao receber, aplica no Y.Doc com origin=this (não reenvia → sem eco).
     • Quem entra manda "sync-request"; quem já está responde com o
       estado COMPLETO (encodeStateAsUpdate) → o novo participante recebe
       tudo o que já existe.
     • O awareness (cursores + nomes) viaja pelo mesmo canal.

   Precisa do Supabase configurado (URL + anon key em supabase.js).
   ════════════════════════════════════════════════════════════════════ */

   import * as Y from 'https://esm.sh/yjs@13.6.18';
   import {
     Awareness,
     encodeAwarenessUpdate,
     applyAwarenessUpdate,
     removeAwarenessStates,
   } from 'https://esm.sh/y-protocols@1.0.6/awareness?deps=yjs@13.6.18';
   
   const toB64 = (u8) => {
     let s = '';
     for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
     return btoa(s);
   };
   const fromB64 = (str) => {
     const bin = atob(str);
     const u8 = new Uint8Array(bin.length);
     for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
     return u8;
   };
   
   export class SupabaseProvider {
     constructor(room, ydoc) {
       this.ydoc = ydoc;
       this.room = room;
       this.awareness = new Awareness(ydoc);
       this.sb = null;
       this.channel = null;
       this.ready = false;
       this.connected = false;          // usado pelo badge do collab.js
       this._listeners = {};            // emitter simples (compat com y-webrtc)
   
       // Doc local → broadcast
       this._onDoc = (update, origin) => {
         if (origin === this) return;            // veio de remoto: não reenvia
         this._send('doc', toB64(update));
       };
       ydoc.on('update', this._onDoc);
   
       // Awareness local → broadcast
       this._onAw = ({ added, updated, removed }) => {
         const changed = added.concat(updated, removed);
         this._send('aw', toB64(encodeAwarenessUpdate(this.awareness, changed)));
       };
       this.awareness.on('update', this._onAw);
   
       // Ao fechar a aba, avisa que saiu (limpa o cursor nos outros).
       this._onUnload = () => {
         try { removeAwarenessStates(this.awareness, [ydoc.clientID], 'unload'); } catch {}
       };
       window.addEventListener('beforeunload', this._onUnload);
   
       this._init();
     }
   
     async _init() {
       // Se o supabase.js ainda não rodou (ordem dos scripts), criamos a
       // promessa aqui — ele reusa a mesma e a resolve quando o cliente
       // estiver pronto. Sem isso, 'await undefined' retorna na hora e o
       // collab acha que o Supabase não está configurado.
       if (!window.__supabaseReady) {
         window.__supabaseReady = new Promise((resolve) => { window.__resolveSupabase = resolve; });
       }
       const sb = await window.__supabaseReady;
       if (!sb) {
         console.warn('[collab] Supabase não configurado — colaboração na nuvem indisponível. '
           + 'Preencha as chaves em supabase.js.');
         return;
       }
       this.sb = sb;
   
       const channel = sb.channel('collab:' + this.room, {
         config: { broadcast: { self: false, ack: false } },
       });
       this.channel = channel;
   
       channel.on('broadcast', { event: 'doc' }, ({ payload }) => {
         try { Y.applyUpdate(this.ydoc, fromB64(payload.data), this); } catch (e) { console.warn('[collab] doc apply', e); }
       });
       channel.on('broadcast', { event: 'aw' }, ({ payload }) => {
         try { applyAwarenessUpdate(this.awareness, fromB64(payload.data), this); } catch (e) { console.warn('[collab] aw apply', e); }
       });
       channel.on('broadcast', { event: 'sync-request' }, () => {
         // Alguém entrou: mando o estado COMPLETO do doc e do awareness.
         this._send('doc', toB64(Y.encodeStateAsUpdate(this.ydoc)));
         const ids = Array.from(this.awareness.getStates().keys());
         if (ids.length) this._send('aw', toB64(encodeAwarenessUpdate(this.awareness, ids)));
       });
   
       channel.subscribe((status) => {
         if (status === 'SUBSCRIBED') {
           this.ready = true;
           this.connected = true;
           this.emit('status', { status: 'connected' });
           console.log('[collab] conectado ao Supabase Realtime — sala', this.room);
           // Peço o estado atual de quem já está e também ofereço o meu.
           this._send('sync-request', '1');
           this._send('doc', toB64(Y.encodeStateAsUpdate(this.ydoc)));
         } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
           this.connected = false;
           this.emit('status', { status: 'disconnected' });
           if (status !== 'CLOSED') {
             console.warn('[collab] Realtime status:', status,
               '— verifique se o Realtime está habilitado no projeto Supabase.');
           }
         }
       });
     }
   
     // ── Emitter mínimo (o collab.js chama provider.on('status', ...)) ──
     on(event, cb) { (this._listeners[event] = this._listeners[event] || new Set()).add(cb); }
     off(event, cb) { this._listeners[event] && this._listeners[event].delete(cb); }
     emit(event, payload) {
       (this._listeners[event] || []).forEach((cb) => { try { cb(payload); } catch (e) {} });
     }
   
     _send(event, data) {
       if (!this.channel || !this.ready) return;
       this.channel.send({ type: 'broadcast', event, payload: { data } });
     }
   
     destroy() {
       try { this.ydoc.off('update', this._onDoc); } catch {}
       try { this.awareness.off('update', this._onAw); } catch {}
       window.removeEventListener('beforeunload', this._onUnload);
       if (this.channel && this.sb) { try { this.sb.removeChannel(this.channel); } catch {} }
     }
   }