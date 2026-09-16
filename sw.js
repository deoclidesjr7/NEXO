// Service Worker do CZK MAKI — responsável por receber os pushes
// e exibir a notificação, mesmo com o navegador fechado ou em segundo plano.
// (lógica de push/notificationclick abaixo é a mesma que já estava em produção)
//
// A PARTIR DAQUI FOI ADICIONADO: pré-cache da "casca" do app + estratégias de
// cache, pra deixar o carregamento rápido (tipo iFood) mesmo em rede ruim:
//   - CacheFirst  -> arquivos estáticos do próprio site (HTML, CSS, JS, ícones)
//   - NetworkFirst -> chamadas ao Supabase (dado sempre fresco; só usa cache
//                     salvo se o cliente estiver offline)

const CZK_CACHE_VERSION = 'v1';
const CZK_STATIC_CACHE = `czk-maki-static-${CZK_CACHE_VERSION}`;

// Host do projeto Supabase usado pelo app (mesmo valor de CZK_SUPABASE_URL no app.js).
const CZK_SUPABASE_HOST = 'bkhtnnxcwlfytvhyeojm.supabase.co';

// Arquivos essenciais da "casca" do app: sem eles a tela nem monta.
// Pré-cacheados assim que o Service Worker instala, antes de precisar deles.
const CZK_APP_SHELL = [
    '/',
    '/index.html',
    '/app.js',
    '/tailwind-prod.css',
    '/manifest.json'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CZK_STATIC_CACHE).then((cache) => {
            // Alguns desses arquivos podem eventualmente não existir (ex: ícone
            // renomeado); addAll falha tudo-ou-nada, então cacheamos um por um
            // pra um problema pontual não impedir o resto da casca de ser salva.
            return Promise.all(
                CZK_APP_SHELL.map((url) =>
                    cache.add(url).catch((e) => console.warn('[SW] Não consegui pré-cachear', url, e))
                )
            );
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            self.clients.claim(),
            // Limpa versões antigas do cache estático (de um deploy anterior),
            // sem mexer em nenhum outro cache que porventura exista.
            caches.keys().then((nomes) =>
                Promise.all(
                    nomes
                        .filter((nome) => nome.startsWith('czk-maki-static-') && nome !== CZK_STATIC_CACHE)
                        .map((nome) => caches.delete(nome))
                )
            )
        ])
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;

    // Nunca mexe em métodos que alteram dado (POST/PUT/DELETE) — pedidos,
    // pagamentos, upserts etc. continuam indo direto pra rede, sem cache.
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // NetworkFirst: chamadas ao Supabase (REST, Edge Functions, Storage).
    if (url.hostname === CZK_SUPABASE_HOST) {
        event.respondWith(czkNetworkFirst(req));
        return;
    }

    // CacheFirst: arquivos estáticos do próprio site (mesma origem).
    if (url.origin === self.location.origin) {
        event.respondWith(czkCacheFirst(req));
        return;
    }

    // Qualquer outra origem (CDNs de terceiros como fontes, ícones, SDKs
    // carregados sob demanda) segue o comportamento padrão do navegador —
    // o Service Worker não interfere.
});

async function czkCacheFirst(req) {
    const cacheada = await caches.match(req);
    if (cacheada) return cacheada;
    try {
        const resposta = await fetch(req);
        if (resposta && resposta.ok) {
            const cache = await caches.open(CZK_STATIC_CACHE);
            cache.put(req, resposta.clone());
        }
        return resposta;
    } catch (e) {
        return cacheada || Response.error();
    }
}

async function czkNetworkFirst(req) {
    try {
        const resposta = await fetch(req);
        if (resposta && resposta.ok) {
            const cache = await caches.open(CZK_STATIC_CACHE);
            cache.put(req, resposta.clone());
        }
        return resposta;
    } catch (e) {
        const cacheada = await caches.match(req);
        if (cacheada) return cacheada;
        throw e;
    }
}

// =========================================================================
// A PARTIR DAQUI: lógica original de push, 100% preservada sem nenhuma
// alteração de comportamento.
// =========================================================================

// Chega um push do servidor (enviado pela Edge Function "enviar-push")
self.addEventListener('push', (event) => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch (e) {
        payload = { titulo: 'CZK MAKI', corpo: event.data ? event.data.text() : '' };
    }

    const titulo = payload.titulo || 'CZK MAKI';
    const opcoes = {
        body: payload.corpo || '',
        icon: payload.icon || 'https://images.unsplash.com/photo-1579584425555-c3ce17fd4351?q=80&w=200',
        badge: payload.icon || undefined,
        data: payload.dados || {},
        vibrate: [100, 50, 100]
    };

    event.waitUntil(self.registration.showNotification(titulo, opcoes));
});

// Clique na notificação: foca ou abre a aba do app
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if ('focus' in client) return client.focus();
            }
            if (self.clients.openWindow) return self.clients.openWindow('./');
        })
    );
});
