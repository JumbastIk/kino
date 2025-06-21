document.addEventListener('DOMContentLoaded', () => {
  // Telegram WebApp SDK должен быть загружен!
  if (!(window.Telegram && Telegram.WebApp)) {
    document.body.innerHTML = '<div style="color:#f55;padding:32px;text-align:center;font-size:18px;">Откройте приложение через Telegram</div>';
    return;
  }

  // Инициализация Telegram Mini App
  Telegram.WebApp.ready();

  // Иногда Telegram.WebApp.initDataUnsafe.user появляется не сразу, поэтому ждём чуть-чуть
  setTimeout(() => {
    const tgUser = Telegram.WebApp.initDataUnsafe && Telegram.WebApp.initDataUnsafe.user;
    // Для отладки
    // console.log('tgUser:', tgUser);

    if (!tgUser) {
      document.body.innerHTML = '<div style="color:#f55;padding:32px;text-align:center;font-size:18px;">Ошибка: Запустите приложение через Telegram</div>';
      if (Telegram.WebApp.close) Telegram.WebApp.close();
      return;
    }

    document.getElementById('profileAvatar').src = tgUser.photo_url || '';
    document.getElementById('profileName').textContent = tgUser.first_name || '';
    document.getElementById('profileUsername').textContent = tgUser.username ? '@' + tgUser.username : '';
    document.getElementById('profileId').textContent = 'ID: ' + tgUser.id;
  }, 100); // 100 мс задержка — помогает при медленной инициализации
});