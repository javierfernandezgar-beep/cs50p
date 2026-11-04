'use strict';
/* CS50P en español: app de estudio sin conexión de «CS50's Introduction to Programming with Python» (CC BY-NC-SA 4.0). */

const PROG_STORE = 'cs50p.progreso.v1';
const PROG_PREFIX = 'CS50P1:';
const DAY = 864e5;
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');

const S = { meta: null, cat: null, trans: {}, notes: {}, prog: null, lecList: [], swReg: null, installEvt: null, mm: null };

// ---------- utilidades ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function md(s) {
  return String(s).split('`').map((seg, i) => {
    if (i % 2) return '<code>' + esc(seg) + '</code>';
    return esc(seg).replace(/\*\*([^*]+)\*\*/g, '<mark>$1</mark>').replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
  }).join('');
}
function mdBlock(s) {
  const lines = String(s).split('\n');
  let html = '', ol = false;
  for (const ln of lines) {
    const m = ln.match(/^\d+\.\s+(.*)$/);
    if (m) { if (!ol) { html += '<ol>'; ol = true; } html += '<li>' + md(m[1]) + '</li>'; continue; }
    if (ol) { html += '</ol>'; ol = false; }
    if (ln.trim()) html += '<p>' + md(ln) + '</p>';
  }
  return html + (ol ? '</ol>' : '');
}
const fmtDur = (s) => { const m = Math.round(s / 60); if (m < 60) return `${m} min`; return `${Math.floor(m / 60)} h ${m % 60} min`; };
const fmtTs = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; const p = (n) => String(n).padStart(2, '0'); return h ? `${h}:${p(m)}:${p(x)}` : `${p(m)}:${p(x)}`; };
const b64 = { enc: (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }, dec: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) };
const blockLabel = (l) => `Clase ${l.w}, bloque ${l.n}`;
const today = () => new Date().toISOString().slice(0, 10);
const lec = (id) => S.cat.lectures[id];
const title = (l) => l.title_es || l.title;
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} }, del(k) { try { localStorage.removeItem(k); } catch {} } };
function toast(msg, action, fn) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button type="button">${esc(action)}</button>` : '');
  t.hidden = false;
  if (action) t.querySelector('button').onclick = () => { t.hidden = true; fn(); };
  else setTimeout(() => { t.hidden = true; }, 2600);
}
async function gunzipJson(buf) { const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')); return JSON.parse(await new Response(ds).text()); }
async function gzip(str) { const cs = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip')); return new Uint8Array(await new Response(cs).arrayBuffer()); }

// ---------- datos ----------
async function loadJson(name) {
  const res = await fetch('data/' + name);
  if (!res.ok) throw new Error('No se pudo leer ' + name);
  return res.json();
}
async function transcriptsOf(w) { if (!S.trans[w]) S.trans[w] = await loadJson(S.meta.files['t' + w]); return S.trans[w]; }

// ---------- progreso ----------
function loadProg() {
  let p = null; try { p = JSON.parse(store.get(PROG_STORE)); } catch {}
  p = p || {};
  return { seen: p.seen || {}, cards: p.cards || {}, last: p.last || null, newDay: p.newDay || { date: today(), n: 0 }, newPerDay: p.newPerDay || 20, reviews: p.reviews || {}, practice: p.practice || {} };
}
const saveProg = () => store.set(PROG_STORE, JSON.stringify(S.prog));
function mergeProg(a, b) {
  const out = loadProg(); Object.assign(out, a);
  out.seen = { ...b.seen, ...a.seen };
  for (const [id, t] of Object.entries(b.seen || {})) out.seen[id] = Math.min(t, out.seen[id] || t);
  out.cards = { ...a.cards };
  for (const [id, c] of Object.entries(b.cards || {})) if (!out.cards[id] || (c.u || 0) > (out.cards[id].u || 0)) out.cards[id] = c;
  if (b.last && (!a.last || b.last.t > a.last.t)) out.last = b.last;
  out.reviews = { ...b.reviews };
  out.practice = { ...(b.practice || {}), ...(a.practice || {}) };
  for (const [id, t] of Object.entries(b.practice || {})) out.practice[id] = Math.min(t, out.practice[id] || t);
  for (const [d, n] of Object.entries(a.reviews || {})) out.reviews[d] = Math.max(n, out.reviews[d] || 0);
  return out;
}

// ---------- repetición espaciada ----------
function schedule(st, g) { // g: 0 otra vez, 1 difícil, 2 bien, 3 fácil
  const now = Date.now();
  const s = st ? { ...st } : { r: 0, i: 0, e: 2.5, l: 0 };
  if (g === 0) { s.l++; s.r = 0; s.i = 0; s.e = Math.max(1.3, s.e - 0.2); s.d = now + 10 * 60e3; }
  else {
    let i;
    if (s.r === 0) i = [0, 1, 1, 4][g];
    else if (s.r === 1) i = [0, 2, 3, 6][g];
    else i = g === 1 ? s.i * 1.2 : g === 2 ? s.i * s.e : s.i * s.e * 1.3;
    if (g === 1) s.e = Math.max(1.3, s.e - 0.15);
    if (g === 3) s.e += 0.15;
    s.i = Math.max(1, Math.round(i)); s.r++; s.d = now + s.i * DAY - 3 * 3600e3;
  }
  s.u = now; return s;
}
const fmtIvl = (s) => { const ms = s.d - Date.now(); if (ms < 3600e3) return '10 min'; const d = Math.round(ms / DAY) || 1; if (d < 31) return `${d} d`; const m = d / 30; return `${m < 10 ? m.toFixed(1).replace('.', ',') : Math.round(m)} mes`; };
function allCards(filter) {
  const out = [];
  for (const w of S.cat.weeks) for (const d of w.days) if (!filter || (filter.w === w.n && (!filter.d || filter.d === d.n))) for (const c of d.cards) out.push({ ...c, w: w.n, dn: d.n });
  return out;
}
function dueQueue(filter) {
  const now = Date.now();
  if (S.prog.newDay.date !== today()) S.prog.newDay = { date: today(), n: 0 };
  const cards = allCards(filter);
  const due = cards.filter((c) => S.prog.cards[c.id] && S.prog.cards[c.id].d <= now).sort((a, b) => S.prog.cards[a.id].d - S.prog.cards[b.id].d);
  const fresh = cards.filter((c) => !S.prog.cards[c.id]).slice(0, Math.max(0, S.prog.newPerDay - S.prog.newDay.n));
  return { due, fresh, total: cards.length };
}
function updateBadge() {
  if (!S.cat) return;
  const q = dueQueue();
  const n = q.due.length + q.fresh.length;
  const b = $('#due-badge');
  b.hidden = !n; b.textContent = n > 99 ? '99+' : n;
}

// ---------- navegación ----------
function setBar(text, back) {
  $('#bar-title').textContent = text;
  const bk = $('#back');
  bk.hidden = !back; if (back) bk.href = back;
}
function setTab(tab) { for (const a of document.querySelectorAll('.tabs a')) { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); } }
function route() {
  if (!S.cat) return;
  const h = location.hash.replace(/^#\/?/, '');
  const p = h.split('/');
  window.scrollTo(0, 0);
  document.body.classList.remove('mm');
  closeEditor();
  if (S.mm) { try { S.mm.destroy(); } catch {} S.mm = null; }
  try {
    if (!h) return renderHome();
    if (p[0] === 's' && p[2] === 'd') return renderDay(+p[1], +p[3]);
    if (p[0] === 's') return renderWeek(+p[1]);
    if (p[0] === 'c') return renderLecture(p[1], p[2]);
    if (p[0] === 'mapa') return /^\d+$/.test(p[2] || '') ? renderMap(+p[1], +p[2], p[3] === 'esquema') : renderMap(+p[1], null, p[2] === 'esquema');
    if (p[0] === 'repasar') return renderReview(p[1] ? { w: +p[1], d: p[2] ? +p[2] : null } : null, p[3] === 'practicar');
    if (p[0] === 'progreso') return renderProgress();
    if (p[0] === 'practicar') return p[1] === 'libre' ? renderFree() : p[1] ? renderExercise(p[1]) : renderPracticeHome();
    if (p[0] === 'licencia') return renderLicense();
    if (p[0] === 'cortos') return renderShorts();
    renderHome();
  } finally { updateBadge(); view.focus({ preventScroll: true }); }
}
window.addEventListener('hashchange', route);

const weekOf = (n) => S.cat.weeks.find((w) => w.n === n);
const dayOf = (w, d) => weekOf(w)?.days.find((x) => x.n === d);
const dayProgress = (d) => { const seen = d.lectures.filter((id) => S.prog.seen[id]).length; return { seen, total: d.lectures.length, pct: d.lectures.length ? seen / d.lectures.length : 0 }; };
const dayReady = (d) => d.lectures.some((id) => lec(id).summary);
const dayDur = (d) => d.lectures.reduce((a, id) => a + lec(id).dur, 0);

// ---------- pantallas ----------
function renderHome() {
  setBar('CS50P en español'); setTab('curso');
  const total = S.lecList.length, seen = S.lecList.filter((id) => S.prog.seen[id]).length;
  const l = S.prog.last && lec(S.prog.last.id) ? lec(S.prog.last.id) : lec(S.lecList[0]);
  const resume = `<a class="resume" href="#/c/${l.id}"><span class="muted small">${S.prog.last ? 'Continúa donde lo dejaste' : 'Empieza por aquí'}: ${blockLabel(l)}</span><b>${esc(title(l))}</b></a>`;
  let grid = '';
  for (const w of S.cat.weeks) {
    grid += `<a class="wk" href="#/s/${w.n}"><b>Clase ${w.n}</b><span>${esc(w.title_es)}</span></a>`;
    for (let i = 1; i <= 5; i++) {
      const d = w.days.find((x) => x.n === i);
      if (!d) { grid += '<span></span>'; continue; }
      const pr = dayProgress(d);
      grid += `<a class="cell${dayReady(d) ? ' ready' : ''}${pr.pct === 1 ? ' done' : ''}" style="--p:${Math.round(pr.pct * 100)}%" href="#/s/${w.n}/d/${d.n}" aria-label="Clase ${w.n}, bloque ${d.n}${pr.pct === 1 ? ', visto' : ''}"><span>${w.ready ? 'B' + d.n : 'Todo'}</span></a>`;
    }
  }
  const q = dueQueue();
  const nDue = q.due.length + q.fresh.length;
  view.innerHTML = `
    ${resume}
    <h1>Mapa del curso</h1>
    <p class="lead">Cada fila es una clase de David y cada casilla, un bloque de la clase. Se rellena a medida que los ves.</p>
    <div class="grid">${grid}</div>
    <p class="legend"><span><i class="r"></i>Con apuntes, mapa y tarjetas</span><span><i></i>Solo transcripción</span><span><i class="f"></i>Visto</span></p>
    <h2>Hoy</h2>
    <div class="stat"><span>Tarjetas para repasar</span><b>${nDue}</b></div>
    <div class="stat"><span>Bloques vistos</span><b>${seen} de ${total}</b></div>
    <div class="row"><a class="btn primary" href="#/repasar">${nDue ? 'Repasar tarjetas' : 'Ver tarjetas'}</a><a class="btn" href="#/cortos">Vídeos cortos</a></div>
    <p class="small muted foot">Adaptación al español de CS50P (Harvard University, David J. Malan), CC BY-NC-SA 4.0. <a href="#/licencia">Licencia y créditos</a></p>`;
}

function renderWeek(n) {
  const w = weekOf(n); if (!w) return renderHome();
  setBar(`Clase ${n}`, '#/'); setTab('curso');
  const items = w.days.map((d) => {
    const l = lec(d.lectures[0]), on = !!S.prog.seen[l.id];
    return `<li><a class="item" href="#/c/${l.id}"><span class="num">${w.ready ? d.n : '▶'}</span><span class="t">${esc(d.title_es)}</span>
      <span class="chk${on ? ' on' : ''}" aria-label="${on ? 'Visto' : 'Sin ver'}">${on ? '✓' : ''}</span>
      <span class="sub">${fmtTs(l.start)} a ${fmtTs(l.start + l.dur)}, ${fmtDur(l.dur)}${l.notes ? `, ${readMin(l)} min de apuntes` : '. Solo transcripción'}</span></a></li>`;
  }).join('');
  const probs = (S.cat.practice || []).filter((e) => e.w === n && e.official);
  const own = (S.cat.practice || []).filter((e) => e.w === n && !e.official);
  const shorts = S.cat.shorts.filter((s) => s.w === n);
  const concepts = S.cat.concepts.filter((c) => c.w === n).sort((a, b) => a.t.localeCompare(b.t, 'es'));
  view.innerHTML = `
    <p class="kicker">Clase ${n} · ${fmtDur(w.dur)} de vídeo</p><h1>${esc(w.title_es)}</h1>
    <p class="muted small" lang="en">${esc(w.title)}. ${esc(w.topics)}</p>
    ${w.intro ? `<p>${md(w.intro)}</p>` : '<p class="pending">Los apuntes, el resumen, los mapas y las tarjetas de esta clase están en preparación. Ya puedes leer la transcripción.</p>'}
    <div class="row"><a class="btn" href="https://youtu.be/${esc(w.yt)}" target="_blank" rel="noopener">Ver la clase en YouTube</a></div>
    <h2>${w.ready ? 'Bloques de la clase' : 'Transcripción'}</h2>
    <ol class="list">${items}</ol>
    ${probs.length || own.length ? `<h2>Practica</h2>
      ${own.length ? `<p>${own.length} ejercicios cortos con solución, para calentar, y los ${probs.length} problemas oficiales del Problem Set ${n}.</p>` : ''}
      <ul class="list">${[...own, ...probs].map(exItem).join('')}</ul>` : ''}
    ${shorts.length ? `<h2>Vídeos cortos</h2><p class="small muted">Vídeos de repaso de CS50, en inglés. Necesitan conexión.</p><ul class="shorts">${shorts.map(shortItem).join('')}</ul>` : ''}
    <h2>Mapa conceptual de la clase</h2>
    ${w.mindmap ? `<p>Todos los conceptos de la clase organizados por temas, y cómo se relacionan entre sí.</p>
      <div class="row"><a class="btn primary" href="#/mapa/${n}">Ver mapa conceptual</a><a class="btn" href="#/mapa/${n}/esquema">Ver como esquema</a></div>
      ${w.relations.length ? `<h3>Conexiones clave</h3><ul class="rels">${w.relations.map((r) => `<li><b>${md(r.a)}</b> <span class="rel">${esc(r.r)}</span> ${md(r.b)}${r.l ? ` <a href="#/c/${r.l}">bloque ${lec(r.l).n}</a>` : ''}</li>`).join('')}</ul>` : ''}`
      : '<p class="pending">Llegará con los apuntes de la clase.</p>'}
    <h2>Glosario</h2>
    ${concepts.length ? `<input type="search" id="gq" placeholder="Buscar un concepto" aria-label="Buscar en el glosario">
    <dl class="concepts" id="gl">${concepts.map((c) => `<div data-k="${esc((c.t + ' ' + c.d).toLowerCase())}"><dt>${esc(c.t)}</dt><dd>${md(c.d)} <a href="#/c/${c.id}">Bloque ${lec(c.id).n}</a></dd></div>`).join('')}</dl>`
      : '<p class="pending">Aparecerá con los resúmenes de esta clase.</p>'}`;
  const gq = $('#gq');
  if (gq) gq.oninput = () => { const v = gq.value.trim().toLowerCase(); for (const el of $('#gl').children) el.hidden = v && !el.dataset.k.includes(v); };
}
const shortItem = (s) => `<li><a href="${esc(s.u)}" target="_blank" rel="noopener" lang="en">${esc(s.t)}</a></li>`;

function renderShorts() {
  setBar('Vídeos cortos', '#/'); setTab('curso');
  view.innerHTML = `<h1>Vídeos cortos</h1>
    <p class="lead">Repasos breves de CS50 sobre un solo tema, en inglés. Se abren en la web del curso y necesitan conexión.</p>
    ${S.cat.weeks.map((w) => { const l = S.cat.shorts.filter((s) => s.w === w.n); return l.length ? `<h2>Clase ${w.n}: ${esc(w.title_es)}</h2><ul class="shorts">${l.map(shortItem).join('')}</ul>` : ''; }).join('')}`;
}

function renderLicense() {
  setBar('Licencia y créditos', '#/progreso'); setTab('progreso');
  view.innerHTML = `<h1>Licencia y créditos</h1>
    <p>Esta app es una <b>adaptación al español</b> de <a href="https://cs50.harvard.edu/python/" target="_blank" rel="noopener">CS50's Introduction to Programming with Python</a> (CS50P, edición 2022), de <b>Harvard University</b>, impartido por <b>David J. Malan</b>.</p>
    <p>El material original de CS50 tiene licencia <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.es" target="_blank" rel="noopener">Creative Commons Reconocimiento-NoComercial-CompartirIgual 4.0 Internacional (CC BY-NC-SA 4.0)</a>. Esta adaptación se comparte con la misma licencia.</p>
    <h2>Cambios respecto al original</h2>
    <ul>
      <li>Apuntes, resúmenes, mapas, tarjetas y glosario redactados en español a partir de los apuntes oficiales y de la transcripción de cada clase.</li>
      <li>Cada clase se ha partido en bloques por tema.</li>
      <li>Enunciados de los problemas traducidos, con pistas propias y una comprobación automática hecha para esta app, que imita a <code>check50</code> pero no es la oficial.</li>
      <li>Ejercicios cortos propios, con solución, que no forman parte del curso original.</li>
      <li>Las transcripciones se muestran tal cual, en inglés, a partir de los subtítulos oficiales.</li>
    </ul>
    <h2>Sin ánimo de lucro</h2>
    <p>Es un proyecto personal de estudio, gratuito y sin ánimo de lucro. No está hecho ni respaldado por Harvard ni por CS50.</p>
    <h2>Honestidad académica</h2>
    <p>Si quieres el certificado de CS50, las soluciones de los problemas oficiales tienen que ser tuyas. Por eso esta app no las incluye. Entrégalas con <code>submit50</code> desde <a href="https://cs50.dev/" target="_blank" rel="noopener">cs50.dev</a>. Consulta las <a href="https://cs50.harvard.edu/python/honesty/" target="_blank" rel="noopener">normas del curso</a>.</p>
    <h2>Software</h2>
    <p class="small">Python en el navegador con Pyodide (MPL 2.0). Editor CodeMirror (MIT). Mapas con markmap (MIT) y d3 (ISC). Letra Atkinson Hyperlegible (OFL). Librerías de Python: ${esc((S.meta.libs || []).join(', '))}.</p>`;
}

function renderDay(wn, dn) { const d = dayOf(wn, dn); if (!d) return renderWeek(wn); return renderLecture(d.lectures[0]); }

const readMin = (l) => Math.max(1, Math.round((l.notes || 0) / 200));
async function notesOf(w) { if (!S.notes[w]) S.notes[w] = await loadJson(S.meta.files['a' + w]); return S.notes[w]; }

function renderLecture(id, tab) {
  const l = lec(id); if (!l) return renderHome();
  const w = weekOf(l.w), d = dayOf(l.w, l.d);
  const idx = S.lecList.indexOf(id);
  const prev = lec(S.lecList[idx - 1]), next = lec(S.lecList[idx + 1]);
  setBar(w.ready ? `Clase ${l.w} · bloque ${l.n}` : `Clase ${l.w}`, `#/s/${l.w}`); setTab('curso');
  S.prog.last = { id, t: Date.now() }; saveProg();
  const tabs = [];
  if (l.notes) tabs.push(['apuntes', 'Apuntes']);
  if (l.summary) tabs.push(['resumen', 'Resumen']);
  tabs.push(['transcripcion', 'Transcripción']);
  if (!tabs.some((t) => t[0] === tab)) tab = tabs[0][0];
  const seenBtn = () => { const on = !!S.prog.seen[id]; return `<button class="btn" data-seen type="button" aria-pressed="${on}">${on ? 'Visto ✓' : 'Marcar como visto'}</button>`; };
  const pl = (S.cat.practice || []).filter((e) => e.w === l.w && e.d === l.d);
  view.innerHTML = `
    <p class="kicker"><a href="#/s/${l.w}">Clase ${l.w}: ${esc(w.title_es)}</a>${w.ready ? ` · bloque ${l.n} de ${w.days.length}` : ''} · ${fmtTs(l.start)} a ${fmtTs(l.start + l.dur)}</p>
    <h1>${esc(title(l))}</h1>
    ${d.intro ? `<p>${md(d.intro)}</p>` : ''}
    <div class="row">${seenBtn()}<a class="btn" href="${esc(l.url)}" target="_blank" rel="noopener">Ver en YouTube (${fmtDur(l.dur)})</a></div>
    ${d.mindmap || d.cards.length ? `<div class="row">
      ${d.mindmap ? `<a class="btn primary" href="#/mapa/${l.w}/${l.d}">Ver mapa mental</a>` : ''}
      ${d.cards.length ? `<a class="btn" href="#/repasar/${l.w}/${l.d}">Repasar ${d.cards.length} tarjetas</a>` : ''}</div>` : ''}
    ${tabs.length === 1 ? '<p class="pending">Los apuntes y el resumen de esta clase llegarán más adelante. Mientras, aquí tienes la transcripción.</p>' : ''}
    <div class="seg" role="tablist" id="seg">${tabs.map(([k, t]) => `<button role="tab" type="button" data-k="${k}" aria-selected="${k === tab}">${t}</button>`).join('')}</div>
    <section id="panel" role="tabpanel"></section>
    ${pl.length ? `<h2>Practica este bloque</h2><ul class="list">${pl.map(exItem).join('')}</ul>` : ''}
    <div class="row end" id="finish"></div>
    <nav class="pager">${prev ? `<a href="#/c/${prev.id}"><small>Anterior</small>${esc(title(prev))}</a>` : ''}${next ? `<a class="next" href="#/c/${next.id}"><small>Siguiente</small>${esc(title(next))}</a>` : ''}</nav>`;

  const paintFinish = () => {
    const box = $('#finish'); if (!box) return;
    box.innerHTML = !S.prog.seen[id] && next ? `<button class="btn primary" id="done-next" type="button">Marcar como visto y seguir</button>` : '';
    const b = $('#done-next'); if (b) b.onclick = () => { S.prog.seen[id] = Date.now(); saveProg(); location.hash = `#/c/${next.id}`; };
  };
  const toggleSeen = () => {
    if (S.prog.seen[id]) delete S.prog.seen[id]; else S.prog.seen[id] = Date.now();
    saveProg();
    for (const b of view.querySelectorAll('[data-seen]')) { const on = !!S.prog.seen[id]; b.setAttribute('aria-pressed', on); b.textContent = on ? 'Visto ✓' : 'Marcar como visto'; }
    paintFinish();
  };
  view.querySelector('[data-seen]').onclick = toggleSeen;
  paintFinish();

  const show = async (k) => {
    for (const b of view.querySelectorAll('#seg button')) b.setAttribute('aria-selected', b.dataset.k === k);
    history.replaceState(null, '', `#/c/${id}/${k}`);
    const panel = $('#panel'); panel.dataset.k = k;
    if (k === 'resumen') {
      panel.innerHTML = `<ul class="summary">${l.summary.map((s) => `<li>${md(s)}</li>`).join('')}</ul>
        ${l.concepts.length ? `<h2>Conceptos clave</h2><dl class="concepts">${l.concepts.map((c) => `<dt>${esc(c.t)}</dt><dd>${md(c.d)}</dd>`).join('')}</dl>` : ''}`;
      return;
    }
    panel.innerHTML = '<p class="muted">Cargando…</p>';
    try {
      if (k === 'apuntes') {
        const html = (await notesOf(l.w))[id];
        if (panel.dataset.k !== k) return;
        panel.innerHTML = `<p class="muted small">Lectura de unos ${readMin(l)} minutos.</p><article class="notes">${html}</article>`;
      } else {
        const t = (await transcriptsOf(l.w))[id];
        if (panel.dataset.k !== k) return;
        const yt = 'https://youtu.be/' + weekOf(l.w).yt + '?t=';
        panel.innerHTML = '<p class="muted small">Transcripción original en inglés (subtítulos oficiales de CS50). Cada minuto abre el vídeo de YouTube en ese segundo.</p>'
          + t.map(([s, txt]) => `<p class="tp" lang="en"><a class="ts" href="${yt}${s}" target="_blank" rel="noopener" title="Abrir el vídeo en este punto">${fmtTs(s)}</a>${esc(txt)}</p>`).join('');
      }
    } catch (err) { panel.innerHTML = `<p class="error">No se pudo abrir este contenido. ${esc(err.message)}</p>`; }
  };
  $('#seg').onclick = (e) => {
    const b = e.target.closest('button'); if (!b || b.getAttribute('aria-selected') === 'true') return;
    show(b.dataset.k);
    const top = $('#seg').getBoundingClientRect().top;
    if (top < 0) window.scrollBy(0, top - 70);
  };
  show(tab);
}

