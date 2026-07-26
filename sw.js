const CACHE_NAME = 'study-guard-v5'
const SCOPE_URL = new URL(self.registration.scope)
const SCOPE_PATH = SCOPE_URL.pathname
const BASE_PATH = SCOPE_PATH.endsWith('/') ? SCOPE_PATH : `${SCOPE_PATH}/`
const PACKED_MODEL_PATH = `${BASE_PATH}ai-models/Qwen2.5-1.5B-Instruct-q4f16_1-MLC/resolve/main/params_shard_0.bin`
const APP_SHELL = [
  BASE_PATH,
  `${BASE_PATH}index.html`,
  `${BASE_PATH}manifest.webmanifest`,
  `${BASE_PATH}icon.svg`,
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  )
  self.clients.claim()
})

async function unpackModelShard(requestUrl) {
  const responses = await Promise.all([
    fetch(`${requestUrl.href}.gz.part0`),
    fetch(`${requestUrl.href}.gz.part1`),
  ])
  if (responses.some((response) => !response.ok || !response.body)) {
    throw new Error('模型分片下載失敗')
  }

  const streams = responses.map((response) =>
    response.body.pipeThrough(new DecompressionStream('gzip')))
  const body = new ReadableStream({
    async start(controller) {
      try {
        for (const stream of streams) {
          const reader = stream.getReader()
          while (true) {
            const chunk = await reader.read()
            if (chunk.done) break
            controller.enqueue(chunk.value)
          }
        }
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })

  return new Response(body, {
    headers: {
      'Content-Type': 'application/octet-stream',
    },
  })
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const requestUrl = new URL(event.request.url)
  if (
    requestUrl.origin === SCOPE_URL.origin
    && requestUrl.pathname === PACKED_MODEL_PATH
  ) {
    event.respondWith(unpackModelShard(requestUrl))
    return
  }
  if (
    requestUrl.origin === SCOPE_URL.origin
    && requestUrl.pathname.startsWith(`${BASE_PATH}ai-models/`)
  ) {
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
          return response
        })
        .catch(async () =>
          (await caches.match(event.request)) ||
          (await caches.match(`${BASE_PATH}index.html`)) ||
          Response.error(),
        ),
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
          return response
        }),
    ),
  )
})
