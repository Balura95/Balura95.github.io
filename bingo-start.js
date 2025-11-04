// ===== bingo-start.js (FIX für Anzeige + korrekte Segment-Auswahl + Pulse-Abbruch) =====

let cachedPlaylistTracks = [];
let selectedTrackUri = null;
let spotifyReady = null;

// DOM / Wheel
let canvasEl = null;
let wheelContainer = null;
let wheelCtx = null;
let categories = [];

// State
let hasSpun = false;
let hasPulsed = false;
let currentAngle = 0; // radians

// Pulse timers / resolver
let pulseTimeoutYellow = null;
let pulseTimeoutRed = null;
let pulseResolver = null;

// Buzzer element (from HTML)
const buzzerEl = typeof document !== 'undefined' ? document.getElementById('buzzer-sound') : null;

/* ----------------- Spotify / Playlist (unverändert) ----------------- */
function extractPlaylistId(url){
  if(!url) return null;
  let m = url.match(/spotify:playlist:([A-Za-z0-9-_]+)/);
  if(m) return m[1];
  m = url.match(/playlist\/([A-Za-z0-9-_]+)/);
  if(m) return m[1];
  m = url.match(/[?&]id=([A-Za-z0-9-_]+)/);
  return m ? m[1] : null;
}

async function fetchPlaylistTracks(playlistId){
  const token = localStorage.getItem('access_token');
  if(!token) return [];
  const all = [];
  const limit = 50;
  let offset = 0;
  try {
    const metaResp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!metaResp.ok) return [];
    const meta = await metaResp.json();
    const total = meta.tracks?.total || 0;
    while (offset < total) {
      const resp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (!resp.ok) break;
      const data = await resp.json();
      const valid = (data.items || []).filter(i => i && i.track && i.track.uri && !i.is_local);
      all.push(...valid);
      offset += limit;
      if (!data.items || data.items.length === 0) break;
    }
  } catch (e) {
    console.error('fetchPlaylistTracks error', e);
  }
  return all;
}

spotifyReady = new Promise(resolve => {
  window.onSpotifyWebPlaybackSDKReady = () => {
    const token = localStorage.getItem('access_token');
    if (!token) { resolve(); return; }
    const player = new Spotify.Player({
      name: 'Julster Bingo Player',
      getOAuthToken: cb => cb(token)
    });
    player.addListener('ready', ({ device_id }) => {
      window.deviceId = device_id;
      window.bingoPlayer = player;
      resolve();
    });
    player.connect().catch(() => resolve());
  };
});

async function playTrack(uri){
  const token = localStorage.getItem('access_token');
  if(!token) return false;
  await spotifyReady;
  let wait = 0;
  while (!window.deviceId && wait < 6000) { await new Promise(r => setTimeout(r,200)); wait += 200; }
  try {
    const dev = window.deviceId ? `?device_id=${window.deviceId}` : '';
    const resp = await fetch(`https://api.spotify.com/v1/me/player/play${dev}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri] })
    });
    return resp.status === 204;
  } catch (e) { console.error('playTrack error', e); return false; }
}

async function stopPlayback(){
  const token = localStorage.getItem('access_token');
  if(!token) return;
  try {
    await fetch('https://api.spotify.com/v1/me/player/pause', { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` }});
  } catch (e) { console.warn('stopPlayback error', e); }
}

function getRandomTrack(arr){ if(!arr || !arr.length) return null; return arr[Math.floor(Math.random()*arr.length)]; }

/* ----------------- Track details UI + "Nächstes Lied" ----------------- */
function updateTrackDetailsElement(track){
  const details = document.getElementById('track-details');
  if(!details) return;
  let expanded = false;
  details.textContent = 'Songinfos auflösen';
  details.onclick = () => {
    if(!expanded){
      details.innerHTML = `
        <div>
          <p><strong>Titel:</strong> ${track.name}</p>
          <p><strong>Interpret:</strong> ${track.artists.map(a=>a.name).join(', ')}</p>
          <p><strong>Album:</strong> ${track.album.name || ''}</p>
          <p><strong>Jahr:</strong> ${track.album.release_date ? track.album.release_date.substring(0,4) : ''}</p>
        </div>
      `;
      const btn = document.createElement('button');
      btn.className = 'btn details-weiter-btn green';
      btn.textContent = 'Nächstes Lied';
      btn.type = 'button';
      details.appendChild(btn);

      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        // 1) stoppt Playback
        await stopPlayback();
        // 2) bricht Pulsation ab (inkl. Buzzer als Feedback)
        stopPulse(true);
        // 3) reset flags & UI
        hasSpun = false;
        hasPulsed = false;
        document.getElementById('now-playing').style.display = 'none';
        document.getElementById('selected-category').textContent = '';
        // reset wheel visual
        canvasEl.style.transition = 'none';
        canvasEl.style.transform = 'rotate(0deg)';
        currentAngle = 0;
        // slight delay then redraw to avoid visual glitch
        setTimeout(() => { setupCanvas(); drawWheel(); }, 20);
      });

      expanded = true;
    } else {
      details.textContent = 'Songinfos auflösen';
      expanded = false;
    }
  };
}