function renderMap(wn, dn, outline) {
  const d = dn ? dayOf(wn, dn) : weekOf(wn);
  if (!d || !d.mindmap) return dn ? renderDay(wn, dn) : renderWeek(wn);
  const base = dn ? `#/mapa/${wn}/${dn}` : `#/mapa/${wn}`;
  setBar(dn ? `Mapa: clase ${wn}, bloque ${dn}` : `Mapa conceptual: clase ${wn}`, dn ? `#/c/c${wn}b${dn}` : `#/s/${wn}`); setTab('curso');
  if (outline) {
    const node = (n, depth) => {
      const kids = n.children || [];
      if (!kids.length) return `<li class="leaf">${n.content}</li>`;
      return `<li><details${depth < 1 ? ' open' : ''}><summary>${n.content}</summary><ul>${kids.map((k) => node(k, depth + 1)).join('')}</ul></details></li>`;
    };
    view.innerHTML = `<h1>${d.mindmap.content}</h1><div class="row"><a class="btn small" href="${base}">Ver como mapa</a></div>
      <div class="outline"><ul>${d.mindmap.children.map((k) => node(k, 0)).join('')}</ul></div>`;
    return;
  }
  document.body.classList.add('mm');
  view.innerHTML = `<div class="mm-wrap"><p class="mm-hint">Toca un círculo para desplegar o plegar una rama. Pellizca para hacer zoom.</p><svg class="markmap" id="mm"></svg>
    <div class="mm-tools"><button class="btn small" id="fit" type="button">Encajar</button><a class="btn small" href="${base}/esquema">Ver como esquema</a></div></div>`;
  if (!window.markmap || !window.d3) { view.innerHTML = '<p class="error">No se pudo cargar el visor de mapas.</p>'; return; }
  const colors = ['#2346B8', '#B5402B', '#2E7550', '#8A5A00', '#6B3FA0', '#00798C'];
  const wide = window.innerWidth >= 720;
  const opts = { autoFit: true, duration: 250, maxWidth: wide ? 300 : 220, initialExpandLevel: wide ? 3 : 2, spacingVertical: 8, spacingHorizontal: wide ? 80 : 56, paddingX: 10,
    color: (n) => colors[(Number(n.state?.path?.split('.')[1]) || 0) % colors.length] };
  requestAnimationFrame(() => {
    if (!$('#mm')) return;
    S.mm = window.markmap.Markmap.create('#mm', opts, structuredClone(d.mindmap));
    $('#fit').onclick = () => S.mm && S.mm.fit();
  });
}

