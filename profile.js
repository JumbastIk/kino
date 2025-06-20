if (window.Telegram && Telegram.WebApp) {
  Telegram.WebApp.ready();
}

document.addEventListener('DOMContentLoaded', () => {
  // Для отладки — покажи, что реально приходит от Telegram
  console.log('initDataUnsafe:', window.Telegram && Telegram.WebApp && Telegram.WebApp.initDataUnsafe);

  let user = null;
  if (
    window.Telegram &&
    Telegram.WebApp &&
    Telegram.WebApp.initDataUnsafe &&
    Telegram.WebApp.initDataUnsafe.user
  ) {
    user = Telegram.WebApp.initDataUnsafe.user;
    localStorage.setItem('tgUser', JSON.stringify(user));
  } else {
    try {
      user = JSON.parse(localStorage.getItem('tgUser'));
    } catch(e) {}
  }
  if (!user) {
    user = {
      id: Math.floor(Math.random() * 1000000),
      first_name: "Гость",
      username: "guest",
      photo_url: "https://tgram.ru/wiki/stickers/img/Like/Like01.webp"
    };
  }
  document.getElementById('profileAvatar').src = user.photo_url || '';
  document.getElementById('profileName').textContent = user.first_name || 'Гость';
  document.getElementById('profileUsername').textContent = user.username ? '@' + user.username : '';
  document.getElementById('profileId').textContent = 'ID: ' + user.id;
});