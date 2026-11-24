'use strict';
/* Compras: listas de compra y seguimiento de precios (fase 1, ingreso manual).
   Datos en localStorage, funciona offline. Sincroniza con Google Sheets vía Apps Script. */

const LS_DB = 'compras_db_v1', LS_META = 'compras_meta_v1';
const SHEETS = Object.keys(SCHEMA);
const KEY = t => SCHEMA[t][0][0];
const fmt = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const money = n => (n == null || n === '' || isNaN(n)) ? '-' : fmt.format(Math.round(n));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const today = () => new Date().toLocaleDateString('sv');
const daysBetween = (a, b) => Math.floor((new Date(b) - new Date(a)) / 864e5);
const $ = (s, e = document) => e.querySelector(s);

const TIPOS_COMPRA = [['recurrente', 'Recurrente (se repone)'], ['ocasional', 'Ocasional'], ['unica', 'Única (se compra una vez)']];
const COMPARAR = [['unitario', 'Precio unitario (por litro, kg, unidad)'], ['total', 'Total con envío']];
const TIPOS_TIENDA = [['web', 'Web propia'], ['shopify', 'Shopify'], ['woo', 'WooCommerce'], ['instagram', 'Instagram / WhatsApp'], ['fisica', 'Tienda física'], ['otra', 'Otra']];
const UNIDADES = [['', 'Sin pack'], ['un', 'unidades'], ['ml', 'ml'], ['l', 'litros'], ['g', 'gramos'], ['kg', 'kg']];
const ESTADOS_LINK = [['ok', 'Activo'], ['roto', 'Roto'], ['bloqueado', 'Bloqueado'], ['porVerificar', 'Por verificar']];
const PRIORIDADES = [['alta', 'Alta'], ['media', 'Media'], ['baja', 'Baja']];
const PRIO_ORD = { alta: 0, media: 1, baja: 2 };
const PRIO_CLS = { alta: 'bad', media: 'warn', baja: '' };

/* ---------- Datos ---------- */
let DB = {}, META = {};
const SEED_AT = '2026-11-08T00:00:00.000Z';
const SEED_CATS = [
  ['cat-hogar', 'Hogar', '', 'unica', 'total', 1],
  ['cat-hogar-muebles', 'Muebles', 'cat-hogar', 'unica', 'total', 1],
  ['cat-hogar-aseo', 'Aseo', 'cat-hogar', 'recurrente', 'unitario', 2],
  ['cat-hogar-merc', 'Mercadería', 'cat-hogar', 'recurrente', 'unitario', 3],
  ['cat-personal', 'Personal', '', 'unica', 'total', 2],
  ['cat-personal-ropa', 'Ropa', 'cat-personal', 'unica', 'total', 1],
  ['cat-personal-zapatos', 'Zapatos', 'cat-personal', 'unica', 'total', 2],
  ['cat-personal-perfumes', 'Perfumes', 'cat-personal', 'ocasional', 'unitario', 3],
  ['cat-personal-higiene', 'Higiene', 'cat-personal', 'recurrente', 'unitario', 4],
  ['cat-tec', 'Tecnología', '', 'unica', 'total', 3],
  ['cat-tec-audifonos', 'Audífonos', 'cat-tec', 'unica', 'total', 1],
  ['cat-tec-afeitadora', 'Afeitadora', 'cat-tec', 'unica', 'total', 2]
];
const SEED_CATS_TAREAS = [
  ['ctar-casa', 'Casa', 1],
  ['ctar-personal', 'Personal', 2],
  ['ctar-pichidangui', 'Pichidangui', 3],
  ['ctar-cuentas', 'Cuentas bancarias', 4]
];
const CFG_DEFAULT = { comuna: 'Peñalolén', diasSinActualizar: 14, margenMinimo: 5, bajoPromedio: 10, minObservaciones: 3, diasSilencio: 7 };

function load() {
  try { DB = JSON.parse(localStorage.getItem(LS_DB)) || {}; } catch { DB = {}; }
  try { META = JSON.parse(localStorage.getItem(LS_META)) || {}; } catch { META = {}; }
  // Si esta versión trae hojas nuevas, se fuerza una descarga completa en la próxima sincronización.
  let nuevas = false;
  SHEETS.forEach(t => { if (!DB[t]) { DB[t] = []; nuevas = true; } });
  if (nuevas) { META.since = ''; persistMeta(); }
  if (!DB.Categorias.length) {
    SEED_CATS.forEach(([id, nombre, padreId, tipoCompra, compararPor, orden]) =>
      DB.Categorias.push({ id, nombre, padreId, tipoCompra, compararPor, orden, archivada: 0, updatedAt: SEED_AT, eliminado: 0, _d: 1 }));
    Object.entries(CFG_DEFAULT).forEach(([clave, valor]) =>
      DB.Config.push({ clave, valor: String(valor), updatedAt: SEED_AT, eliminado: 0, _d: 1 }));
    persist();
  }
  if (!DB.CategoriasTareas.length) {
    SEED_CATS_TAREAS.forEach(([id, nombre, orden]) =>
      DB.CategoriasTareas.push({ id, nombre, orden, updatedAt: SEED_AT, eliminado: 0, _d: 1 }));
    persist();
  }
}
function persist() { localStorage.setItem(LS_DB, JSON.stringify(DB)); }
function persistMeta() { localStorage.setItem(LS_META, JSON.stringify(META)); }

const rec = (t, id) => DB[t].find(r => r[KEY(t)] === id);
const live = t => DB[t].filter(r => !r.eliminado);
function save(t, r) {
  r.updatedAt = new Date().toISOString(); r._d = 1;
  const i = DB[t].findIndex(x => x[KEY(t)] === r[KEY(t)]);
  if (i < 0) DB[t].push(r); else DB[t][i] = r;
  persist(); scheduleSync();
}
function remove(t, id) { const r = rec(t, id); if (r) { r.eliminado = 1; save(t, r); } }
function cfg(k) {
  const r = DB.Config.find(x => x.clave === k && !x.eliminado);
  const v = r ? r.valor : CFG_DEFAULT[k];
  return typeof CFG_DEFAULT[k] === 'number' ? Number(v) : v;
}
function setCfg(k, v) {
  const r = DB.Config.find(x => x.clave === k) || { clave: k, eliminado: 0 };
  r.valor = String(v); r.eliminado = 0; save('Config', r);
}

/* ---------- Lógica de costos ---------- */
function costs(p) {
  const c = +p.precioContado || 0, o = +p.otrosCostos || 0;
  const umbral = (p.envioGratisDesde === '' || p.envioGratisDesde == null) ? null : +p.envioGratisDesde;
  const env = (p.envio === '' || p.envio == null) ? null : +p.envio;
  const free = umbral != null && c >= umbral;
  const despacho = c + o + (free ? 0 : (env || 0));
  const retiro = p.retiroDisponible ? c + o : null;
  const useRetiro = retiro != null && retiro < despacho;
  const cuotas = (p.cuotasN && p.cuotaValor) ? p.cuotasN * p.cuotaValor : null;
  return {
    contado: c, despacho, retiro, free, umbral,
    best: useRetiro ? retiro : despacho,
    modo: useRetiro ? 'retiro' : 'despacho',
    cotizar: !free && env == null && !useRetiro,
    cuotasTotal: cuotas,
    interes: cuotas != null && cuotas > c + 1
  };
}
function unitPrice(total, link) {
  if (!link || !link.contenidoPack || !link.unidadPack) return null;
  let q = link.contenidoPack, u = link.unidadPack;
  if (u === 'l') { q *= 1000; u = 'ml'; }
  if (u === 'kg') { q *= 1000; u = 'g'; }
  const per = (u === 'ml' || u === 'g') ? 100 : 1;
  return { v: total * per / q, label: per === 100 ? `por 100 ${u}` : 'por unidad' };
}
function priceObs(linkId) {
  return live('Precios').filter(p => p.linkId === linkId).sort((a, b) => (a.fecha + a.updatedAt).localeCompare(b.fecha + b.updatedAt));
}
const lastPrice = linkId => { const o = priceObs(linkId); return o[o.length - 1]; };
function offersOf(prodId) {
  const list = live('Links').filter(l => l.productoId === prodId).map(l => {
    const price = lastPrice(l.id);
    return { link: l, tienda: rec('Tiendas', l.tiendaId), price, c: price ? costs(price) : null };
  });
  return list.sort((a, b) => {
    const av = a.price && a.price.disponible, bv = b.price && b.price.disponible;
    if (av !== bv) return av ? -1 : 1;
    return (a.c ? a.c.best : 1e12) - (b.c ? b.c.best : 1e12);
  });
}
const bestOffer = prodId => offersOf(prodId).find(o => o.price && o.price.disponible);
function stats(prodId) {
  const obs = live('Precios').filter(p => p.productoId === prodId && p.disponible);
  const tot = obs.map(p => ({ f: p.fecha, v: costs(p).best })).sort((a, b) => a.f.localeCompare(b.f));
  const vals = tot.map(x => x.v);
  const lim = new Date(); lim.setDate(lim.getDate() - 30);
  const r = tot.filter(x => new Date(x.f) >= lim);
  return {
    n: tot.length, tot,
    min: vals.length ? Math.min(...vals) : null,
    max: vals.length ? Math.max(...vals) : null,
    avg30: r.length ? r.reduce((a, x) => a + x.v, 0) / r.length : null
  };
}
function goodMoment(prod) {
  const b = bestOffer(prod.id);
  if (!b) return null;
  const st = stats(prod.id), v = b.c.best, why = [];
  if (prod.precioObjetivo && v <= prod.precioObjetivo) why.push('objetivo');
  if (st.n >= cfg('minObservaciones') && st.max > st.min * 1.02) {
    if (v <= st.min * (1 + cfg('margenMinimo') / 100)) why.push('minimo');
    if (st.avg30 && v <= st.avg30 * (1 - cfg('bajoPromedio') / 100)) why.push('promedio');
  }
  return why.length ? why : null;
}
const WHY = { objetivo: 'bajo tu precio objetivo', minimo: 'cerca del mínimo histórico', promedio: 'bajo el promedio de 30 días' };