function renderReview(filter, cram) {
  setBar(filter ? `Tarjetas: clase ${filter.w}${filter.d ? ', bloque ' + filter.d : ''}` : 'Repasar', filter ? (filter.d ? `#/c/c${filter.w}b${filter.d}` : `#/s/${filter.w}`) : null); setTab('repasar');
  const base = filter ? `#/repasar/${filter.w}/${filter.d || ''}` : '#/repasar';
  const q = dueQueue(filter);
  let queue = cram ? allCards(filter) : [...q.due, ...q.fresh];
  let done = 0;
  if (!q.total) { view.innerHTML = `<h1>Repasar</h1><p class="pending">Todavía no hay tarjetas${filter ? ' en esta parte del curso' : ''}. Aparecen con los resúmenes de cada bloque.</p>`; return; }
  const next = () => {
    if (!queue.length) {
      const scope = filter && filter.d ? `${filter.w}/${filter.d}` : filter ? `${filter.w}/` : null;
      view.innerHTML = `<h1>${done ? 'Repaso terminado' : 'Nada pendiente'}</h1>
        <p>${done ? `Has repasado ${done} tarjeta${done === 1 ? '' : 's'}.` : 'No hay tarjetas que toque repasar ahora.'} Las próximas aparecerán cuando les llegue el turno.</p>
        <div class="row">${scope ? `<a class="btn" href="#/repasar/${scope}/practicar">Practicar todas igualmente</a>` : ''}<a class="btn" href="#/">Volver al curso</a></div>
        ${!filter ? dayLinks() : ''}`;
      updateBadge(); return;
    }
    const c = queue[0], st = S.prog.cards[c.id];
    const l = lec(c.l);
    view.innerHTML = `
      <div class="deck-meta"><span>${cram ? 'Práctica libre, sin programar' : st ? 'Repaso' : 'Nueva'}</span><span>Quedan ${queue.length}</span></div>
      <article class="card"><p class="q">${md(c.q)}</p><div class="a" id="ans" hidden>${md(c.a)}</div>
        <p class="src">${l ? `<a href="#/c/${l.id}">${blockLabel(l)}</a>` : ''}</p></article>
      <button class="btn primary reveal" id="show" type="button">Mostrar respuesta</button>
      <div class="grades" id="grades" hidden>${['Otra vez', 'Difícil', 'Bien', 'Fácil'].map((t, g) => `<button class="g${g}" data-g="${g}" type="button">${t}${cram ? '' : `<small>${fmtIvl(schedule(st, g))}</small>`}</button>`).join('')}</div>`;
    $('#show').onclick = () => { $('#ans').hidden = false; $('#show').hidden = true; $('#grades').hidden = false; $('#grades button[data-g="2"]').focus(); };
    $('#grades').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const g = +b.dataset.g;
      queue.shift(); done++;
      if (cram) { if (g === 0) queue.push(c); return next(); }
      if (!st) S.prog.newDay.n++;
      S.prog.cards[c.id] = schedule(st, g);
      S.prog.reviews[today()] = (S.prog.reviews[today()] || 0) + 1;
      if (g === 0) queue.push(c);
      saveProg(); updateBadge(); next();
    };
  };
  if (!filter && !queue.length && !cram) { next(); return; }
  next();
  void base;
}
function dayLinks() {
  const rows = [];
  for (const w of S.cat.weeks) for (const d of w.days) if (d.cards.length) rows.push(`<li><a class="item nonum" href="#/repasar/${w.n}/${d.n}"><span class="t">Clase ${w.n}, bloque ${d.n}: ${esc(d.title_es)}</span><span class="muted small">${d.cards.length}</span></a></li>`);
  return rows.length ? `<h2>Repasar un bloque concreto</h2><ul class="list">${rows.join('')}</ul>` : '';
}

