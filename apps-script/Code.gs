/**
 * API de sincronización para la app Compras.
 * Se instala dentro del Google Sheet (Extensiones > Apps Script).
 *
 * Cada hoja tiene los encabezados en la fila 1. La primera columna es la clave
 * (id, o clave en la hoja Config). Gana el registro con updatedAt más reciente.
 * La clave de acceso se guarda en Propiedades del script (TOKEN), no en el código.
 */

function doGet() {
  return json_({ ok: true, msg: 'API Compras activa' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    var body = JSON.parse(e.postData.contents);
    var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || body.token !== token) return json_({ ok: false, error: 'token invalido' });

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var since = body.since || '';
    var changes = body.changes || [];
    var bySheet = {};
    changes.forEach(function (c) { (bySheet[c.sheet] = bySheet[c.sheet] || []).push(c.rec); });

    // Si llegan cambios para una hoja que no existe, avisar para que la app no los dé por enviados.
    var missing = Object.keys(bySheet).filter(function (n) { return !ss.getSheetByName(n); });
    if (missing.length) return json_({ ok: false, error: 'Faltan hojas: ' + missing.join(', ') + '. Ejecuta crearHojasNuevas() en el script.' });

    var records = {};
    ss.getSheets().forEach(function (sh) {
      var name = sh.getName();
      var range = sh.getDataRange();
      var values = range.getValues();
      if (!values.length || !values[0][0]) return;
      var headers = values[0].map(String);
      var keyCol = 0, updCol = headers.indexOf('updatedAt');
      if (updCol < 0) return;

      var dirty = false;

      // Agrega al final las columnas nuevas que la app envía y la hoja todavía no tiene.
      var inc0 = (bySheet[name] || [])[0];
      if (inc0) {
        Object.keys(inc0).forEach(function (k) {
          if (headers.indexOf(k) < 0) {
            headers.push(k);
            values.forEach(function (row, i) { row.push(i === 0 ? k : ''); });
            dirty = true;
          }
        });
      }

      var index = {};
      for (var r = 1; r < values.length; r++) index[String(values[r][keyCol])] = r;

      (bySheet[name] || []).forEach(function (inc) {
        var key = String(inc[headers[keyCol]]);
        if (!key) return;
        var row = headers.map(function (h) { var v = inc[h]; return v === null || v === undefined ? '' : String(v); });
        if (key in index) {
          var cur = String(values[index[key]][updCol]);
          if (cur > String(inc.updatedAt)) return; // lo guardado es más nuevo
          values[index[key]] = row;
        } else {
          values.push(row);
          index[key] = values.length - 1;
        }
        dirty = true;
      });

      if (dirty) {
        var target = sh.getRange(1, 1, values.length, headers.length);
        target.setNumberFormat('@');           // todo como texto, evita que Sheets convierta fechas
        target.setValues(values.map(function (row) {
          return row.map(function (v) { return v === null || v === undefined ? '' : String(v); });
        }));
      }

      var out = [];
      for (var i = 1; i < values.length; i++) {
        if (String(values[i][updCol]) > since) {
          var o = {};
          headers.forEach(function (h, c) { o[h] = values[i][c]; });
          out.push(o);
        }
      }
      records[name] = out;
    });

    return json_({ ok: true, serverTime: new Date().toISOString(), records: records });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) { }
  }
}

/**
 * Ejecutar una sola vez desde el editor de Apps Script (botón Ejecutar).
 * Crea las hojas de tareas con sus encabezados si todavía no existen.
 * Debe coincidir con schema.js.
 */
function crearHojasNuevas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var def = {
    Rapidas: ['id', 'texto', 'hecho', 'orden', 'updatedAt', 'eliminado'],
    CategoriasTareas: ['id', 'nombre', 'orden', 'updatedAt', 'eliminado'],
    Tareas: ['id', 'titulo', 'notas', 'categoriaId', 'prioridad', 'fechaLimite', 'estado', 'fechaHecha', 'updatedAt', 'eliminado']
  };
  Object.keys(def).forEach(function (n) {
    var sh = ss.getSheetByName(n) || ss.insertSheet(n);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, def[n].length).setValues([def[n]]);
      sh.setFrozenRows(1);
    }
  });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
