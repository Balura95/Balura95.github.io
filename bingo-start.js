// === bingo-start.js (aktualisiert) ===
// Änderung: korrekte Segment-Auswahl nach Drehung + stopPulse() spielt Buzzer beim Abbrechen

let cachedPlaylistTracks = [];
let selectedTrackUri = null;
let spotifyReady = null;

let wheelCanvas, wheelCtx, categories = [];
let hasSpun = false;
let hasPulsed = false;

// Rotationstate (radians)
let currentAngle = 0;

// Puls-Timer / Resolver (damit Puls abbrechbar ist)
let pulseTimeoutYellow = null;
let pulseTimeoutRed = null;
let pulseResolve = null;

// Buzzer (wird beim Ende oder beim Abbrechen gespielt)
const buzzerEl = document.getElementById ? document.getElementById('buzzer-sound') : null;

/* ---------------- Spotify / Playlist (unverändert) ---------------- */
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
  const all = []; const limit = 50; let offset = 0;
  try {
    const metaResp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!metaResp.ok) { console.error('Playlist meta fetch failed'); return []; }
    const meta = await metaResp.json();
    const total = meta.tracks?.total || 0;
    while (offset < total) {
      const resp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!resp.ok) { console.error('Tracks fetch error'); break; }
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

/* ---------------- Track UI ---------------- */
function updateTrackDetailsElement(track){
  const details = document.getElementById('track-details');
  if(!details) return;
  let expanded = false;
  details.textContent = 'Songinfos auflösen';
  details.onclick = () => {
    if (!expanded) {
      details.innerHTML = `
        <div>
          <p><strong>Titel:</strong> ${track.name}</p>
          <p><strong>Interpret:</strong> ${track.artists.map(a=>a.name).join(', ')}</p>
          <p><strong>Album:</strong> ${track.album.name || ''}</p>
          <p><strong>Jahr:</strong> ${track.album.release_date ? track.album.release_date.substring(0,4) : ''}</p>
        </div>
      `;
      const weiter = document.createElement('button');
      weiter.className = 'btn details-weiter-btn green';
      weiter.textContent = 'Nächstes Lied';
      weiter.type = 'button';
      details.appendChild(weiter);

      weiter.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        // 1) stoppe Playback sofort
        await stopPlayback();
        // 2) breche Pulsation ab (inkl. Buzzer)
        stopPulse(true); // true => spiele Buzzer beim Abbrechen
        // 3) reset Flags / UI
        hasSpun = false;
        hasPulsed = false;
        // hide now playing
        document.getElementById('now-playing').style.display = 'none';
        document.getElementById('selected-category').textContent = '';
        // reset wheel visual rotation
        const canvas = document.getElementById('wheel-canvas');
        canvas.style.transition = 'none';
        canvas.style.transform = 'rotate(0deg)';
        currentAngle = 0;
        // small redraw to ensure correct display
        setTimeout(()=> { setupCanvas(); drawWheel(); }, 20);
      });

      expanded = true;
    } else {
      details.textContent = 'Songinfos auflösen';
      expanded = false;
    }
  };
}