function renderProgress() {
  setBar('Progreso'); setTab('progreso');
  const total = S.lecList.length, seen = S.lecList.filter((id) => S.prog.seen[id]).length;
  const cards = allCards(), learned = cards.filter((c) => S.prog.cards[c.id]?.r > 0).length;
  const secs = S.lecList.filter((id) => S.prog.seen[id]).reduce((a, id) => a + lec(id).dur, 0);
  view.innerHTML = `
    <h1>Tu progreso</h1>
    <div class="stat"><span>Bloques vistos</span><b>${seen} de ${total}</b></div>
    <div class="stat"><span>Vídeo cubierto</span><b>${fmtDur(secs)}</b></div>
    <div class="stat"><span>Tarjetas aprendidas</span><b>${learned} de ${cards.length}</b></div>
    <div class="stat"><span>Repasos hoy</span><b>${S.prog.reviews[today()] || 0}</b></div>
    ${S.cat.practice ? `<div class="stat"><span>Prácticas de Python resueltas</span><b>${S.cat.practice.filter((e) => S.prog.practice[e.id]).length} de ${S.cat.practice.length}</b></div>` : ''}

    <h2>Pasar el progreso a otro dispositivo</h2>
    <p>El progreso se guarda en este dispositivo. Para llevarlo al otro, comparte el código y pégalo allí. Se combina con lo que ya tenga, sin borrar nada.</p>
    <div class="row"><button class="btn primary" id="share" type="button">Compartir progreso</button><button class="btn" id="copy" type="button">Copiar código</button></div>
    <label class="field"><span>Pegar un código de progreso</span><textarea id="imp" placeholder="CS50P1:…" spellcheck="false"></textarea></label>
    <div class="row"><button class="btn" id="doimp" type="button">Importar progreso</button></div>
    <p id="impmsg" role="status"></p>

    <h2>Ajustes</h2>
    <label class="field"><span>Tarjetas nuevas por día</span><input type="number" id="npd" min="1" max="100" value="${S.prog.newPerDay}"></label>
    <div class="row">${S.installEvt ? '<button class="btn primary" id="install" type="button">Instalar la app</button>' : ''}<button class="btn" id="upd" type="button">Buscar actualizaciones</button><a class="btn" href="#/licencia">Licencia y créditos</a></div>
    <p class="muted small">Versión ${esc(S.meta.version)}, contenido generado el ${new Date(S.cat.builtAt).toLocaleDateString('es-ES')}.</p>`;
  const code = async () => PROG_PREFIX + b64.enc(await gzip(JSON.stringify(S.prog)));
  $('#share').onclick = async () => {
    const c = await code();
    if (navigator.share) { try { await navigator.share({ title: 'Progreso de CS50P', text: c }); } catch {} }
    else { await navigator.clipboard.writeText(c); toast('Código copiado'); }
  };
  $('#copy').onclick = async () => { try { await navigator.clipboard.writeText(await code()); toast('Código copiado'); } catch { $('#imp').value = await code(); toast('Copia el código del cuadro'); } };
  $('#doimp').onclick = async () => {
    const v = $('#imp').value.trim(), msg = $('#impmsg');
    try {
      if (!v.startsWith(PROG_PREFIX)) throw new Error('El código debe empezar por ' + PROG_PREFIX);
      const other = await gunzipJson(b64.dec(v.slice(PROG_PREFIX.length)));
      const before = Object.keys(S.prog.seen).length;
      S.prog = mergeProg(S.prog, other); saveProg();
      msg.className = ''; const n = Object.keys(S.prog.seen).length - before; msg.textContent = `Progreso importado: ${n} ${n === 1 ? 'bloque visto nuevo' : 'bloques vistos nuevos'} y tarjetas actualizadas.`;
      $('#imp').value = ''; updateBadge();
    } catch (err) { msg.className = 'error'; msg.textContent = 'No se pudo importar. ' + (err.message.includes(PROG_PREFIX) ? err.message : 'Comprueba que has pegado el código completo.'); }
  };
  $('#npd').onchange = (e) => { S.prog.newPerDay = Math.min(100, Math.max(1, +e.target.value || 20)); saveProg(); updateBadge(); };
  $('#upd').onclick = async () => {
    if (!S.swReg) return toast('Las actualizaciones necesitan la app instalada desde la web');
    try { await S.swReg.update(); if (!S.swReg.waiting && !S.swReg.installing) toast('Ya tienes la última versión'); } catch { toast('Sin conexión: inténtalo más tarde'); }
  };
  const ins = $('#install');
  if (ins) ins.onclick = async () => { S.installEvt.prompt(); await S.installEvt.userChoice; S.installEvt = null; renderProgress(); };
}

