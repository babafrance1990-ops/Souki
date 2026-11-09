// Point d'entrée Cloudflare Worker : /api/* → serveur Souki, le reste → fichiers du dossier public/.
import { onRequest } from './api.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return onRequest({ request, env, ctx });
    return env.ASSETS.fetch(request);
  },
};
