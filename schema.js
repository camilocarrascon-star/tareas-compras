const SCHEMA = {
  "Categorias": [["id","text"],["nombre","text"],["padreId","text"],["tipoCompra","text"],["compararPor","text"],["orden","num"],["archivada","bool"],["updatedAt","text"],["eliminado","bool"]],
  "Productos": [["id","text"],["nombre","text"],["categoriaId","text"],["especificacion","text"],["cantidad","num"],["unidad","text"],["prioridad","text"],["precioObjetivo","num"],["frecuenciaDias","num"],["ultimaCompra","text"],["estado","text"],["notas","text"],["updatedAt","text"],["eliminado","bool"]],
  "Tiendas": [["id","text"],["nombre","text"],["tipo","text"],["sitioWeb","text"],["envioPenalolen","num"],["envioGratisDesde","num"],["retiroDisponible","bool"],["plazoEntrega","text"],["notas","text"],["updatedAt","text"],["eliminado","bool"],["categorias","text"]],
  "Links": [["id","text"],["productoId","text"],["tiendaId","text"],["url","text"],["variante","text"],["contenidoPack","num"],["unidadPack","text"],["estadoLink","text"],["updatedAt","text"],["eliminado","bool"]],
  "Precios": [["id","text"],["linkId","text"],["productoId","text"],["tiendaId","text"],["fecha","text"],["precioContado","num"],["precioNormal","num"],["cuotasN","num"],["cuotaValor","num"],["sinInteres","bool"],["envio","num"],["envioGratisDesde","num"],["retiroDisponible","bool"],["otrosCostos","num"],["otrosDetalle","text"],["plazoEntrega","text"],["disponible","bool"],["metodo","text"],["evidencia","text"],["estadoRevision","text"],["costoTotal","num"],["modoCosto","text"],["updatedAt","text"],["eliminado","bool"]],
  "Listas": [["id","text"],["nombre","text"],["categoriaId","text"],["estado","text"],["updatedAt","text"],["eliminado","bool"]],
  "ListaItems": [["id","text"],["listaId","text"],["productoId","text"],["cantidad","num"],["comprado","bool"],["tiendaId","text"],["updatedAt","text"],["eliminado","bool"]],
  "Alertas": [["id","text"],["tipo","text"],["productoId","text"],["mensaje","text"],["fecha","text"],["estado","text"],["updatedAt","text"],["eliminado","bool"]],
  "Config": [["clave","text"],["valor","text"],["updatedAt","text"],["eliminado","bool"]],
  "Rapidas": [["id","text"],["texto","text"],["hecho","bool"],["orden","num"],["updatedAt","text"],["eliminado","bool"]],
  "CategoriasTareas": [["id","text"],["nombre","text"],["orden","num"],["updatedAt","text"],["eliminado","bool"]],
  "Tareas": [["id","text"],["titulo","text"],["notas","text"],["categoriaId","text"],["prioridad","text"],["fechaLimite","text"],["estado","text"],["fechaHecha","text"],["updatedAt","text"],["eliminado","bool"]]
};