// ---------- prácticas de Python (Pyodide en un Web Worker) ----------
const CODE_STORE = 'cs50p.codigo.v1';
const INPUT_STORE = 'cs50p.entradas.v1';
const RUN_LIMIT_MS = 20000;
let practiceData = null;
let editor = null;

async function loadPractice() { if (!practiceData) practiceData = await loadJson(S.meta.files.practice); return practiceData; }
const exById = (id) => S.cat.practice.find((e) => e.id === id);
const drafts = { all() { try { return JSON.parse(store.get(CODE_STORE)) || {}; } catch { return {}; } },
  get(id) { return this.all()[id]; }, set(id, code) { const a = this.all(); a[id] = code; store.set(CODE_STORE, JSON.stringify(a)); },
  del(id) { const a = this.all(); delete a[id]; store.set(CODE_STORE, JSON.stringify(a)); } };
const levelDots = (n) => `<span class="lvl" aria-label="Nivel ${n} de 3">${'●'.repeat(n)}${'○'.repeat(3 - n)}</span>`;
const fmtMB = (b) => (b / 1e6).toFixed(1).replace('.', ',') + ' MB';

function closeEditor() { if (editor) { try { editor.destroy(); } catch {} editor = null; } }

let editorScript = null;
function loadEditor() {
  if (window.CodeEditor) return Promise.resolve();
  if (!editorScript) editorScript = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/editor.js'; s.onload = res; s.onerror = () => { editorScript = null; rej(new Error('No se pudo cargar el editor')); }; document.head.appendChild(s); });
  return editorScript;
}

