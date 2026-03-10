/**
 * Route external API calls through the local CORS proxy.
 * Falls back to direct fetch if proxy is unreachable.
 */
const PROXY = 'http://localhost:8001/proxy?url=';

export function proxied(url) {
  return PROXY + encodeURIComponent(url);
}
