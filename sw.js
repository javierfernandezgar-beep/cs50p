// Service worker: guarda toda la app y los datos cifrados para usarla sin conexión.
// Python (Pyodide) y el editor van en una caché aparte (PY_CACHE) que no se borra con cada versión del contenido:
// se rellena la primera vez que se usan las prácticas o al pulsar "Descargar Python".
const VERSION = 'cs50p-v20261103-e6e17084';
const ASSETS = ["./","app.css","app.js","data/a0.json","data/catalog.json","data/practicas.json","data/t0.json","data/t1.json","data/t2.json","data/t3.json","data/t4.json","data/t5.json","data/t6.json","data/t7.json","data/t8.json","data/t9.json","fonts/atkinson-400-italic.woff2","fonts/atkinson-400-normal.woff2","fonts/atkinson-700-normal.woff2","icons/favicon.png","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","index.html","manifest.webmanifest","py-worker.js","py/runner.py","vendor/d3.min.js","vendor/markmap-view.js","data/meta.json"];
const PY_CACHE = 'cs50p-py-4dee7b6b64';
const PY_ASSETS = new Set(["vendor/editor.js","vendor/pyodide/defusedxml-0.7.1-py2.py3-none-any.whl","vendor/pyodide/emoji-2.16.0-py3-none-any.whl","vendor/pyodide/fonttools-4.62.1-py3-none-any.whl","vendor/pyodide/fpdf2-2.9.0-py3-none-any.whl","vendor/pyodide/inflect-7.6.0-py3-none-any.whl","vendor/pyodide/iniconfig-2.3.0-py3-none-any.whl","vendor/pyodide/jaraco_functools-4.4.0-py3-none-any.whl","vendor/pyodide/more_itertools-11.0.1-py3-none-any.whl","vendor/pyodide/packaging-26.1-py3-none-any.whl","vendor/pyodide/pillow-12.2.0-cp314-cp314-pyemscripten_2026_0_wasm32.whl","vendor/pyodide/pluggy-1.6.0-py3-none-any.whl","vendor/pyodide/pyfiglet-1.0.4-py3-none-any.whl","vendor/pyodide/pygments-2.20.0-py3-none-any.whl","vendor/pyodide/pyodide-lock.json","vendor/pyodide/pyodide.asm.mjs","vendor/pyodide/pyodide.asm.wasm","vendor/pyodide/pyodide.mjs","vendor/pyodide/pytest-9.0.2-py3-none-any.whl","vendor/pyodide/python_stdlib.zip","vendor/pyodide/tabulate-0.10.0-py3-none-any.whl","vendor/pyodide/typeguard-4.6.0-py3-none-any.whl","vendor/pyodide/typing_extensions-4.15.0-py3-none-any.whl","vendor/pyodide/validators-0.36.0-py3-none-any.whl"]);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k !== PY_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const rel = url.pathname.slice(new URL(self.registration.scope).pathname.length);
  e.respondWith((async () => {
    if (PY_ASSETS.has(rel)) {
      const pc = await caches.open(PY_CACHE);
      const hit = await pc.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) pc.put(req, res.clone());
      return res;
    }
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const index = await cache.match('./');
      if (index) return index;
    }
    return fetch(req);
  })());
});