// Estado de la descarga de Python para usar sin conexión (caché aparte del service worker).
async function pyCacheStatus() {
  if (!('caches' in window) || !S.meta.pyCache) return { ok: false, have: 0, total: (S.meta.pyAssets || []).length, unsupported: true };
  const c = await caches.open(S.meta.pyCache);
  let have = 0;
  for (const a of S.meta.pyAssets) if (await c.match(a)) have++;
  return { ok: have === S.meta.pyAssets.length, have, total: S.meta.pyAssets.length };
}
async function downloadPython(onProgress) {
  const c = await caches.open(S.meta.pyCache);
  let i = 0;
  for (const a of S.meta.pyAssets) {
    if (!(await c.match(a))) { const r = await fetch(a, { cache: 'reload' }); if (!r.ok) throw new Error('No se pudo descargar ' + a); await c.put(a, r); }
    onProgress(++i / S.meta.pyAssets.length);
  }
}

// Motor de Python: un worker que se crea al primer uso y se reinicia si un código tarda demasiado.
const Py = {
  worker: null, ready: null, handler: null,
  start() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const [prac, runnerSrc] = await Promise.all([loadPractice(), fetch('py/runner.py').then((r) => { if (!r.ok) throw new Error('runner'); return r.text(); })]);
      const w = new Worker('py-worker.js', { type: 'module' });
      this.worker = w;
      await new Promise((res, rej) => {
        w.onmessage = (e) => { if (e.data.type === 'ready') res(); else if (e.data.type === 'fatal') rej(new Error(e.data.msg)); };
        w.onerror = (e) => rej(new Error(e.message || 'No se pudo arrancar Python'));
        w.postMessage({ type: 'init', files: { 'curso.py': prac.helper, 'runner.py': runnerSrc } });
      });
      w.onmessage = (e) => this.handler && this.handler(e.data);
      w.onerror = (e) => this.handler && this.handler({ type: 'crash', msg: e.message });
    })();
    this.ready.catch(() => this.reset());
    return this.ready;
  },
  reset() { if (this.worker) this.worker.terminate(); this.worker = null; this.ready = null; this.handler = null; },
  async run(code, tests, io, on) {
    await this.start();
    return new Promise((resolve) => {
      let timer = null;
      const finish = (res) => { clearTimeout(timer); this.handler = null; resolve(res); };
      this.handler = (m) => {
        if (m.type === 'out' || m.type === 'err' || m.type === 'status') on(m);
        else if (m.type === 'started') { on(m); timer = setTimeout(() => { this.reset(); finish({ ok: false, timeout: true }); }, RUN_LIMIT_MS); }
        else if (m.type === 'done') finish(m.res);
        else if (m.type === 'crash') { this.reset(); finish({ ok: false, phase: 'code', error: { type: 'Error', msg: m.msg || 'Python se ha detenido', hint: '' } }); }
      };
      this.worker.postMessage({ type: 'run', code, tests, inputs: io.inputs, argv: io.argv });
    });
  },
};

function exItem(e) {
  const done = !!S.prog.practice[e.id];
  return `<li><a class="item nonum" href="#/practicar/${e.id}"><span class="t">${esc(e.title)}</span>
    <span class="chk${done ? ' on' : ''}" aria-label="${done ? 'Resuelta' : 'Sin resolver'}">${done ? '✓' : ''}</span>
    <span class="sub">${e.official ? '<b class="tag">Problema oficial</b> ' : ''}Clase ${e.w}, bloque ${e.d} ${levelDots(e.level)}${drafts.get(e.id) && !done ? ' · empezada' : ''}</span></a></li>`;
}

async function pyStatusBox(box) {
  if (!box) return;
  const st = await pyCacheStatus();
  if (st.unsupported) { box.innerHTML = '<p class="muted small">Este navegador no permite guardar Python para usarlo sin conexión.</p>'; return; }
  if (st.ok) { box.innerHTML = `<p class="py-ok"><b>✓ Python listo para usar sin conexión</b> <span class="muted small">(${fmtMB(S.meta.pySize)})</span></p>`; return; }
  box.innerHTML = `<p>Para practicar sin conexión, descarga Python una vez (${fmtMB(S.meta.pySize)}). Mejor con wifi. También se descarga solo la primera vez que ejecutas un ejercicio.</p>
    <div class="row"><button class="btn primary" id="pydl" type="button">Descargar Python</button></div><p class="muted small" id="pyprog" role="status"></p>`;
  $('#pydl').onclick = async () => {
    const b = $('#pydl'); b.disabled = true; b.textContent = 'Descargando…';
    try { await downloadPython((f) => { const p = $('#pyprog'); if (p) p.textContent = `Descargado el ${Math.round(f * 100)} %`; }); pyStatusBox(box); toast('Python guardado para usarlo sin conexión'); }
    catch { b.disabled = false; b.textContent = 'Reintentar la descarga'; const p = $('#pyprog'); if (p) p.textContent = 'No se pudo descargar: comprueba la conexión.'; }
  };
}

function renderPracticeHome() {
  setBar('Prácticas de Python'); setTab('practicar');
  const all = S.cat.practice || [];
  const done = all.filter((e) => S.prog.practice[e.id]).length;
  const next = all.find((e) => !S.prog.practice[e.id]);
  const weeks = S.cat.weeks.map((w) => {
    const own = all.filter((e) => e.w === w.n && !e.official), off = all.filter((e) => e.w === w.n && e.official);
    if (!own.length && !off.length) return '';
    return `<h2>Clase ${w.n}: ${esc(w.title_es)}</h2>
      ${own.length ? `<h3>Ejercicios para calentar</h3><ul class="list">${own.map(exItem).join('')}</ul>` : ''}
      ${off.length ? `<h3>Problem Set ${w.n}</h3><ul class="list">${off.map(exItem).join('')}</ul>` : ''}`;
  }).join('');
  view.innerHTML = `
    <h1>Prácticas de Python</h1>
    <p class="lead">Python funciona dentro de la app, sin conexión. Cada ejercicio se comprueba solo, como hace <code>check50</code>.</p>
    <p>Hay dos tipos. Los <b>ejercicios para calentar</b> son cortos y traen solución. Los <b>problemas oficiales</b> son los del curso: traen pistas, pero no solución.</p>
    <div class="py-box" id="pybox"><p class="muted small">Comprobando Python…</p></div>
    <div class="stat"><span>Resueltas</span><b>${done} de ${all.length}</b></div>
    <div class="row">${next ? `<a class="btn primary" href="#/practicar/${next.id}">${done ? 'Seguir' : 'Empezar'}: ${esc(next.title)}</a>` : ''}<a class="btn" href="#/practicar/libre">Zona libre</a></div>
    ${weeks}`;
  pyStatusBox($('#pybox'));
}