/* ---------- Tareas: ayudas ---------- */
const tcatName = id => { const c = rec('CategoriasTareas', id); return c && !c.eliminado ? c.nombre : ''; };
const tcats = () => live('CategoriasTareas').sort((a, b) => ((a.orden || 0) - (b.orden || 0)) || a.nombre.localeCompare(b.nombre));
const tcatOptions = () => [['', 'Sin categoría'], ...tcats().map(c => [c.id, c.nombre])];
const fechaCorta = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
function tareaEstado(t) {
  if (!t.fechaLimite) return 'sinfecha';
  const h = today();
  return t.fechaLimite < h ? 'atrasada' : (t.fechaLimite === h ? 'hoy' : 'proxima');
}
const cmpTarea = (a, b) =>
  (a.fechaLimite || '9999').localeCompare(b.fechaLimite || '9999')
  || ((PRIO_ORD[a.prioridad] ?? 1) - (PRIO_ORD[b.prioridad] ?? 1))
  || String(a.titulo).localeCompare(String(b.titulo));

/* ---------- Alertas (se calculan al vuelo) ---------- */
function computeAlerts() {
  const out = [], hoy = today();
  live('Productos').filter(p => p.estado === 'vigilando').forEach(p => {
    const cat = rec('Categorias', p.categoriaId);
    const b = bestOffer(p.id), gm = goodMoment(p);
    if (gm) out.push({ key: `precio:${p.id}`, tipo: gm.includes('objetivo') ? 'objetivo' : 'momento', prodId: p.id,
      texto: `${p.nombre}: ${money(b.c.best)} en ${b.tienda ? b.tienda.nombre : 'tienda'} (${gm.map(x => WHY[x]).join(', ')})` });
    if (cat && cat.tipoCompra === 'recurrente' && p.ultimaCompra && p.frecuenciaDias && daysBetween(p.ultimaCompra, hoy) >= p.frecuenciaDias)
      out.push({ key: `reponer:${p.id}`, tipo: 'reponer', prodId: p.id,
        texto: `${p.nombre}: toca reponer (última compra hace ${daysBetween(p.ultimaCompra, hoy)} días)` });
    const links = live('Links').filter(l => l.productoId === p.id);
    if (links.length) {
      const fechas = links.map(l => lastPrice(l.id)).filter(Boolean).map(x => x.fecha).sort();
      const ult = fechas[fechas.length - 1];
      if (!ult || daysBetween(ult, hoy) > cfg('diasSinActualizar'))
        out.push({ key: `sinprecio:${p.id}`, tipo: 'sinprecio', prodId: p.id,
          texto: `${p.nombre}: ${ult ? 'sin precio nuevo hace ' + daysBetween(ult, hoy) + ' días' : 'aún sin precio registrado'}` });
    }
  });
  live('Links').filter(l => l.estadoLink && l.estadoLink !== 'ok').forEach(l => {
    const p = rec('Productos', l.productoId), t = rec('Tiendas', l.tiendaId);
    if (p && !p.eliminado) out.push({ key: `link:${l.id}`, tipo: 'link', prodId: p.id,
      texto: `${p.nombre} en ${t ? t.nombre : 'tienda'}: link ${l.estadoLink}` });
  });
  live('Tareas').filter(t => t.estado !== 'hecha' && t.fechaLimite && t.fechaLimite <= hoy).sort(cmpTarea).forEach(t => {
    const d = daysBetween(t.fechaLimite, hoy), cat = tcatName(t.categoriaId);
    out.push({ key: `tarea:${t.id}`, tipo: 'tarea', tareaId: t.id,
      texto: `${t.titulo}: ${d > 0 ? 'atrasada hace ' + d + (d === 1 ? ' día' : ' días') : 'vence hoy'}${cat ? ' (' + cat + ')' : ''}` });
  });
  return out.filter(a => {
    const d = rec('Alertas', a.key);
    return !(d && !d.eliminado && d.estado === 'descartada' && daysBetween(d.fecha, hoy) < cfg('diasSilencio'));
  });
}
const ALERT_LABEL = { objetivo: ['Bajo tu objetivo', 'good'], momento: ['Buen momento', 'good'], reponer: ['Reponer', 'warn'], sinprecio: ['Sin precio al día', ''], link: ['Link con problema', 'bad'], tarea: ['Tarea', 'warn'] };

/* ---------- Categorías ---------- */
const catName = id => { const c = rec('Categorias', id); if (!c) return '-'; const p = c.padreId && rec('Categorias', c.padreId); return p ? `${p.nombre} › ${c.nombre}` : c.nombre; };
const topCats = () => live('Categorias').filter(c => !c.padreId).sort((a, b) => a.orden - b.orden);
const kidsOf = id => live('Categorias').filter(c => c.padreId === id).sort((a, b) => a.orden - b.orden);
function leafOptions(includeArchived) {
  const opts = [];
  topCats().filter(t => includeArchived || !t.archivada).forEach(t => {
    const ks = kidsOf(t.id).filter(k => includeArchived || !k.archivada);
    if (ks.length) opts.push({ g: t.nombre, items: ks.map(k => [k.id, k.nombre]) }); else opts.push([t.id, t.nombre]);
  });
  return opts;
}

