# Nuvio FrikiSeries — adaptación comunitaria

Este repositorio está estructurado como un **plugin de proveedores de Nuvio** (`manifest.json` + `providers/frikiseries.js`), no como addon de Stremio ni como plugin nativo de Kino.

## Qué hace esta versión

- Recibe el TMDB ID que Nuvio entrega al proveedor.
- Usa la TMDB API para obtener el título y año; la clave se configura en los ajustes del proveedor.
- Busca una coincidencia de título en el catálogo público que referencia el proyecto original.
- Para series, intenta encontrar el episodio por temporada y número.
- Resuelve enlaces OK.ru a MP4/HLS cuando la página entrega esos datos y devuelve enlaces directos MP4/HLS cuando los reconoce.

## Limitaciones que deben conocerse

- **No se ha probado dentro de Nuvio ni contra la web en vivo desde este entorno.** La fuente puede cambiar, bloquear peticiones o tener enlaces caducados.
- La coincidencia de títulos es conservadora: si no encuentra una coincidencia suficientemente clara, devuelve cero resultados en vez de seleccionar otro título.
- Los maratones completos solo se ofrecen para T1E1 porque no son episodios separados.
- Los enlaces de VK que no son directos no se resuelven.
- El ZIP de referencia proporcionado no incluía un archivo LICENSE. Antes de publicar una distribución derivada, revisa la licencia vigente del repositorio original y conserva sus avisos de autoría.

## Licencia

Adaptación comunitaria. Referencia de origen: https://github.com/stanpx/kino-plugin-frikiseries