/* ----------------- Canvas setup + draw ----------------- */
function setupCanvas(){
  canvasEl = document.getElementById('wheel-canvas');
  if(!canvasEl) return;
  // size based on computed css size
  const rect = canvasEl.getBoundingClientRect();
  const dpr = Math.max(window.devicePixelRatio || 1, 1);
  const size = Math.round(rect.width);
  canvasEl.width = size * dpr;
  canvasEl.height = size * dpr;
  canvasEl.style.width = rect.width + 'px';
  canvasEl.style.height = rect.width + 'px';
  wheelCtx = canvasEl.getContext('2d');
  wheelCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawWheel(){
  if(!canvasEl) setupCanvas();
  if(!wheelCtx) return;
  const dpr = Math.max(window.devicePixelRatio || 1, 1);
  const cssSize = canvasEl.width / dpr;
  const cx = cssSize/2;
  const r = cssSize/2;
  const n = Math.max(categories.length, 1);
  const arc = (2 * Math.PI) / n;

  wheelCtx.clearRect(0,0,canvasEl.width/dpr, canvasEl.height/dpr);
  const palette = ['#ffd8cc','#e6f7ff','#e8e8ff','#dfffe6','#fff7d9','#fde2f3','#e6f2ff','#e9f8f3'];

  for(let i=0;i<n;i++){
    const start = i*arc;
    const end = (i+1)*arc;
    wheelCtx.beginPath();
    wheelCtx.moveTo(cx, cx);
    wheelCtx.arc(cx, cx, r, start, end);
    wheelCtx.closePath();
    wheelCtx.fillStyle = palette[i % palette.length];
    wheelCtx.fill();
    wheelCtx.strokeStyle = 'rgba(0,0,0,0.06)';
    wheelCtx.lineWidth = 1;
    wheelCtx.stroke();

    // text larger & truncated if needed
    wheelCtx.save();
    wheelCtx.translate(cx, cx);
    wheelCtx.rotate(start + arc/2);
    wheelCtx.textAlign = 'right';
    wheelCtx.fillStyle = '#222';
    const fontSize = Math.max(12, Math.floor(cssSize / 20));
    wheelCtx.font = `bold ${fontSize}px Roboto, Arial`;
    let text = categories[i] || `Kategorie ${i+1}`;
    // truncate text until it fits
    while (wheelCtx.measureText(text).width > r * 0.95 && text.length > 0) text = text.slice(0, -1);
    if (text.length < (categories[i] || '').length) text = text.slice(0, -1) + '…';
    wheelCtx.fillText(text, r - 10, fontSize/3);
    wheelCtx.restore();
  }
}

/* ----------------- Deterministic spin -> chosen index ----------------- */
function spinWheelAsync(){
  return new Promise(resolve => {
    const n = Math.max(categories.length, 1);
    const segmentAngle = (2 * Math.PI) / n;
    // chosen index
    const chosen = Math.floor(Math.random() * n);
    const thetaChosen = chosen * segmentAngle + segmentAngle / 2;
    const rotations = 5 + Math.floor(Math.random() * 3); // 5..7
    const base = (-Math.PI / 2 - thetaChosen);
    const jitter = (Math.random() * 0.2) - 0.1;
    const finalDelta = rotations * 2 * Math.PI + base + jitter;

    currentAngle += finalDelta;
    const deg = currentAngle * 180 / Math.PI;
    canvasEl.style.transition = 'transform 4.6s cubic-bezier(0.33,1,0.68,1)';
    canvasEl.style.transform = `rotate(${deg}deg)`;

    const onEnd = (e) => {
      if (e.propertyName !== 'transform') return;
      canvasEl.removeEventListener('transitionend', onEnd);
      resolve(chosen);
    };
    canvasEl.addEventListener('transitionend', onEnd);
  });
}

/* ----------------- Pulsation (abbrechbar) ----------------- */
function pulseWheel(){
  return new Promise(resolve => {
    const container = document.getElementById('wheel-container');
    // safety: clear any previous
    stopPulse(false);

    container.classList.add('pulse-yellow');
    pulseResolver = resolve;

    pulseTimeoutYellow = setTimeout(() => {
      container.classList.remove('pulse-yellow');
      container.classList.add('pulse-red');

      pulseTimeoutRed = setTimeout(() => {
        container.classList.remove('pulse-red');
        // natural end => play buzzer
        try { if (buzzerEl) { buzzerEl.currentTime = 0; buzzerEl.play().catch(()=>{}); } } catch(e){}
        const r = pulseResolver; pulseResolver = null;
        resolve();
      }, 5000);
    }, 15000);
  });
}

// stopPulse(aborted=true) -> clears timers and resolves pending promise; plays buzzer if aborted===true
function stopPulse(aborted = true){
  const container = document.getElementById('wheel-container');
  if(container) container.classList.remove('pulse-yellow','pulse-red');
  if(pulseTimeoutYellow){ clearTimeout(pulseTimeoutYellow); pulseTimeoutYellow = null; }
  if(pulseTimeoutRed){ clearTimeout(pulseTimeoutRed); pulseTimeoutRed = null; }
  if(pulseResolver){
    const r = pulseResolver; pulseResolver = null;
    if (aborted) {
      try { if (buzzerEl) { buzzerEl.currentTime = 0; buzzerEl.play().catch(()=>{}); } } catch(e){}
    }
    r(); // resolve the pulse promise immediately
  }
}

/* ----------------- Main initialization ----------------- */
document.addEventListener('DOMContentLoaded', async () => {
  canvasEl = document.getElementById('wheel-canvas');
  wheelContainer = document.getElementById('wheel-container');

  const loading = document.getElementById('loading-text');
  const startBtn = document.getElementById('start-btn');
  const selectedCategoryDiv = document.getElementById('selected-category');
  const nowPlaying = document.getElementById('now-playing');

  const token = localStorage.getItem('access_token');
  if(!token){ window.location.href = 'index.html'; return; }

  // load tracks
  const playlistUrl = localStorage.getItem('bingoPlaylistUrl') || localStorage.getItem('mobilePlaylistUrl') || '';
  const playlistId = extractPlaylistId(playlistUrl);
  if(!playlistId){ loading.textContent = 'Keine gültige Playlist gefunden.'; return; }

  loading.style.display = 'block';
  cachedPlaylistTracks = await fetchPlaylistTracks(playlistId);
  loading.style.display = 'none';

  if(!cachedPlaylistTracks || cachedPlaylistTracks.length === 0){
    document.getElementById('empty-warning').style.display = 'block';
    return;
  }

  // show start button once tracks loaded
  startBtn.style.display = 'inline-block';

  // Try both keys (bingoCategories OR mobileCategories) to match your other flows
  let stored = localStorage.getItem('bingoCategories');
  if(!stored) stored = localStorage.getItem('mobileCategories');
  categories = stored ? JSON.parse(stored) : [];

  // draw wheel only if categories exist (preserve your desired behavior)
  setupCanvas();
  if(Array.isArray(categories) && categories.length > 0){
    // wheel remains hidden until Start pressed (as you requested)
    drawWheel();
  } else {
    // nothing to show — wheel stays hidden
    console.log('No categories found; wheel will not be shown until categories exist.');
  }

  // ensure click handler attached on start
  startBtn.addEventListener('click', () => {
    startBtn.style.display = 'none';
    if(Array.isArray(categories) && categories.length > 0){
      // show wheel and ensure proper drawing after visible
      wheelContainer.style.display = 'block';
      setupCanvas(); drawWheel();

      if(!canvasEl._clickAttached){
        canvasEl.addEventListener('click', async () => {
          try {
            if(!hasSpun){
              const chosen = await spinWheelAsync();
              const category = categories[chosen] || '';
              selectedCategoryDiv.textContent = 'Kategorie: ' + category;

              // play a random track (after spin)
              const item = getRandomTrack(cachedPlaylistTracks);
              if(!item || !item.track){ if(window.M) M.toast({ html:'Kein Song verfügbar', classes:'rounded' }); return; }
              selectedTrackUri = item.track.uri;
              const ok = await playTrack(selectedTrackUri);
              if(!ok && window.M) M.toast({ html:'Fehler beim Abspielen des Songs', classes:'rounded' });
              updateTrackDetailsElement(item.track);
              nowPlaying.style.display = 'block';
              cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);
              hasSpun = true;
              hasPulsed = false;
            } else if(hasSpun && !hasPulsed){
              // start pulsation; await finish (or user aborts via Nächstes Lied)
              await pulseWheel();
              // natural end: stop playback
              await stopPlayback();
              hasPulsed = true;
            } else {
              if(window.M) M.toast({ html:'Bitte "Nächstes Lied" drücken, um fortzufahren.', classes:'rounded' });
            }
          } catch (e) { console.error('wheel click error', e); }
        });
        canvasEl._clickAttached = true;
      }
    } else {
      // fallback if no categories: original behavior -> play immediate random track
      (async () => {
        const item = getRandomTrack(cachedPlaylistTracks);
        if(!item || !item.track){ if(window.M) M.toast({ html:'Kein Song verfügbar', classes:'rounded' }); return; }
        selectedTrackUri = item.track.uri;
        const ok = await playTrack(selectedTrackUri);
        if(!ok && window.M) M.toast({ html:'Fehler beim Abspielen des Songs', classes:'rounded' });
        updateTrackDetailsElement(item.track);
        nowPlaying.style.display = 'block';
        cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);
      })();
    }
  });

  // redraw on resize
  let rt = null;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(()=>{ setupCanvas(); if(Array.isArray(categories) && categories.length>0) drawWheel(); }, 120);
  });
});