/* ---------- Formularios ---------- */
const opt = (o, v) => `<option value="${esc(o[0])}" ${String(o[0]) === String(v) ? 'selected' : ''}>${esc(o[1])}</option>`;
function fieldHtml(f, vals) {
  const v = vals[f.k] ?? f.def ?? '';
  const hint = f.hint ? `<div class="mut small">${esc(f.hint)}</div>` : '';
  if (f.type === 'check') return `<label class="inl"><input type="checkbox" name="${f.k}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>${hint}`;
  let ctl;
  if (f.type === 'select') ctl = `<select name="${f.k}" ${f.req ? 'required' : ''}>${f.opts.map(o => o.g ? `<optgroup label="${esc(o.g)}">${o.items.map(i => opt(i, v)).join('')}</optgroup>` : opt(o, v)).join('')}</select>`;
  else if (f.type === 'area') ctl = `<textarea name="${f.k}" rows="3">${esc(v)}</textarea>`;
  else if (f.type === 'multi') ctl = f.opts.map(o => `<label class="inl"><input type="checkbox" name="${f.k}" value="${esc(o[0])}"> ${esc(o[1])}</label>`).join('') || '<div class="mut">Sin opciones disponibles.</div>';
  else ctl = `<input name="${f.k}" type="${f.type === 'num' ? 'number' : (f.type || 'text')}" ${f.type === 'num' ? 'step="any" inputmode="decimal"' : ''} value="${esc(v)}" ${f.req ? 'required' : ''} ${f.ph ? `placeholder="${esc(f.ph)}"` : ''}>`;
  return `<label>${esc(f.label)}${f.req ? ' *' : ''}</label>${ctl}${hint}`;
}
function formModal(title, fields, vals, cb, submitLabel) {
  const d = document.createElement('dialog');
  d.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2>${fields.map(f => fieldHtml(f, vals)).join('')}
    <div class="row end"><button type="button" class="ghost" data-x>Cancelar</button><button class="primary">${esc(submitLabel || 'Guardar')}</button></div></form>`;
  document.body.append(d); d.showModal();
  const form = $('form', d);
  $('[data-x]', d).onclick = () => d.close();
  d.addEventListener('close', () => d.remove());
  fields.forEach(f => { if (f.onchange) form.elements[f.k].addEventListener('change', () => f.onchange(form)); });
  form.onsubmit = ev => {
    ev.preventDefault();
    const v = {};
    for (const f of fields) {
      if (f.type === 'multi') v[f.k] = [...form.querySelectorAll(`[name="${f.k}"]:checked`)].map(x => x.value);
      else if (f.type === 'check') v[f.k] = form.elements[f.k].checked ? 1 : 0;
      else if (f.type === 'num') { const x = form.elements[f.k].value; v[f.k] = x === '' ? null : Number(x); }
      else v[f.k] = form.elements[f.k].value.trim();
    }
    if (cb(v) === false) return;
    d.close(); render();
  };
}

/* ---------- Estado de vista ---------- */
const S = { view: 'inicio', param: null, q: '', fcat: '', ttab: 'rapida', tcat: '', tprio: '', rOpen: false, tOpen: false };
const TITLES = { inicio: 'Inicio', productos: 'Productos', producto: 'Producto', listas: 'Listas de compra', lista: 'Lista', tareas: 'Tareas', tcategorias: 'Categorías de tareas', alertas: 'Alertas', mas: 'Más', categorias: 'Categorías', tiendas: 'Tiendas', config: 'Configuración' };
const NAVMAP = { producto: 'productos', lista: 'listas', tcategorias: 'tareas', categorias: 'mas', tiendas: 'mas', config: 'mas' };

function pill(txt, cls) { return `<span class="pill ${cls || ''}">${esc(txt)}</span>`; }
function alertRow(a) {
  const [lbl, cls] = ALERT_LABEL[a.tipo];
  const act = a.tareaId ? 'data-act="tarea-open"' : `data-act="prod-open" data-id="${a.prodId}"`;
  return `<div class="card click" ${act}>${pill(lbl, cls)}<div>${esc(a.texto)}</div></div>`;
}
function backBtn(to) { return `<button class="mini" data-act="nav" data-id="${to}">‹ Volver</button>`; }

/* ---------- Vistas ---------- */
const VIEWS = {};

VIEWS.inicio = () => {
  const al = computeAlerts();
  const group = tipos => al.filter(a => tipos.includes(a.tipo));
  const sec = (t, items, vacio) => `<h2>${t}</h2>` + (items.length ? items.slice(0, 5).map(alertRow).join('') : `<div class="mut small">${vacio}</div>`);
  const vig = live('Productos').filter(p => p.estado === 'vigilando').length;
  const sync = META.lastSync ? `Sincronizado ${new Date(META.lastSync).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}` : (META.url ? 'Aún sin sincronizar' : 'Sincronización no configurada');
  return `<div class="grid2">
      <div class="card"><div class="price">${vig}</div><div class="mut small">productos vigilando</div></div>
      <div class="card click" data-act="nav" data-id="alertas"><div class="price">${al.length}</div><div class="mut small">alertas pendientes</div></div>
    </div>
    <div class="mut small">${esc(sync)} · Despacho a ${esc(cfg('comuna'))}</div>
    ${sec('Para comprar ahora', group(['objetivo', 'momento']), 'Nada por ahora. Cuando un precio baje, aparecerá aquí.')}
    ${sec('Por reponer', group(['reponer']), 'Sin reposiciones pendientes.')}
    ${sec('Sin precio actualizado', group(['sinprecio']), 'Todo al día.')}
    ${group(['link']).length ? sec('Links con problemas', group(['link']), '') : ''}
    ${group(['tarea']).length ? sec('Tareas atrasadas o de hoy', group(['tarea']), '') : ''}
    <div class="row wrap" style="margin-top:14px"><button class="primary" data-act="prod-new">+ Producto</button><button class="ghost" data-act="list-new">+ Lista</button></div>`;
};

VIEWS.productos = () => {
  const opts = [['', 'Todas las categorías']];
  topCats().forEach(t => { opts.push([t.id, t.nombre]); kidsOf(t.id).forEach(k => opts.push([k.id, '   ' + k.nombre])); });
  return `<div class="row"><input id="q" placeholder="Buscar producto" value="${esc(S.q)}"><button class="primary" data-act="prod-new">+</button></div>
    <select id="fcat" style="margin:8px 0">${opts.map(o => opt(o, S.fcat)).join('')}</select>
    <div id="plist">${productList()}</div>`;
};
function productList() {
  const q = S.q.toLowerCase();
  const inCat = p => !S.fcat || p.categoriaId === S.fcat || (rec('Categorias', p.categoriaId) || {}).padreId === S.fcat;
  const items = live('Productos').filter(p => inCat(p) && (p.nombre + ' ' + p.especificacion).toLowerCase().includes(q))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  if (!items.length) return '<div class="empty">Sin productos. Toca "+" para agregar el primero.</div>';
  return items.map(p => {
    const b = bestOffer(p.id), gm = p.estado === 'vigilando' && goodMoment(p);
    return `<div class="card click" data-act="prod-open" data-id="${p.id}">
      <div class="row between"><h3>${esc(p.nombre)}</h3>${b ? `<span class="price">${money(b.c.best)}</span>` : '<span class="mut small">sin precio</span>'}</div>
      <div class="mut small">${esc(p.especificacion)} ${p.especificacion ? '·' : ''} ${esc(catName(p.categoriaId))}${b && b.tienda ? ' · ' + esc(b.tienda.nombre) : ''}</div>
      <div>${p.estado !== 'vigilando' ? pill(p.estado) : ''}${gm ? pill('Buen momento', 'good') : ''}${p.prioridad === 'alta' ? pill('Prioridad alta', 'warn') : ''}</div></div>`;
  }).join('');
}

VIEWS.producto = () => {
  const p = rec('Productos', S.param);
  if (!p || p.eliminado) return '<div class="empty">Producto no encontrado.</div>';
  const cat = rec('Categorias', p.categoriaId), st = stats(p.id), offers = offersOf(p.id), gm = goodMoment(p);
  const spark = st.tot.length > 1 ? sparkline(st.tot.map(x => x.v)) : '';
  return `<div class="row between">${backBtn('productos')}<div class="row"><button class="mini" data-act="prod-edit" data-id="${p.id}">Editar</button><button class="mini danger" data-act="prod-del" data-id="${p.id}">Eliminar</button></div></div>
    <h1>${esc(p.nombre)}</h1>
    <div class="mut">${esc(p.especificacion)} ${p.cantidad ? '· ' + p.cantidad + ' ' + esc(p.unidad) : ''}</div>
    <div>${pill(catName(p.categoriaId))}${pill(cat ? cat.tipoCompra : '')}${pill(p.estado)}${p.prioridad ? pill('Prioridad ' + p.prioridad) : ''}${gm ? gm.map(x => pill(WHY[x], 'good')).join('') : ''}</div>
    <div class="card" style="margin-top:10px">
      <div class="grid2"><div><div class="mut small">Objetivo</div><b>${money(p.precioObjetivo)}</b></div><div><div class="mut small">Mínimo histórico</div><b>${money(st.min)}</b></div>
      <div><div class="mut small">Promedio 30 días</div><b>${money(st.avg30)}</b></div><div><div class="mut small">Observaciones</div><b>${st.n}</b></div></div>
      ${spark}
      ${p.ultimaCompra ? `<div class="mut small">Última compra: ${esc(p.ultimaCompra)}${p.frecuenciaDias ? ' · cada ' + p.frecuenciaDias + ' días' : ''}</div>` : ''}
    </div>
    <div class="row wrap"><button class="primary" data-act="offer-new" data-id="${p.id}">+ Tienda y precio</button><button class="ghost" data-act="prod-bought" data-id="${p.id}">Marcar comprado</button></div>
    <h2>Ofertas (${offers.length})</h2>
    ${offers.length ? offers.map(o => offerCard(o, cat)).join('') : '<div class="empty">Agrega una tienda con su link y precio.</div>'}
    ${p.notas ? `<h2>Notas</h2><div class="card">${esc(p.notas)}</div>` : ''}`;
};
function sparkline(vals) {
  const w = 300, h = 60, mn = Math.min(...vals), mx = Math.max(...vals), r = (mx - mn) || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * (w - 8) + 4).toFixed(1)},${(h - 6 - (v - mn) / r * (h - 12)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="var(--brand)" stroke-width="2"/></svg>`;
}
function offerCard(o, cat) {
  const { link: l, tienda: t, price: p, c } = o;
  const head = `<div class="row between"><h3>${esc(t ? t.nombre : 'Tienda')}</h3>${l.estadoLink !== 'ok' ? pill(l.estadoLink, 'bad') : ''}</div>
    <div class="mut small">${esc(l.variante)} ${l.contenidoPack ? '· pack ' + l.contenidoPack + ' ' + esc(l.unidadPack) : ''}</div>`;
  const btns = `<div class="row wrap" style="margin-top:8px">${l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener"><button class="mini">Abrir link ↗</button></a>` : ''}
    <button class="mini" data-act="price-new" data-id="${l.id}">Nuevo precio</button><button class="mini" data-act="link-edit" data-id="${l.id}">Editar link</button><button class="mini danger" data-act="link-del" data-id="${l.id}">Quitar</button></div>`;
  if (!p) return `<div class="card">${head}<div class="mut">Sin precio registrado.</div>${btns}</div>`;
  const unit = unitPrice(c.best, l);
  const hist = priceObs(l.id).slice().reverse();
  return `<div class="card">${head}
    <div class="row between" style="margin-top:6px"><div><span class="price">${money(p.precioContado)}</span> ${p.precioNormal && p.precioNormal > p.precioContado ? `<span class="mut small"><s>${money(p.precioNormal)}</s></span>` : ''}</div>${p.disponible ? '' : pill('Sin stock', 'bad')}</div>
    ${p.cuotasN ? `<div class="small">${p.cuotasN} cuotas de ${money(p.cuotaValor)} ${p.sinInteres ? '(sin interés)' : '(con interés)'}</div>` : ''}
    ${c.interes ? `<div class="warnbox">Total en cuotas: ${money(c.cuotasTotal)}, ${money(c.cuotasTotal - c.contado)} más que al contado.</div>` : ''}
    <div class="small mut">Envío a ${esc(cfg('comuna'))}: ${c.free ? 'gratis' : (p.envio == null ? 'por cotizar' : money(p.envio))}${c.umbral && !c.free ? ` (gratis desde ${money(c.umbral)})` : ''}${p.retiroDisponible ? ' · retiro en tienda disponible' : ''}${p.otrosCostos ? ` · otros: ${money(p.otrosCostos)} ${esc(p.otrosDetalle)}` : ''}${p.plazoEntrega ? ' · entrega ' + esc(p.plazoEntrega) : ''}</div>
    <div class="total" style="margin-top:4px">Total ${money(c.best)} <span class="mut small">(${c.modo === 'retiro' ? 'con retiro en tienda' : 'con despacho'}${c.cotizar ? ', envío por cotizar' : ''})</span></div>
    ${unit && (!cat || cat.compararPor === 'unitario' || true) ? `<div class="small">${money(unit.v)} ${unit.label}</div>` : ''}
    <div class="mut small">Precio al ${esc(p.fecha)}</div>
    <details><summary>Historial (${hist.length})</summary>${hist.map(h => `<div class="row between small" style="padding:4px 0"><span>${esc(h.fecha)}</span><span>${money(h.precioContado)} · total ${money(costs(h).best)}</span><button class="mini danger" data-act="price-del" data-id="${h.id}">x</button></div>`).join('')}</details>
    ${btns}</div>`;
}

VIEWS.listas = () => {
  const ls = live('Listas').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return `<div class="row between"><h1>Listas</h1><button class="primary" data-act="list-new">+ Nueva</button></div>` +
    (ls.length ? ls.map(l => {
      const items = live('ListaItems').filter(i => i.listaId === l.id);
      const done = items.filter(i => i.comprado).length;
      return `<div class="card click" data-act="list-open" data-id="${l.id}"><h3>${esc(l.nombre)}</h3><div class="mut small">${items.length} productos · ${done} comprados</div></div>`;
    }).join('') : '<div class="empty">Crea una lista y agrégale productos. La app propone la mejor tienda de cada uno.</div>');
};

function listGroups(listId) {
  const groups = {};
  live('ListaItems').filter(i => i.listaId === listId).forEach(i => {
    const prod = rec('Productos', i.productoId);
    if (!prod || prod.eliminado) return;
    const offs = offersOf(i.productoId).filter(o => o.price && o.price.disponible);
    const o = offs.find(x => x.tienda && x.tienda.id === i.tiendaId) || offs[0];
    const key = o && o.tienda ? o.tienda.id : '_sin';
    (groups[key] = groups[key] || { tienda: o && o.tienda, items: [] }).items.push({ i, prod, o });
  });
  return groups;
}
VIEWS.lista = () => {
  const l = rec('Listas', S.param);
  if (!l || l.eliminado) return '<div class="empty">Lista no encontrada.</div>';
  const groups = listGroups(l.id);
  let grand = 0, grandRetiro = 0, retiroOk = true;
  const html = Object.values(groups).map(g => {
    let sub = 0, otros = 0, allRet = true, env = null, umbral = null;
    g.items.forEach(({ i, o }) => {
      if (!o) return;
      sub += o.price.precioContado * i.cantidad; otros += (o.price.otrosCostos || 0) * i.cantidad;
      if (!o.price.retiroDisponible) allRet = false;
      if (env == null && o.price.envio != null) env = o.price.envio;
      if (umbral == null && o.price.envioGratisDesde) umbral = o.price.envioGratisDesde;
    });
    if (g.tienda) { if (env == null && g.tienda.envioPenalolen != null) env = g.tienda.envioPenalolen; if (umbral == null && g.tienda.envioGratisDesde) umbral = g.tienda.envioGratisDesde; }
    const free = umbral != null && sub >= umbral, envio = free ? 0 : (env || 0);
    const falta = umbral != null && !free ? umbral - sub : 0;
    grand += sub + otros + envio; grandRetiro += sub + otros; if (!allRet) retiroOk = false;
    return `<div class="card"><div class="row between"><h3>${esc(g.tienda ? g.tienda.nombre : 'Sin precio')}</h3><b>${money(sub + otros + envio)}</b></div>
      ${g.items.map(({ i, prod, o }) => `<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--line)">
        <label class="inl" style="margin:0;flex:1"><input type="checkbox" data-act="item-toggle" data-id="${i.id}" ${i.comprado ? 'checked' : ''}> <span style="${i.comprado ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(prod.nombre)} × ${i.cantidad}</span></label>
        <span class="small">${o ? money(o.price.precioContado * i.cantidad) : '-'}</span>
        <button class="mini" data-act="item-store" data-id="${i.id}">tienda</button><button class="mini danger" data-act="item-del" data-id="${i.id}">x</button></div>`).join('')}
      ${g.tienda ? `<div class="mut small" style="margin-top:6px">Envío: ${free ? 'gratis' : (env == null ? 'por cotizar' : money(env))}${allRet ? ' · retiro en tienda disponible (sin envío)' : ''}</div>` : ''}
      ${falta > 0 ? `<div class="warnbox">Te faltan ${money(falta)} para envío gratis en ${esc(g.tienda.nombre)}. ¿Agregar otro producto de esta tienda?</div>` : ''}</div>`;
  }).join('');
  return `<div class="row between">${backBtn('listas')}<button class="mini danger" data-act="list-del" data-id="${l.id}">Eliminar lista</button></div>
    <h1>${esc(l.nombre)}</h1>
    ${html || '<div class="empty">Lista vacía.</div>'}
    <div class="card"><div class="row between"><span>Total estimado (despacho)</span><span class="total">${money(grand)}</span></div>
    ${retiroOk && grandRetiro < grand ? `<div class="row between small mut"><span>Con retiro en tienda</span><span>${money(grandRetiro)}</span></div>` : ''}</div>
    <button class="primary" data-act="list-add" data-id="${l.id}">+ Agregar productos</button>`;
};

/* ----- Tareas: lista rápida y tareas planificadas ----- */
VIEWS.tareas = () => {
  const seg = `<div class="seg"><button data-act="ttab" data-id="rapida" class="${S.ttab === 'rapida' ? 'on' : ''}">Lista rápida</button><button data-act="ttab" data-id="plan" class="${S.ttab === 'plan' ? 'on' : ''}">Planificadas</button></div>`;
  return seg + (S.ttab === 'plan' ? viewPlan() : viewRapida());
};

function viewRapida() {
  const all = live('Rapidas');
  const pend = all.filter(r => !r.hecho).sort((a, b) => (b.orden || 0) - (a.orden || 0));
  const done = all.filter(r => r.hecho).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const row = r => `<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)">
    <label class="inl" style="margin:0;flex:1"><input type="checkbox" data-act="rapida-toggle" data-id="${r.id}" ${r.hecho ? 'checked' : ''}> <span style="${r.hecho ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(r.texto)}</span></label>
    <button class="mini" data-act="rapida-edit" data-id="${r.id}">editar</button><button class="mini danger" data-act="rapida-del" data-id="${r.id}">x</button></div>`;
  return `<div class="row" style="margin:10px 0"><input id="rq" placeholder="Agregar algo rápido" autocomplete="off"><button class="primary" data-act="rapida-add">+</button></div>
    <div class="card" style="padding:4px 12px">${pend.length ? pend.map(row).join('') : '<div class="empty">Nada pendiente.</div>'}</div>
    ${done.length ? `<details id="rdone" ${S.rOpen ? 'open' : ''}><summary>Hechas (${done.length})</summary><div class="card" style="padding:4px 12px;margin-top:6px">${done.map(row).join('')}</div><button class="mini danger" data-act="rapida-clean">Limpiar hechas</button></details>` : ''}`;
}

function tareaCard(t) {
  const est = tareaEstado(t), hecha = t.estado === 'hecha';
  const pb = (txt, cls, act) => `<button class="pill ${cls}" data-act="${act}" data-id="${t.id}">${esc(txt)}</button>`;
  const cat = tcatName(t.categoriaId);
  let fechaTxt = t.fechaLimite ? fechaCorta(t.fechaLimite) : 'Sin fecha';
  if (!hecha && est === 'atrasada') fechaTxt += ` (hace ${daysBetween(t.fechaLimite, today())} d)`;
  if (!hecha && est === 'hoy') fechaTxt += ' (hoy)';
  const fechaCls = hecha ? '' : (est === 'atrasada' ? 'bad' : (est === 'hoy' ? 'warn' : ''));
  return `<div class="card tarea ${hecha ? 'done' : ''}">
    <div class="row"><input type="checkbox" data-act="tarea-toggle" data-id="${t.id}" ${hecha ? 'checked' : ''} aria-label="Hecha">
      <div style="flex:1"><h3>${esc(t.titulo)}</h3>${t.notas ? `<div class="mut small">${esc(t.notas)}</div>` : ''}</div></div>
    <div class="row wrap" style="margin-top:6px">${pb(cat || 'Sin categoría', '', 'tarea-cat')}${pb('Prioridad ' + (t.prioridad || 'media'), PRIO_CLS[t.prioridad] || '', 'tarea-prio')}${pb(fechaTxt, fechaCls, 'tarea-fecha')}</div>
    ${hecha && t.fechaHecha ? `<div class="mut small">Hecha el ${esc(fechaCorta(t.fechaHecha))}</div>` : ''}
    <div class="row end" style="margin-top:6px"><button class="mini" data-act="tarea-edit" data-id="${t.id}">Editar</button><button class="mini danger" data-act="tarea-del" data-id="${t.id}">x</button></div></div>`;
}

function viewPlan() {
  const filt = t => (!S.tcat || (S.tcat === '_none' ? !t.categoriaId : t.categoriaId === S.tcat)) && (!S.tprio || t.prioridad === S.tprio);
  const all = live('Tareas').filter(filt);
  const pend = all.filter(t => t.estado !== 'hecha').sort(cmpTarea);
  const done = all.filter(t => t.estado === 'hecha').sort((a, b) => (b.fechaHecha || '').localeCompare(a.fechaHecha || '')).slice(0, 50);
  const secs = [['atrasada', 'Atrasadas'], ['hoy', 'Hoy'], ['proxima', 'Próximas'], ['sinfecha', 'Sin fecha']];
  const catOpts = [['', 'Todas las categorías'], ...tcats().map(c => [c.id, c.nombre]), ['_none', 'Sin categoría']];
  const prioOpts = [['', 'Todas las prioridades'], ...PRIORIDADES];
  const body = secs.map(([k, label]) => {
    const items = pend.filter(t => tareaEstado(t) === k);
    return items.length ? `<h2>${label} (${items.length})</h2>${items.map(tareaCard).join('')}` : '';
  }).join('');
  return `<div class="row between"><button class="mini" data-act="nav" data-id="tcategorias">Categorías de tareas</button><button class="primary" data-act="tarea-new">+ Tarea</button></div>
    <div class="grid2" style="margin:10px 0 0">
      <select id="tfcat">${catOpts.map(o => opt(o, S.tcat)).join('')}</select>
      <select id="tfprio">${prioOpts.map(o => opt(o, S.tprio)).join('')}</select></div>
    ${body || '<div class="empty">Sin tareas pendientes. Toca "+ Tarea" para agregar una.</div>'}
    ${done.length ? `<details id="tdone" ${S.tOpen ? 'open' : ''}><summary>Hechas (${done.length})</summary>${done.map(tareaCard).join('')}</details>` : ''}`;
}

VIEWS.tcategorias = () => `<div class="row between">${backBtn('tareas')}<button class="primary" data-act="tcat-new">+ Categoría</button></div><h1>Categorías de tareas</h1>` +
  (tcats().map(c => `<div class="card"><div class="row between"><h3>${esc(c.nombre)}</h3><div class="row"><button class="mini" data-act="tcat-up" data-id="${c.id}">↑</button><button class="mini" data-act="tcat-edit" data-id="${c.id}">Editar</button><button class="mini danger" data-act="tcat-del" data-id="${c.id}">x</button></div></div>
    <div class="mut small">${live('Tareas').filter(t => t.categoriaId === c.id && t.estado !== 'hecha').length} pendientes</div></div>`).join('')
    || '<div class="empty">Sin categorías. Toca "+ Categoría" para crear la primera.</div>');

VIEWS.alertas = () => {
  const al = computeAlerts();
  return `<h1>Alertas</h1>` + (al.length ? al.map(a => {
    const [lbl, cls] = ALERT_LABEL[a.tipo];
    const btns = a.tareaId
      ? `<button class="mini" data-act="tarea-open">Ver tareas</button>`
      : `<button class="mini" data-act="prod-open" data-id="${a.prodId}">Ver producto</button><button class="mini" data-act="alert-dismiss" data-id="${esc(a.key)}" data-tipo="${a.tipo}" data-prod="${a.prodId}">Descartar ${cfg('diasSilencio')} días</button>`;
    return `<div class="card">${pill(lbl, cls)}<div>${esc(a.texto)}</div><div class="row" style="margin-top:8px">${btns}</div></div>`;
  }).join('') : '<div class="empty">Sin alertas. Se generan solas según tus precios, objetivos, frecuencias de recompra y fechas de tareas.</div>') +
    `<div class="mut small">Por ahora las alertas viven solo aquí. Más adelante pueden llegar por correo.</div>`;
};

VIEWS.mas = () => `<h1>Más</h1><div class="card menu" style="padding:0">
  <button class="item" data-act="nav" data-id="categorias">Categorías <span>›</span></button>
  <button class="item" data-act="nav" data-id="tiendas">Tiendas <span>›</span></button>
  <button class="item" data-act="nav" data-id="config">Configuración y sincronización <span>›</span></button></div>
  <div class="mut small">Para instalarla en el iPhone: abre la página en Safari, toca Compartir y luego "Agregar a pantalla de inicio".</div>`;

VIEWS.categorias = () => `<div class="row between">${backBtn('mas')}<button class="primary" data-act="cat-new">+ Categoría</button></div><h1>Categorías</h1><div class="tree">` +
  topCats().map(t => `<div class="card"><div class="row between"><h3>${esc(t.nombre)} ${t.archivada ? pill('archivada') : ''}</h3><div class="row"><button class="mini" data-act="cat-new" data-id="${t.id}">+ Sub</button><button class="mini" data-act="cat-edit" data-id="${t.id}">Editar</button><button class="mini" data-act="cat-arch" data-id="${t.id}">${t.archivada ? 'Restaurar' : 'Archivar'}</button><button class="mini danger" data-act="cat-del" data-id="${t.id}">x</button></div></div>
    ${kidsOf(t.id).map(k => `<div class="row between sub" style="padding:6px 0;border-top:1px solid var(--line)"><div>${esc(k.nombre)} ${k.archivada ? pill('archivada') : ''}<div class="mut small">${esc(k.tipoCompra)} · ${k.compararPor === 'unitario' ? 'precio unitario' : 'total con envío'}</div></div><div class="row"><button class="mini" data-act="cat-edit" data-id="${k.id}">Editar</button><button class="mini" data-act="cat-arch" data-id="${k.id}">${k.archivada ? 'Restaurar' : 'Archivar'}</button><button class="mini danger" data-act="cat-del" data-id="${k.id}">x</button></div></div>`).join('')}</div>`).join('') + '</div>';

VIEWS.tiendas = () => {
  const ts = live('Tiendas').sort((a, b) => a.nombre.localeCompare(b.nombre));
  return `<div class="row between">${backBtn('mas')}<button class="primary" data-act="store-new">+ Tienda</button></div><h1>Tiendas</h1>` +
    (ts.length ? ts.map(t => `<div class="card"><div class="row between"><h3>${esc(t.nombre)}</h3><div class="row"><button class="mini" data-act="store-edit" data-id="${t.id}">Editar</button><button class="mini danger" data-act="store-del" data-id="${t.id}">x</button></div></div>
      <div class="mut small">${esc((TIPOS_TIENDA.find(x => x[0] === t.tipo) || [])[1] || '')} · envío ${t.envioPenalolen == null ? 'por cotizar' : money(t.envioPenalolen)}${t.envioGratisDesde ? ' · gratis desde ' + money(t.envioGratisDesde) : ''}${t.retiroDisponible ? ' · retiro disponible' : ''}</div></div>`).join('')
      : '<div class="empty">Las tiendas se crean solas al agregar un precio, o puedes crearlas aquí.</div>');
};

VIEWS.config = () => `<div>${backBtn('mas')}</div><h1>Configuración</h1>
  <div class="card"><h3>Reglas de precios y alertas</h3>
  <div class="mut small">Comuna: ${esc(cfg('comuna'))} · aviso sin precio: ${cfg('diasSinActualizar')} días · margen sobre mínimo: ${cfg('margenMinimo')}% · bajo promedio: ${cfg('bajoPromedio')}% · mín. observaciones: ${cfg('minObservaciones')} · silenciar alertas: ${cfg('diasSilencio')} días</div>
  <button class="ghost" style="margin-top:8px" data-act="cfg-edit">Editar reglas</button></div>
  <div class="card"><h3>Sincronización con Google Sheets</h3>
  <div class="mut small">${META.url ? 'Configurada. ' + (META.lastSync ? 'Última: ' + new Date(META.lastSync).toLocaleString('es-CL') : 'Aún sin sincronizar.') : 'No configurada.'}</div>
  <div class="row wrap" style="margin-top:8px"><button class="ghost" data-act="sync-cfg">Configurar</button><button class="primary" data-act="sync-now">Sincronizar ahora</button></div></div>
  <div class="card"><h3>Respaldo</h3><div class="row wrap" style="margin-top:8px"><button class="ghost" data-act="export">Exportar JSON</button><button class="ghost" data-act="import">Importar JSON</button></div>
  <input type="file" id="impfile" accept="application/json" hidden></div>`;

/* ---------- Render ---------- */
function render() {
  const main = $('#main');
  main.innerHTML = (VIEWS[S.view] || VIEWS.inicio)();
  $('#title').textContent = TITLES[S.view] || '';
  const nav = NAVMAP[S.view] || S.view;
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.id === nav));
  const n = computeAlerts().length, badge = $('#badge');
  badge.hidden = !n; badge.textContent = n;
  const dot = $('#syncdot'); dot.className = META.status || '';
}
function go(view, param) { S.view = view; S.param = param ?? null; render(); window.scrollTo(0, 0); }

/* ---------- Acciones ---------- */
const ACT = {};
ACT.nav = id => go(id);
ACT['prod-open'] = id => go('producto', id);
ACT['list-open'] = id => go('lista', id);

function productFields() {
  return [
    { k: 'nombre', label: 'Nombre', req: 1 },
    { k: 'categoriaId', label: 'Categoría', type: 'select', req: 1, opts: [['', 'Elegir...'], ...leafOptions()] },
    { k: 'especificacion', label: 'Especificación (marca, modelo, talla, volumen)' },
    { k: 'cantidad', label: 'Cantidad que necesitas', type: 'num' },
    { k: 'unidad', label: 'Unidad (un, kg, L...)' },
    { k: 'prioridad', label: 'Prioridad', type: 'select', opts: [['media', 'Media'], ['alta', 'Alta'], ['baja', 'Baja']] },
    { k: 'precioObjetivo', label: 'Precio objetivo (total en CLP)', type: 'num' },
    { k: 'frecuenciaDias', label: 'Recompra cada (días)', type: 'num', hint: 'Solo para productos recurrentes.' },
    { k: 'estado', label: 'Estado', type: 'select', opts: [['vigilando', 'Vigilando'], ['comprado', 'Comprado'], ['pausado', 'Pausado']] },
    { k: 'notas', label: 'Notas', type: 'area' }
  ];
}
ACT['prod-new'] = () => {
  if (!leafOptions().length) return alert('Primero crea una categoría.');
  formModal('Nuevo producto', productFields(), { prioridad: 'media', estado: 'vigilando', categoriaId: S.fcat && !rec('Categorias', S.fcat).padreId ? '' : S.fcat },
    v => { const p = { id: uid(), ultimaCompra: '', eliminado: 0, ...v }; save('Productos', p); S.view = 'producto'; S.param = p.id; });
};
ACT['prod-edit'] = id => {
  const p = rec('Productos', id);
  formModal('Editar producto', productFields(), p, v => { save('Productos', { ...p, ...v }); });
};
ACT['prod-del'] = id => {
  const p = rec('Productos', id);
  if (!confirm(`¿Eliminar "${p.nombre}" con sus links y precios?`)) return;
  live('Links').filter(l => l.productoId === id).forEach(l => remove('Links', l.id));
  live('Precios').filter(x => x.productoId === id).forEach(x => remove('Precios', x.id));
  live('ListaItems').filter(x => x.productoId === id).forEach(x => remove('ListaItems', x.id));
  remove('Productos', id); go('productos');
};
ACT['prod-bought'] = id => {
  const p = rec('Productos', id), cat = rec('Categorias', p.categoriaId);
  const rep = cat && cat.tipoCompra === 'recurrente';
  if (!confirm(rep ? `Registrar compra de "${p.nombre}". Seguirá vigilado para la próxima reposición.` : `Marcar "${p.nombre}" como comprado. Dejará de vigilarse.`)) return;
  p.ultimaCompra = today(); if (!rep) p.estado = 'comprado';
  save('Productos', p); render();
};

/* Tiendas y precios */
function storeOptions() { return [['', 'Elegir tienda...'], ...live('Tiendas').sort((a, b) => a.nombre.localeCompare(b.nombre)).map(t => [t.id, t.nombre])]; }
function priceFields(withLink) {
  const f = [];
  if (withLink) f.push(
    { k: 'tiendaId', label: 'Tienda', type: 'select', opts: storeOptions(), onchange: form => {
      const t = rec('Tiendas', form.elements.tiendaId.value); if (!t) return;
      form.elements.envio.value = t.envioPenalolen ?? ''; form.elements.envioGratisDesde.value = t.envioGratisDesde ?? '';
      form.elements.retiroDisponible.checked = !!t.retiroDisponible; form.elements.plazoEntrega.value = t.plazoEntrega || '';
    } },
    { k: 'tiendaNueva', label: 'o escribe una tienda nueva', hint: 'Se guardará con sus costos de envío para la próxima vez.' },
    { k: 'url', label: 'Link del producto', type: 'url', ph: 'https://' },
    { k: 'variante', label: 'Variante exacta (talla, color, volumen)' },
    { k: 'contenidoPack', label: 'Contenido del pack (para precio unitario)', type: 'num' },
    { k: 'unidadPack', label: 'Unidad del pack', type: 'select', opts: UNIDADES });
  f.push(
    { k: 'fecha', label: 'Fecha del precio', type: 'date', req: 1 },
    { k: 'precioContado', label: 'Precio contado', type: 'num', req: 1 },
    { k: 'precioNormal', label: 'Precio normal (si hay oferta)', type: 'num' },
    { k: 'cuotasN', label: 'Cuotas: número', type: 'num' },
    { k: 'cuotaValor', label: 'Cuotas: valor de cada una', type: 'num' },
    { k: 'sinInteres', label: 'Cuotas sin interés', type: 'check' },
    { k: 'envio', label: `Envío a ${cfg('comuna')}`, type: 'num', hint: 'Déjalo vacío si está por cotizar. 0 si es gratis.' },
    { k: 'envioGratisDesde', label: 'Envío gratis desde (compra mínima)', type: 'num' },
    { k: 'retiroDisponible', label: 'Retiro en tienda disponible (sin costo de despacho)', type: 'check' },
    { k: 'otrosCostos', label: 'Otros costos (embalaje, instalación, recargo)', type: 'num' },
    { k: 'otrosDetalle', label: 'Detalle de otros costos' },
    { k: 'plazoEntrega', label: 'Plazo de entrega' },
    { k: 'disponible', label: 'Hay stock', type: 'check' });
  return f;
}
function makePrice(link, v) {
  const p = { id: uid(), linkId: link.id, productoId: link.productoId, tiendaId: link.tiendaId, fecha: v.fecha || today(),
    precioContado: v.precioContado, precioNormal: v.precioNormal, cuotasN: v.cuotasN, cuotaValor: v.cuotaValor, sinInteres: v.sinInteres,
    envio: v.envio, envioGratisDesde: v.envioGratisDesde, retiroDisponible: v.retiroDisponible, otrosCostos: v.otrosCostos,
    otrosDetalle: v.otrosDetalle, plazoEntrega: v.plazoEntrega, disponible: v.disponible, metodo: 'manual', evidencia: '', estadoRevision: 'ok', eliminado: 0 };
  const c = costs(p); p.costoTotal = Math.round(c.best); p.modoCosto = c.modo;
  return p;
}
ACT['offer-new'] = prodId => {
  formModal('Nueva tienda y precio', priceFields(true), { fecha: today(), disponible: 1, unidadPack: '' }, v => {
    let tiendaId = v.tiendaId;
    if (v.tiendaNueva) {
      const t = { id: uid(), nombre: v.tiendaNueva, tipo: 'web', sitioWeb: '', envioPenalolen: v.envio, envioGratisDesde: v.envioGratisDesde,
        retiroDisponible: v.retiroDisponible, plazoEntrega: v.plazoEntrega, notas: '', eliminado: 0 };
      try { t.sitioWeb = new URL(v.url).origin; } catch { }
      save('Tiendas', t); tiendaId = t.id;
    }
    if (!tiendaId) { alert('Elige una tienda o escribe una nueva.'); return false; }
    const link = { id: uid(), productoId: prodId, tiendaId, url: v.url, variante: v.variante, contenidoPack: v.contenidoPack, unidadPack: v.unidadPack, estadoLink: 'ok', eliminado: 0 };
    save('Links', link); save('Precios', makePrice(link, v));
  });
};
ACT['price-new'] = linkId => {
  const l = rec('Links', linkId), last = lastPrice(linkId), t = rec('Tiendas', l.tiendaId) || {};
  const base = last ? { ...last } : { envio: t.envioPenalolen, envioGratisDesde: t.envioGratisDesde, retiroDisponible: t.retiroDisponible, plazoEntrega: t.plazoEntrega, disponible: 1 };
  base.fecha = today();
  formModal('Nuevo precio', priceFields(false), base, v => { save('Precios', makePrice(l, v)); }, 'Guardar precio');
};
ACT['price-del'] = id => { if (confirm('¿Borrar esta observación de precio?')) { remove('Precios', id); render(); } };
ACT['link-edit'] = id => {
  const l = rec('Links', id);
  formModal('Editar link', [
    { k: 'url', label: 'Link', type: 'url' }, { k: 'variante', label: 'Variante' },
    { k: 'contenidoPack', label: 'Contenido del pack', type: 'num' }, { k: 'unidadPack', label: 'Unidad del pack', type: 'select', opts: UNIDADES },
    { k: 'estadoLink', label: 'Estado del link', type: 'select', opts: ESTADOS_LINK }
  ], l, v => { save('Links', { ...l, ...v }); });
};
ACT['link-del'] = id => {
  if (!confirm('¿Quitar esta tienda del producto, con su historial de precios?')) return;
  live('Precios').filter(p => p.linkId === id).forEach(p => remove('Precios', p.id)); remove('Links', id); render();
};

/* Tiendas */
function storeFields() {
  return [
    { k: 'nombre', label: 'Nombre', req: 1 },
    { k: 'tipo', label: 'Tipo', type: 'select', opts: TIPOS_TIENDA },
    { k: 'sitioWeb', label: 'Sitio web', type: 'url', ph: 'https://' },
    { k: 'envioPenalolen', label: `Envío a ${cfg('comuna')}`, type: 'num', hint: 'Vacío = por cotizar. 0 = gratis.' },
    { k: 'envioGratisDesde', label: 'Envío gratis desde', type: 'num' },
    { k: 'retiroDisponible', label: 'Ofrece retiro en tienda', type: 'check' },
    { k: 'plazoEntrega', label: 'Plazo de entrega habitual' },
    { k: 'notas', label: 'Notas', type: 'area' }
  ];
}
ACT['store-new'] = () => formModal('Nueva tienda', storeFields(), { tipo: 'web' }, v => { save('Tiendas', { id: uid(), eliminado: 0, ...v }); });
ACT['store-edit'] = id => { const t = rec('Tiendas', id); formModal('Editar tienda', storeFields(), t, v => { save('Tiendas', { ...t, ...v }); }); };
ACT['store-del'] = id => {
  const n = live('Links').filter(l => l.tiendaId === id).length;
  if (n) return alert(`Esta tienda está en ${n} link(s). Quita esos links primero.`);
  if (confirm('¿Eliminar la tienda?')) { remove('Tiendas', id); render(); }
};

/* Categorías */
function catFields() {
  return [
    { k: 'nombre', label: 'Nombre', req: 1 },
    { k: 'padreId', label: 'Dentro de', type: 'select', opts: [['', '(Categoría principal)'], ...topCats().map(t => [t.id, t.nombre])] },
    { k: 'tipoCompra', label: 'Tipo de compra', type: 'select', opts: TIPOS_COMPRA, hint: 'Recurrente activa la frecuencia de recompra y las alertas de reposición.' },
    { k: 'compararPor', label: 'Comparar por', type: 'select', opts: COMPARAR }
  ];
}
ACT['cat-new'] = padre => formModal('Nueva categoría', catFields(), { padreId: padre || '', tipoCompra: 'unica', compararPor: 'total' },
  v => { const sibs = live('Categorias').filter(c => c.padreId === v.padreId); save('Categorias', { id: uid(), orden: sibs.length + 1, archivada: 0, eliminado: 0, ...v }); });
ACT['cat-edit'] = id => { const c = rec('Categorias', id); formModal('Editar categoría', catFields(), c, v => { if (v.padreId === id) return false; save('Categorias', { ...c, ...v }); }); };
ACT['cat-arch'] = id => { const c = rec('Categorias', id); c.archivada = c.archivada ? 0 : 1; save('Categorias', c); render(); };
ACT['cat-del'] = id => {
  const c = rec('Categorias', id);
  if (kidsOf(id).length) return alert('Tiene subcategorías. Muévelas o elimínalas primero.');
  const prods = live('Productos').filter(p => p.categoriaId === id);
  if (!prods.length) { if (confirm(`¿Eliminar "${c.nombre}"?`)) { remove('Categorias', id); render(); } return; }
  const dest = leafOptions(true).map(o => o.g ? { g: o.g, items: o.items.filter(i => i[0] !== id) } : o).filter(o => o.g ? o.items.length : o[0] !== id);
  if (!dest.length) return alert('No hay otra categoría a la que mover los productos.');
  formModal(`Mover ${prods.length} producto(s)`, [{ k: 'dest', label: 'Mover a', type: 'select', req: 1, opts: [['', 'Elegir...'], ...dest] }], {},
    v => { prods.forEach(p => save('Productos', { ...p, categoriaId: v.dest })); remove('Categorias', id); }, 'Mover y eliminar');
};

/* Listas */
ACT['list-new'] = () => formModal('Nueva lista', [{ k: 'nombre', label: 'Nombre', req: 1, ph: 'Ej: Aseo de noviembre' }], {},
  v => { const l = { id: uid(), categoriaId: '', estado: 'activa', eliminado: 0, ...v }; save('Listas', l); S.view = 'lista'; S.param = l.id; });
ACT['list-del'] = id => {
  if (!confirm('¿Eliminar la lista?')) return;
  live('ListaItems').filter(i => i.listaId === id).forEach(i => remove('ListaItems', i.id)); remove('Listas', id); go('listas');
};
ACT['list-add'] = id => {
  const ya = new Set(live('ListaItems').filter(i => i.listaId === id).map(i => i.productoId));
  const opts = live('Productos').filter(p => p.estado === 'vigilando' && !ya.has(p.id)).sort((a, b) => a.nombre.localeCompare(b.nombre))
    .map(p => { const b = bestOffer(p.id); return [p.id, `${p.nombre}${b ? ' (' + money(b.c.best) + ')' : ''}`]; });
  if (!opts.length) return alert('No hay más productos vigilados para agregar.');
  formModal('Agregar a la lista', [{ k: 'ids', label: 'Productos', type: 'multi', opts }], {},
    v => { v.ids.forEach(pid => save('ListaItems', { id: uid(), listaId: id, productoId: pid, cantidad: (rec('Productos', pid).cantidad || 1), comprado: 0, tiendaId: '', eliminado: 0 })); }, 'Agregar');
};
ACT['item-toggle'] = (id, el) => { const i = rec('ListaItems', id); i.comprado = el.checked ? 1 : 0; save('ListaItems', i); render(); };
ACT['item-del'] = id => { remove('ListaItems', id); render(); };
ACT['item-store'] = id => {
  const i = rec('ListaItems', id);
  const offs = offersOf(i.productoId).filter(o => o.price && o.price.disponible && o.tienda);
  if (!offs.length) return alert('Este producto no tiene tiendas con precio.');
  formModal('Elegir tienda', [
    { k: 'tiendaId', label: 'Tienda', type: 'select', opts: [['', 'La más barata'], ...offs.map(o => [o.tienda.id, `${o.tienda.nombre} (${money(o.c.best)})`])] },
    { k: 'cantidad', label: 'Cantidad', type: 'num', req: 1 }
  ], i, v => { save('ListaItems', { ...i, ...v }); });
};

/* Tareas: pestaña y lista rápida */
ACT.ttab = id => { S.ttab = id; render(); };
ACT['tarea-open'] = () => { S.ttab = 'plan'; go('tareas'); };
ACT['rapida-add'] = () => {
  const el = $('#rq'), texto = el ? el.value.trim() : '';
  if (!texto) return;
  save('Rapidas', { id: uid(), texto, hecho: 0, orden: Date.now(), eliminado: 0 });
  render();
  const n = $('#rq'); if (n) n.focus();
};
ACT['rapida-toggle'] = (id, el) => { const r = rec('Rapidas', id); r.hecho = el.checked ? 1 : 0; save('Rapidas', r); render(); };
ACT['rapida-edit'] = id => {
  const r = rec('Rapidas', id);
  formModal('Editar', [{ k: 'texto', label: 'Texto', req: 1 }], r, v => { save('Rapidas', { ...r, ...v }); });
};
ACT['rapida-del'] = id => { remove('Rapidas', id); render(); };
ACT['rapida-clean'] = () => {
  const hechas = live('Rapidas').filter(r => r.hecho);
  if (!hechas.length || !confirm(`¿Borrar ${hechas.length} elemento(s) hecho(s)?`)) return;
  hechas.forEach(r => remove('Rapidas', r.id)); render();
};

/* Tareas planificadas */
const tareaFields = () => [
  { k: 'titulo', label: 'Tarea', req: 1 },
  { k: 'categoriaId', label: 'Categoría', type: 'select', opts: tcatOptions() },
  { k: 'prioridad', label: 'Prioridad', type: 'select', opts: PRIORIDADES },
  { k: 'fechaLimite', label: 'Fecha para cumplir', type: 'date', hint: 'Déjala vacía si no tiene fecha.' },
  { k: 'notas', label: 'Notas', type: 'area' }
];
ACT['tarea-new'] = () => formModal('Nueva tarea', tareaFields(),
  { categoriaId: S.tcat && S.tcat !== '_none' ? S.tcat : '', prioridad: 'media', fechaLimite: '' },
  v => { save('Tareas', { id: uid(), estado: 'pendiente', fechaHecha: '', eliminado: 0, ...v }); });
ACT['tarea-edit'] = id => {
  const t = rec('Tareas', id);
  formModal('Editar tarea', tareaFields(), t, v => { save('Tareas', { ...t, ...v }); });
};
ACT['tarea-cat'] = id => {
  const t = rec('Tareas', id);
  formModal('Cambiar categoría', [{ k: 'categoriaId', label: 'Categoría', type: 'select', opts: tcatOptions() }], t, v => { save('Tareas', { ...t, ...v }); });
};
ACT['tarea-prio'] = id => {
  const t = rec('Tareas', id);
  formModal('Cambiar prioridad', [{ k: 'prioridad', label: 'Prioridad', type: 'select', opts: PRIORIDADES }], t, v => { save('Tareas', { ...t, ...v }); });
};
ACT['tarea-fecha'] = id => {
  const t = rec('Tareas', id);
  formModal('Cambiar fecha', [{ k: 'fechaLimite', label: 'Fecha para cumplir', type: 'date', hint: 'Déjala vacía para quitar la fecha.' }], t, v => { save('Tareas', { ...t, ...v }); });
};
ACT['tarea-toggle'] = (id, el) => {
  const t = rec('Tareas', id);
  t.estado = el.checked ? 'hecha' : 'pendiente';
  t.fechaHecha = el.checked ? today() : '';
  save('Tareas', t); render();
};
ACT['tarea-del'] = id => {
  const t = rec('Tareas', id);
  if (confirm(`¿Eliminar la tarea "${t.titulo}"?`)) { remove('Tareas', id); render(); }
};

/* Categorías de tareas */
ACT['tcat-new'] = () => formModal('Nueva categoría de tareas', [{ k: 'nombre', label: 'Nombre', req: 1 }], {},
  v => { save('CategoriasTareas', { id: uid(), nombre: v.nombre, orden: Math.max(0, ...tcats().map(c => c.orden || 0)) + 1, eliminado: 0 }); });
ACT['tcat-edit'] = id => {
  const c = rec('CategoriasTareas', id);
  formModal('Editar categoría', [{ k: 'nombre', label: 'Nombre', req: 1 }], c, v => { save('CategoriasTareas', { ...c, ...v }); });
};
ACT['tcat-up'] = id => {
  const l = tcats(), i = l.findIndex(c => c.id === id);
  if (i < 1) return;
  [l[i - 1], l[i]] = [l[i], l[i - 1]];
  l.forEach((c, k) => { if (c.orden !== k + 1) save('CategoriasTareas', { ...c, orden: k + 1 }); });
  render();
};
ACT['tcat-del'] = id => {
  const c = rec('CategoriasTareas', id);
  const usadas = live('Tareas').filter(t => t.categoriaId === id);
  const msg = usadas.length ? `¿Eliminar "${c.nombre}"? Sus ${usadas.length} tarea(s) quedarán sin categoría.` : `¿Eliminar "${c.nombre}"?`;
  if (!confirm(msg)) return;
  usadas.forEach(t => save('Tareas', { ...t, categoriaId: '' }));
  remove('CategoriasTareas', id); render();
};

/* Alertas */
ACT['alert-dismiss'] = (key, b) => {
  const a = rec('Alertas', key) || { id: key, eliminado: 0 };
  Object.assign(a, { tipo: b.dataset.tipo, productoId: b.dataset.prod, mensaje: '', fecha: today(), estado: 'descartada', eliminado: 0 });
  save('Alertas', a); render();
};

/* Configuración, respaldo */
ACT['cfg-edit'] = () => formModal('Reglas de precios y alertas', [
  { k: 'comuna', label: 'Comuna de despacho' },
  { k: 'diasSinActualizar', label: 'Avisar si no hay precio nuevo en (días)', type: 'num' },
  { k: 'margenMinimo', label: 'Buen momento: hasta este % sobre el mínimo histórico', type: 'num' },
  { k: 'bajoPromedio', label: 'Buen momento: al menos este % bajo el promedio de 30 días', type: 'num' },
  { k: 'minObservaciones', label: 'Mínimo de observaciones para evaluar', type: 'num' },
  { k: 'diasSilencio', label: 'Días que dura una alerta descartada', type: 'num' }
], { comuna: cfg('comuna'), diasSinActualizar: cfg('diasSinActualizar'), margenMinimo: cfg('margenMinimo'), bajoPromedio: cfg('bajoPromedio'), minObservaciones: cfg('minObservaciones'), diasSilencio: cfg('diasSilencio') },
  v => { Object.entries(v).forEach(([k, x]) => { if (x !== null && x !== '') setCfg(k, x); }); });
ACT['sync-cfg'] = () => formModal('Sincronización', [
  { k: 'url', label: 'URL de la aplicación web (Apps Script)', type: 'url', ph: 'https://script.google.com/macros/s/.../exec' },
  { k: 'token', label: 'Clave (la misma que pusiste en el script)' }
], { url: META.url, token: META.token }, v => { META.url = v.url; META.token = v.token; persistMeta(); sync(); }, 'Guardar y sincronizar');
ACT.export = () => {
  const blob = new Blob([JSON.stringify(DB, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `compras-respaldo-${today()}.json`; a.click();
};
ACT.import = () => $('#impfile').click();

/* ---------- Sincronización ---------- */
const strip = (t, r) => { const o = {}; SCHEMA[t].forEach(([c]) => o[c] = r[c] ?? ''); return o; };
function coerce(t, r) {
  const o = {};
  SCHEMA[t].forEach(([c, ty]) => {
    let v = r[c];
    if (ty === 'num') o[c] = (v === '' || v == null || isNaN(v)) ? null : Number(v);
    else if (ty === 'bool') o[c] = (v === true || v === 1 || /^(1|true|verdadero)$/i.test(String(v))) ? 1 : 0;
    else o[c] = v == null ? '' : String(v);
  });
  return o;
}
let syncing = false, syncTimer = null;
function scheduleSync() { clearTimeout(syncTimer); if (META.url) syncTimer = setTimeout(sync, 4000); }
function setStatus(s) { META.status = s; persistMeta(); const d = $('#syncdot'); if (d) d.className = s; }
async function sync() {
  if (!META.url || !META.token || syncing) return;
  if (!navigator.onLine) return setStatus('');
  syncing = true; setStatus('busy');
  try {
    const changes = [];
    SHEETS.forEach(t => DB[t].forEach(r => { if (r._d) changes.push({ sheet: t, rec: strip(t, r) }); }));
    const res = await fetch(META.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: META.token, since: META.since || '', changes }) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'error');
    const sentKeys = new Set(changes.map(c => c.sheet + '|' + c.rec[KEY(c.sheet)] + '|' + c.rec.updatedAt));
    SHEETS.forEach(t => DB[t].forEach(r => { if (r._d && sentKeys.has(t + '|' + r[KEY(t)] + '|' + r.updatedAt)) delete r._d; }));
    SHEETS.forEach(t => (data.records[t] || []).forEach(inc => {
      const n = coerce(t, inc), loc = rec(t, n[KEY(t)]);
      if (!loc || n.updatedAt > loc.updatedAt) { const i = DB[t].indexOf(loc); if (i < 0) DB[t].push(n); else DB[t][i] = n; }
    }));
    META.since = new Date(new Date(data.serverTime).getTime() - 10 * 60000).toISOString();
    META.lastSync = new Date().toISOString();
    persist(); setStatus('ok');
  } catch (e) { console.error(e); setStatus('err'); }
  syncing = false; render();
}
ACT['sync-now'] = () => {
  if (!META.url) return go('config');
  sync();
};

/* ---------- Eventos ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.type === 'checkbox') return; // se maneja en change
  const f = ACT[b.dataset.act];
  if (f) f(b.dataset.id, b);
});
document.addEventListener('change', e => {
  const b = e.target;
  if (b.matches('input[type=checkbox][data-act]')) ACT[b.dataset.act](b.dataset.id, b);
  if (b.id === 'fcat') { S.fcat = b.value; $('#plist').innerHTML = productList(); }
  if (b.id === 'tfcat') { S.tcat = b.value; render(); }
  if (b.id === 'tfprio') { S.tprio = b.value; render(); }
  if (b.id === 'impfile' && b.files[0]) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result);
        if (!Array.isArray(d.Productos) || !SHEETS.every(t => d[t] === undefined || Array.isArray(d[t]))) throw 0;
        if (!confirm('Esto reemplaza los datos de este dispositivo con el respaldo. ¿Continuar?')) return;
        SHEETS.forEach(t => { DB[t] = (d[t] || []).map(r => ({ ...r, _d: 1 })); }); persist(); scheduleSync(); render();
      } catch { alert('El archivo no es un respaldo válido.'); }
    };
    rd.readAsText(b.files[0]);
  }
});
document.addEventListener('input', e => { if (e.target.id === 'q') { S.q = e.target.value; $('#plist').innerHTML = productList(); } });
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'rq') { e.preventDefault(); ACT['rapida-add'](); } });
document.addEventListener('toggle', e => {
  if (e.target.id === 'rdone') S.rOpen = e.target.open;
  if (e.target.id === 'tdone') S.tOpen = e.target.open;
}, true);
window.addEventListener('online', sync);

/* ---------- Inicio ---------- */
load();
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
sync();