// Barra de símbolos difíciles de escribir con el teclado del móvil.
const KEYS = [['⇥', 'indent', 'Sangrar'], ['⇤', 'dedent', 'Quitar sangría'], ['( )', '(|)'], ['[ ]', '[|]'], ['{ }', '{|}'], [':', ':'], ['=', ' = '], ['" "', '"|"'], ["' '", "'|'"], ['_', '_'], ['.', '.'], [',', ', '], ['#', '# '], ['f""', 'f"|"'], ['↶', 'undo', 'Deshacer'], ['↷', 'redo', 'Rehacer']];
function keyBar() {
  return `<div class="keys" id="keys" role="toolbar" aria-label="Símbolos">${KEYS.map(([t, v, label], i) => `<button type="button" data-i="${i}" aria-label="${esc(label || t)}">${esc(t)}</button>`).join('')}</div>`;
}
function wireKeys() {
  const bar = $('#keys');
  // pointerdown + preventDefault: no se pierde el foco del editor (el teclado del móvil sigue abierto)
  bar.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !editor) return;
    const v = KEYS[+b.dataset.i][1];
    if (v === 'indent') editor.indent(); else if (v === 'dedent') editor.dedent(); else if (v === 'undo') editor.undo(); else if (v === 'redo') editor.redo(); else editor.insert(v);
  });
}

// Casilla «Entradas»: un valor por línea, que input() va leyendo. Y, si el ejercicio lo usa, los argumentos (sys.argv).
const ioStore = { all() { try { return JSON.parse(store.get(INPUT_STORE)) || {}; } catch { return {}; } },
  get(id) { return this.all()[id]; }, set(id, v) { const a = this.all(); a[id] = v; store.set(INPUT_STORE, JSON.stringify(a)); } };
function ioPanel(id, defInputs, defArgs, withArgs) {
  const st = ioStore.get(id) || { on: !!defInputs, inputs: defInputs || '', args: defArgs || '' };
  return `<div class="io">
    <label class="chk-line"><input type="checkbox" id="io-on"${st.on ? ' checked' : ''}> Entradas</label>
    <div id="io-box"${st.on ? '' : ' hidden'}>
      <label class="field"><span>Un valor por línea. Cada <code>input()</code> lee la siguiente.</span>
        <textarea id="io-in" rows="3" spellcheck="false" autocapitalize="off" autocomplete="off">${esc(st.inputs)}</textarea></label>
      ${withArgs ? `<label class="field"><span>Argumentos de la línea de órdenes (<code>sys.argv[1:]</code>), separados por espacios</span>
        <input type="text" id="io-args" spellcheck="false" autocapitalize="off" autocomplete="off" value="${esc(st.args)}"></label>` : ''}
    </div></div>`;
}
function wireIo(id) {
  const save = () => ioStore.set(id, { on: $('#io-on').checked, inputs: $('#io-in').value, args: $('#io-args') ? $('#io-args').value : '' });
  $('#io-on').onchange = () => { $('#io-box').hidden = !$('#io-on').checked; save(); if ($('#io-on').checked) $('#io-in').focus(); };
  $('#io-in').oninput = save;
  if ($('#io-args')) $('#io-args').oninput = save;
}
function ioValues() {
  const on = $('#io-on') && $('#io-on').checked;
  const lines = on ? $('#io-in').value.replace(/\r/g, '').split('\n') : null;
  if (lines) while (lines.length && lines.at(-1) === '') lines.pop();
  const a = on && $('#io-args') ? $('#io-args').value.trim() : '';
  return { inputs: lines, argv: a ? a.split(/\s+/) : [] };
}

function renderResult(box, res, mode) {
  const err = (e) => `<div class="res bad"><p><b>${e.where === 'la comprobación' ? 'Error al comprobar' : 'Error'}${e.line ? ` en la línea ${e.line}${e.where ? ' de ' + e.where : ''}` : ''}</b></p>
    <pre class="errmsg">${esc(e.msg)}</pre>${e.hint ? `<p class="small">${esc(e.hint)}</p>` : ''}
    ${e.where === 'la comprobación' ? '<p class="small muted">Suele significar que tu código todavía no devuelve lo que se espera.</p>' : ''}</div>`;
  if (res.timeout) { box.innerHTML = '<div class="res bad"><p><b>Detenido</b>: tu código tardaba más de 20 segundos. ¿Hay un bucle que no termina, o un input() esperando?</p></div>'; return; }
  let html = '';
  if (res.value && mode !== 'check') html += `<pre class="val">${esc(res.value)}</pre>`;
  if (res.error) { box.innerHTML = html + (res.passed && res.passed.length ? `<ul class="checks">${res.passed.map((c) => `<li class="okc">${esc(c)}</li>`).join('')}</ul>` : '') + err(res.error); return; }
  if (mode === 'check') {
    const passed = (res.passed || []).map((c) => `<li class="okc">${esc(c)}</li>`).join('');
    if (res.ok) html += `<div class="res good"><p><b>¡Correcto!</b> Pasa todas las comprobaciones.</p><ul class="checks">${passed}</ul></div>`;
    else {
      const [first, ...rest] = String(res.failed || '').split('\n');
      html += `<div class="res bad"><ul class="checks">${passed}<li class="koc">${esc(first)}${rest.length ? `<pre class="errmsg">${esc(rest.join('\n'))}</pre>` : ''}</li></ul></div>`;
    }
  } else if (res.exit) html += '<p class="muted small">El programa ha terminado con <code>sys.exit</code>.</p>';
  else if (!html) html = '<p class="muted small">Ejecutado sin errores.</p>';
  box.innerHTML = html;
}