/* ---------------- Canvas / Wheel drawing ---------------- */
function setupCanvas(){
  wheelCanvas = document.getElementById('wheel-canvas');
  // ensure css width/height are used as size
  const rect = wheelCanvas.getBoundingClientRect();
  const dpr = Math.max(window.devicePixelRatio || 1, 1);
  const size = Math.round(rect.width);
  wheelCanvas.width = size * dpr;
  wheelCanvas.height = size * dpr;
  wheelCanvas.style.width = rect.width + 'px';
  wheelCanvas.style.height = rect.width + 'px';
  wheelCtx = wheelCanvas.getContext('2d');
  wheelCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawWheel(){
  if(!wheelCanvas) setupCanvas();
  const canvas = wheelCanvas;
  const ctx = wheelCtx;
  const size = canvas.width / (window.devicePixelRatio || 1);
  const cx = size/2;
  const cy = size/2;
  const r = size/2;
  const n = Math.max(categories.length,1);
  const arc = (2*Math.PI)/n;

  ctx.clearRect(0,0,size,size);

  const palette = ['#ffd8cc','#e6f7ff','#e8e8ff','#dfffe6','#fff7d9','#fde2f3','#e6f2ff','#e9f8f3','#fff0d9','#f0e6ff'];

  for(let i=0;i<n;i++){
    const start = i*arc;
    const end = (i+1)*arc;
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,r,start,end);
    ctx.closePath();
    ctx.fillStyle = palette[i % palette.length];
    ctx.fill();
    // thin stroke
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // text - larger and responsive
    ctx.save();
    ctx.translate(cx,cy);
    ctx.rotate(start + arc/2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#222';
    const fontSize = Math.max(12, Math.floor(size/20));
    ctx.font = `bold ${fontSize}px Roboto, Arial`;
    let text = categories[i] || `Kategorie ${i+1}`;
    // truncate if too long
    while (ctx.measureText(text).width > r * 0.95 && text.length>0) text = text.slice(0,-1);
    if (text.length < (categories[i]||'').length) text = text.slice(0,-1) + '…';
    ctx.fillText(text, r - 10, fontSize/3);
    ctx.restore();
  }
}

/* ---------------- Spin (deterministisch auf gewählten Index) ---------------- */
function spinWheelAsync(){
  return new Promise(resolve => {
    const n = Math.max(categories.length,1);
    const segmentAngle = (2*Math.PI)/n;
    // choose random target index
    const chosen = Math.floor(Math.random()*n);
    // compute theta (center) of chosen
    const thetaChosen = chosen*segmentAngle + segmentAngle/2;
    // compute final delta: rotations * 2π + offset so that chosen center aligns with pointer (-PI/2)
    const rotations = 5 + Math.floor(Math.random()*3); // 5..7 rotations
    const base = (-Math.PI/2 - thetaChosen);
    const jitter = (Math.random()*0.2) - 0.1;
    const finalDelta = rotations*2*Math.PI + base + jitter;

    currentAngle += finalDelta;
    const deg = currentAngle * 180 / Math.PI;
    // apply transform
    wheelCanvas.style.transition = 'transform 4.6s cubic-bezier(0.33,1,0.68,1)';
    wheelCanvas.style.transform = `rotate(${deg}deg)`;

    // wait for transition end
    const onEnd = (e) => {
      if (e.propertyName !== 'transform') return;
      wheelCanvas.removeEventListener('transitionend', onEnd);
      resolve(chosen);
    };
    wheelCanvas.addEventListener('transitionend', onEnd);
  });
}

/* ---------------- Pulsation (abbrechbar) ---------------- */
function pulseWheel(){
  return new Promise(resolve => {
    const container = document.getElementById('wheel-container');
    // safety
    stopPulse(false);

    container.classList.add('pulse-yellow');
    pulseResolve = resolve;

    pulseTimeoutYellow = setTimeout(() => {
      container.classList.remove('pulse-yellow');
      container.classList.add('pulse-red');

      pulseTimeoutRed = setTimeout(() => {
        container.classList.remove('pulse-red');
        // natural end -> play buzzer
        try { if (buzzerEl) { buzzerEl.currentTime = 0; buzzerEl.play().catch(()=>{}); } } catch(e){}
        const r = pulseResolve; pulseResolve = null;
        resolve(); // normal finish
      }, 5000);
    }, 15000);
  });
}

// stopPulse(aborted) -> when aborted===true we play buzzer sound as feedback
function stopPulse(aborted = true){
  const container = document.getElementById('wheel-container');
  if(!container) return;
  container.classList.remove('pulse-yellow','pulse-red');
  if(pulseTimeoutYellow){ clearTimeout(pulseTimeoutYellow); pulseTimeoutYellow = null; }
  if(pulseTimeoutRed){ clearTimeout(pulseTimeoutRed); pulseTimeoutRed = null; }
  if(pulseResolve){
    // if there is a pending resolve, resolve it now (aborted)
    const resolver = pulseResolve;
    pulseResolve = null;
    try { if (aborted && buzzerEl) { buzzerEl.currentTime = 0; buzzerEl.play().catch(()=>{}); } } catch(e){}
    resolver(); // resolve the promise returned by pulseWheel
  }
}

/* ---------------- Hauptlogik ---------------- */
document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('access_token');
  if(!token){ window.location.href='index.html'; return; }

  const loading = document.getElementById('loading-text');
  const startBtn = document.getElementById('start-btn');
  const wheelContainer = document.getElementById('wheel-container');
  const selectedCategoryDiv = document.getElementById('selected-category');
  const nowPlaying = document.getElementById('now-playing');

  // references
  wheelCanvas = document.getElementById('wheel-canvas');

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

  // show start button
  startBtn.style.display = 'inline-block';

  // load categories
  categories = JSON.parse(localStorage.getItem('bingoCategories') || '[]');

  // prepare and draw wheel (if active)
  setupCanvas();
  if(Array.isArray(categories) && categories.length > 0){
    drawWheel();
  } else {
    // no categories -> hide wheel container (fallback)
    wheelContainer.style.display = 'none';
  }

  // Start click
  startBtn.addEventListener('click', () => {
    startBtn.style.display = 'none';
    if(Array.isArray(categories) && categories.length > 0){
      wheelContainer.style.display = 'block';
      // ensure canvas sized & redrawn
      setupCanvas(); drawWheel();

      // attach handler once
      if(!wheelCanvas._hasHandler){
        wheelCanvas.addEventListener('click', async () => {
          try {
            if(!hasSpun){
              // spin, get chosen index, then start song
              const chosen = await spinWheelAsync();
              const category = categories[chosen] || '';
              selectedCategoryDiv.textContent = 'Kategorie: ' + category;

              // pick random track and play (only after spin finished)
              const item = getRandomTrack(cachedPlaylistTracks);
              if(!item || !item.track) { if(window.M) M.toast({ html: 'Kein Song verfügbar', classes: 'rounded' }); return; }
              selectedTrackUri = item.track.uri;
              const ok = await playTrack(selectedTrackUri);
              if(!ok && window.M) M.toast({ html: 'Fehler beim Abspielen des Songs', classes: 'rounded' });
              updateTrackDetailsElement(item.track);
              nowPlaying.style.display = 'block';
              // remove played
              cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);
              hasSpun = true;
              hasPulsed = false;
            } else if(hasSpun && !hasPulsed){
              // start pulsation; await its natural completion (or user can abort)
              await pulseWheel();
              // natural end -> ensure playback stopped
              await stopPlayback();
              hasPulsed = true;
            } else {
              if(window.M) M.toast({ html: 'Bitte "Nächstes Lied" drücken, um fortzufahren.', classes: 'rounded' });
            }
          } catch (e) {
            console.error('wheel click error', e);
          }
        });
        wheelCanvas._hasHandler = true;
      }
    } else {
      // fallback: no categories
      (async () => {
        const item = getRandomTrack(cachedPlaylistTracks);
        if(!item || !item.track) { if(window.M) M.toast({ html: 'Kein Song verfügbar', classes: 'rounded' }); return; }
        selectedTrackUri = item.track.uri;
        await playTrack(selectedTrackUri);
        updateTrackDetailsElement(item.track);
        nowPlaying.style.display = 'block';
        cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);
      })();
    }
  });

  // redraw on resize for responsiveness
  let rt = null;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      setupCanvas();
      if(Array.isArray(categories) && categories.length > 0) drawWheel();
    }, 120);
  });
});
