// player.js

// --- DOM-элементы (нужны на странице) ---
// Пусть элементы приходят из index.html или подключаются через window/глобально
// (например, window.playerWrapper, window.video, и т.д.)

// Inline-видео для мобильных (обязательно для автоплея на iOS/Android)
video.setAttribute('playsinline', '');
video.setAttribute('webkit-playsinline', '');
video.autoplay = true;
video.muted    = true;

// Контролы управления
function enableControls() {
  [playPauseBtn, muteBtn, fullscreenBtn, progressContainer].forEach(el => {
    el.style.pointerEvents = '';
    el.style.opacity       = '';
  });
  progressSlider.disabled = false;
}
function disableControls() {
  [playPauseBtn, muteBtn, fullscreenBtn, progressContainer].forEach(el => {
    el.style.pointerEvents = 'none';
    el.style.opacity       = '.6';
  });
  progressSlider.disabled = true;
}

// Пользовательские контролы
function setupCustomControls() {
  playPauseBtn.addEventListener('click', () => {
    if (!readyForControl) return;
    if (!canUserAction()) return; // антиспам
    if (player.paused) player.play();
    else               player.pause();
    emitSyncState('USER');
  });
  muteBtn.addEventListener('click', () => {
    if (!readyForControl) return;
    player.muted = !player.muted;
    updateMuteIcon();
  });
  fullscreenBtn.addEventListener('click', () => {
    if (!readyForControl) return;
    const fn = player.requestFullscreen
             || player.webkitRequestFullscreen
             || player.msRequestFullscreen;
    fn && fn.call(player);
  });

  // Перемотка (scrubbing)
  let wasPlaying = false;
  progressSlider.addEventListener('mousedown', () => {
    wasPlaying = !player.paused;
  });
  progressSlider.addEventListener('input', () => {
    const pct = progressSlider.value / 100;
    player.currentTime = pct * player.duration;
  });
  progressSlider.addEventListener('mouseup', () => {
    if (!canUserAction()) return; // антиспам
    emitSyncState('USER');
    if (wasPlaying) player.play().catch(() => {});
  });

  player.addEventListener('play', updatePlayIcon);
  player.addEventListener('pause', updatePlayIcon);
  player.addEventListener('volumechange', updateMuteIcon);
}

function updateProgressBar() {
  if (!player.duration) return;
  const pct = (player.currentTime / player.duration) * 100;
  progressBar.style.width = pct + '%';
  progressSlider.value    = pct;
  currentTimeLabel.textContent = formatTime(player.currentTime);
}

function updatePlayIcon() {
  playPauseBtn.textContent = player.paused ? '▶️' : '⏸️';
}
function updateMuteIcon() {
  muteBtn.textContent = (player.muted || player.volume === 0) ? '🔇' : '🔊';
}

// Спиннер буферизации
function showSpinner() {
  if (!spinner) {
    spinner = createSpinner();
    playerWrapper.appendChild(spinner);
  }
  spinner.style.display = 'block';
}
function hideSpinner() {
  spinner && (spinner.style.display = 'none');
}
function createSpinner() {
  const s = document.createElement('div');
  s.className = 'buffer-spinner';
  s.innerHTML = `<div class="double-bounce1"></div><div class="double-bounce2"></div>`;
  s.style.display = 'none';
  return s;
}

function formatTime(t) {
  t = Math.floor(t || 0);
  if (t >= 3600) {
    return `${Math.floor(t/3600)}:${String(Math.floor((t%3600)/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
  }
  return `${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`;
}

// Вызов и инициализация при старте
window.addEventListener('DOMContentLoaded', () => {
  setupCustomControls();
  // и любые другие инит-функции
});