async function runInto(code, tests, mode, onDone) {
  const out = $('#out'), res = $('#res'), con = $('#console');
  out.textContent = ''; res.innerHTML = ''; con.hidden = false;
  const st = $('#runst');
  st.textContent = Py.ready ? 'Ejecutando…' : 'Preparando Python… La primera vez tarda unos segundos.';
  for (const b of view.querySelectorAll('[data-run]')) b.disabled = true;
  const token = Symbol(); runInto.token = token;
  const io = mode === 'check' ? { inputs: null, argv: [] } : ioValues();
  let r;
  try {
    r = await Py.run(code, tests, io, (m) => {
      if (runInto.token !== token) return;
      if (m.type === 'status') st.textContent = m.msg;
      else if (m.type === 'started') st.textContent = mode === 'check' ? 'Comprobando…' : 'Ejecutando…';
      else { out.textContent += m.s + '\n'; out.hidden = false; }
    });
  } catch (err) {
    r = { ok: false, error: { type: 'Error', msg: navigator.onLine ? String(err.message || err) : 'Sin conexión: Python aún no está descargado en este dispositivo. Conéctate una vez y vuelve a intentarlo.', hint: '' } };
  }
  if (runInto.token !== token || !$('#res')) return;
  st.textContent = '';
  out.hidden = !out.textContent;
  for (const b of view.querySelectorAll('[data-run]')) b.disabled = false;
  renderResult(res, r, mode);
  if (onDone) onDone(r);
  con.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function mountEditor(code, onChange) {
  const host = $('#ed');
  host.innerHTML = '<p class="muted small">Cargando el editor…</p>';
  try { await loadEditor(); }
  catch { host.innerHTML = `<p class="error">No se pudo cargar el editor. ${navigator.onLine ? '' : 'Conéctate una vez para descargar Python y el editor.'}</p>`; return false; }
  if (!$('#ed')) return false;
  host.innerHTML = '';
  editor = window.CodeEditor.create(host, code, onChange);
  return true;
}

const consoleHtml = '<section class="console" id="console" hidden aria-live="polite"><p class="muted small" id="runst"></p><pre class="out" id="out" hidden></pre><div id="res"></div></section>';

async function renderExercise(id) {
  const meta = exById(id); if (!meta) return renderPracticeHome();
  setBar(meta.official ? 'Problema oficial' : 'Práctica', '#/practicar'); setTab('practicar');
  view.innerHTML = '<p class="muted">Cargando…</p>';
  let ex;
  try { ex = (await loadPractice()).exercises.find((e) => e.id === id); } catch (err) { view.innerHTML = `<p class="error">No se pudo abrir la práctica. ${esc(err.message)}</p>`; return; }
  if (location.hash.replace(/^#\/?/, '') !== `practicar/${id}`) return;
  const all = S.cat.practice, idx = all.findIndex((e) => e.id === id);
  const prev = all[idx - 1], next = all[idx + 1];
  const done = () => !!S.prog.practice[id];
  const l = lec(`c${ex.w}b${ex.d}`);
  view.innerHTML = `
    <p class="kicker"><a href="#/c/${l.id}">${blockLabel(l)}</a> · ${levelDots(ex.level)}${done() ? ' · <b>resuelta ✓</b>' : ''}</p>
    <h1>${esc(ex.title)}</h1>
    ${ex.official ? `<p class="small muted">Problema oficial de CS50 traducido. <a href="${esc(ex.url)}" target="_blank" rel="noopener">Enunciado original en inglés</a>. En el curso, el archivo se llama <code>${esc(ex.file)}</code>.</p>` : ''}
    <article class="notes">${ex.statement}</article>
    <h2 class="code-h">Tu código</h2>
    ${keyBar()}
    <div id="ed" class="ed"></div>
    ${ioPanel(id, ex.inputs, ex.args, !!ex.args)}
    <div class="row run-row"><button class="btn" data-run="run" type="button">Ejecutar</button><button class="btn primary" data-run="check" type="button">Comprobar</button></div>
    ${consoleHtml}
    <h2>¿Atascado?</h2>
    <ol class="hints" id="hints"></ol>
    <div class="row"><button class="btn small" id="hint" type="button">Ver una pista</button>${ex.official ? '' : '<button class="btn small" id="sol" type="button">Ver la solución</button>'}<button class="btn small" id="reset" type="button">Empezar de cero</button></div>
    ${ex.official ? `<div class="honesty"><p><b>Sin solución, a propósito.</b> Es un problema oficial: si quieres el certificado de CS50, la solución tiene que ser tuya. Cuando pase todas las comprobaciones, entrégalo desde <a href="https://cs50.dev/" target="_blank" rel="noopener">cs50.dev</a> con <code>submit50 cs50/problems/2022/python/${esc(ex.file.replace(/\.py$/, ''))}</code>.</p>
      <p class="small muted">Esta comprobación imita a <code>check50</code>, pero no es la oficial. Antes de entregar, pásale también <code>check50</code> en cs50.dev.</p></div>`
      : `<div id="solbox" hidden><p class="small muted">Una forma de resolverlo (hay otras):</p><pre class="code"><code>${esc(ex.solution)}</code></pre>
      <div class="row"><button class="btn small" id="usesol" type="button">Copiar la solución al editor</button></div></div>`}
    <nav class="pager">${prev ? `<a href="#/practicar/${prev.id}"><small>Anterior</small>${esc(prev.title)}</a>` : ''}${next ? `<a class="next" href="#/practicar/${next.id}"><small>Siguiente</small>${esc(next.title)}</a>` : ''}</nav>`;
  let saveT = null;
  const ok = await mountEditor(drafts.get(id) ?? ex.starter, (code) => { clearTimeout(saveT); saveT = setTimeout(() => drafts.set(id, code), 400); });
  if (!ok) return;
  wireKeys();
  wireIo(id);
  for (const b of view.querySelectorAll('[data-run]')) b.onclick = () => {
    const mode = b.dataset.run, code = editor.get();
    drafts.set(id, code);
    runInto(code, mode === 'check' ? ex.tests : null, mode, (r) => {
      if (mode === 'check' && r.ok && !S.prog.practice[id]) { S.prog.practice[id] = Date.now(); saveProg(); toast(ex.official ? '¡Problema resuelto!' : '¡Práctica resuelta!'); }
    });
  };
  let shown = 0;
  const hb = $('#hint');
  const paintHints = () => { $('#hints').innerHTML = ex.hints.slice(0, shown).map((h) => `<li>${h}</li>`).join(''); hb.hidden = shown >= ex.hints.length; };
  hb.onclick = () => { shown++; paintHints(); };
  paintHints();
  if (!ex.official) {
    $('#sol').onclick = () => {
      const box = $('#solbox');
      if (box.hidden && !done() && !confirm('¿Ver la solución? Intenta antes las pistas: se aprende más peleándose un poco.')) return;
      box.hidden = !box.hidden; $('#sol').textContent = box.hidden ? 'Ver la solución' : 'Ocultar la solución';
    };
    $('#usesol').onclick = () => { editor.set(ex.solution); drafts.set(id, ex.solution); editor.focus(); };
  }
  $('#reset').onclick = () => { if (!confirm('¿Borrar tu código y volver al código inicial?')) return; editor.set(ex.starter); drafts.del(id); };
}

const FREE_START = `# Zona libre: prueba aquí cualquier código.
# Activa «Entradas» para dar valores a input(), uno por línea.

name = input("What's your name? ").strip().title()
print(f"hello, {name}")
`;
async function renderFree() {
  setBar('Zona libre', '#/practicar'); setTab('practicar');
  view.innerHTML = `
    <h1>Zona libre</h1>
    <p class="lead">Escribe y ejecuta lo que quieras. Si la última línea es una expresión, se muestra su valor.</p>
    ${keyBar()}
    <div id="ed" class="ed"></div>
    ${ioPanel('libre', "David", '', true)}
    <div class="row run-row"><button class="btn primary" data-run="run" type="button">Ejecutar</button><button class="btn" id="clear" type="button">Vaciar</button></div>
    ${consoleHtml}
    <h2>Librerías disponibles sin conexión</h2>
    <p class="small">Toda la biblioteca estándar de Python ${esc(S.meta.pyVersion || '')} y además: ${esc((S.meta.libs || []).join(', '))}. La primera vez que importas una, tarda un poco más.</p>`;
  let saveT = null;
  const ok = await mountEditor(drafts.get('libre') ?? FREE_START, (code) => { clearTimeout(saveT); saveT = setTimeout(() => drafts.set('libre', code), 400); });
  if (!ok) return;
  wireKeys();
  wireIo('libre');
  view.querySelector('[data-run]').onclick = () => { drafts.set('libre', editor.get()); runInto(editor.get(), null, 'run'); };
  $('#clear').onclick = () => { editor.set(''); editor.focus(); };
}

function start() {
  S.prog = loadProg();
  S.lecList = S.cat.weeks.flatMap((w) => w.days.flatMap((d) => d.lectures));
  $('#tabs').hidden = false;
  route();
}

async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      S.swReg = reg;
      const ask = (w) => toast('Hay una versión nueva del contenido', 'Actualizar', () => w.postMessage('skipWaiting'));
      if (reg.waiting && navigator.serviceWorker.controller) ask(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) ask(w); });
      });
    }).catch(() => {});
    // Solo recargar cuando una versión nueva sustituye a otra (no en la primera instalación).
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloading) { reloading = true; location.reload(); } });
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; });
  try {
    S.meta = await (await fetch('data/meta.json', { cache: 'no-cache' })).json();
    S.cat = await loadJson(S.meta.files.catalog);
  } catch { view.innerHTML = '<p class="error">No se pudo cargar la app. Ábrela una vez con conexión para guardarla en el dispositivo.</p>'; return; }
  start();
}
boot();
