// 별일없지? 서비스 워커: 푸시 알림 받기 + 앱 아이콘 숫자(배지)
// 화면 파일은 저장(캐시)하지 않아요. 항상 최신 앱이 열리게.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  e.waitUntil((async () => {
    // 아이콘 숫자 (아이폰·컴퓨터. 안드로이드는 알림이 있으면 폰이 알아서 표시)
    if (self.navigator && self.navigator.setAppBadge) {
      try {
        if (d.badge > 0) await self.navigator.setAppBadge(d.badge);
        else await self.navigator.clearAppBadge();
      } catch (_) {}
    }
    await self.registration.showNotification(d.title || '별일없지?', {
      body: d.body || '새 소식이 왔어요',
      tag: d.tag || 'byeolil',
      icon: 'icons/icon-192.png',
      data: { url: d.url || './' },
    });
  })());
});

// 알림을 누르면 앱을 열어요 (이미 열려 있으면 그 창으로)
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) { await w.focus(); return; }
    }
    await self.clients.openWindow(url);
  })());
});
