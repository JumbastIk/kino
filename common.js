// == BACKEND URL, RoomID ==
const BACKEND = 'https://kino-fhwp.onrender.com';

// Глобальный socket (единственный на страницу)
window.socket = io(BACKEND, {
  path: '/socket.io',
  transports: ['websocket']
});

// RoomID из query-параметров
window.params = new URLSearchParams(location.search);
window.roomId = params.get('roomId');

// == DOM Elements ==
window.playerWrapper     = document.getElementById('playerWrapper');
window.video             = document.getElementById('videoPlayer');
window.playPauseBtn      = document.getElementById('playPauseBtn');
window.muteBtn           = document.getElementById('muteBtn');
window.fullscreenBtn     = document.getElementById('fullscreenBtn');
window.progressSlider    = document.getElementById('progressSlider');
window.progressContainer = document.getElementById('progressContainer');
window.progressBar       = document.getElementById('progressBar');
window.currentTimeLabel  = document.getElementById('currentTimeLabel');
window.durationLabel     = document.getElementById('durationLabel');
window.messagesBox       = document.getElementById('messages');
window.membersList       = document.getElementById('membersList');
window.msgInput          = document.getElementById('msgInput');
window.sendBtn           = document.getElementById('sendBtn');
window.backLink          = document.getElementById('backLink');
window.roomIdCode        = document.getElementById('roomIdCode');
window.copyRoomId        = document.getElementById('copyRoomId');

// == StatusBar ==
const statusBar = document.createElement('div');
statusBar.style.position = 'fixed';
statusBar.style.bottom = '18px';
statusBar.style.left = '50%';
statusBar.style.transform = 'translateX(-50%)';
statusBar.style.padding = '10px 18px';
statusBar.style.background = '#23232cde';
statusBar.style.color = '#ff9696';
statusBar.style.zIndex = '20000';
statusBar.style.fontSize = '15px';
statusBar.style.borderRadius = '18px';
statusBar.style.display = 'none';
document.body.appendChild(statusBar);
window.showStatus = function(msg, color = '#ff9696', btnText = '', btnHandler = null) {
  statusBar.textContent = msg;
  statusBar.style.background = color;
  statusBar.style.display = '';
  if (btnText && typeof btnHandler === 'function') {
    const btn = document.createElement('button');
    btn.textContent = btnText;
    btn.style.marginLeft = '15px';
    btn.style.background = '#fff2';
    btn.style.border = 'none';
    btn.style.borderRadius = '8px';
    btn.style.padding = '2px 10px';
    btn.style.color = '#ffb';
    btn.style.cursor = 'pointer';
    btn.onclick = btnHandler;
    statusBar.appendChild(btn);
  }
};
window.hideStatus = function() {
  statusBar.style.display = 'none';
};

// == State Variables ==
window.player            = video;
window.spinner           = null;
window.myUserId          = null;
window.metadataReady     = false;
window.lastSyncLog       = 0;
window.ignoreSyncEvent   = false;
window.syncErrorTimeout  = null;
window.readyForControl   = false;
window.lastUserAction    = 0;
window.wasPausedOnHide   = true;
window.allMembers        = [];
window.userTimeMap       = {};
window.userPingMap       = {};

// == UTILS ==
window.canUserAction = function() {
  let now = Date.now();
  if (now - lastUserAction < 300) return false;
  lastUserAction = now;
  return true;
};
window.escapeHtml = function(str) {
  return String(str).replace(/[&<>"'`=\/]/g, function(s) {
    return ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;',
      '=': '&#61;', '/': '&#47;'
    })[s];
  });
};
window.logError = function(msg, err) {
  console.error('[Room Error]', msg, err || '');
};
window.logOnce = function(msg) {
  const now = Date.now();
  if (now - lastSyncLog > 600) {
    console.log(msg);
    lastSyncLog = now;
  }
};
window.formatTime = function(t) {
  t = Math.floor(t || 0);
  if (t >= 3600) {
    return `${Math.floor(t/3600)}:${String(Math.floor((t%3600)/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
  }
  return `${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`;
};
