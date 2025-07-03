// common.js

const BACKEND = 'https://kino-fhwp.onrender.com';
const socket = io(BACKEND, { path: '/socket.io', transports: ['websocket'] });
const params = new URLSearchParams(location.search);
const roomId = params.get('roomId');

const playerWrapper     = document.getElementById('playerWrapper');
const video             = document.getElementById('videoPlayer');
const player            = video; // Обязательно!

const playPauseBtn      = document.getElementById('playPauseBtn');
const muteBtn           = document.getElementById('muteBtn');
const fullscreenBtn     = document.getElementById('fullscreenBtn');
const progressSlider    = document.getElementById('progressSlider');
const progressContainer = document.getElementById('progressContainer');
const progressBar       = document.getElementById('progressBar');
const currentTimeLabel  = document.getElementById('currentTimeLabel');
const durationLabel     = document.getElementById('durationLabel');
const messagesBox       = document.getElementById('messages');
const membersList       = document.getElementById('membersList');
const msgInput          = document.getElementById('msgInput');
const sendBtn           = document.getElementById('sendBtn');
const backLink          = document.getElementById('backLink');
const roomIdCode        = document.getElementById('roomIdCode');
const copyRoomId        = document.getElementById('copyRoomId');

// === Состояния ===
let spinner;
let myUserId          = null;
let metadataReady     = false;
let lastSyncLog       = 0;
let ignoreSyncEvent   = false, syncErrorTimeout = null;
let readyForControl   = false;
let lastUserAction    = 0;
let wasPausedOnHide   = true;
let allMembers        = [];
let userTimeMap       = {};
let userPingMap       = {};
let planBAttempts     = 0;

// === StatusBar ===
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

function showStatus(msg, color = '#ff9696', btnText = '', btnHandler = null) {
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
}
function hideStatus() { statusBar.style.display = 'none'; }

function canUserAction() {
  let now = Date.now();
  if (now - lastUserAction < 300) return false;
  lastUserAction = now;
  return true;
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"'`=\/]/g, function(s) {
    return ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;',
      '=': '&#61;', '/': '&#47;'
    })[s];
  });
}
function logError(msg, err) {
  console.error('[Room Error]', msg, err || '');
}
function logOnce(msg) {
  const now = Date.now();
  if (now - lastSyncLog > 600) {
    console.log(msg);
    lastSyncLog = now;
  }
}
function formatTime(t) {
  t = Math.floor(t || 0);
  if (t >= 3600) {
    return `${Math.floor(t/3600)}:${String(Math.floor((t%3600)/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
  }
  return `${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`;
}
