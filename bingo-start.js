// === bingo-start.js (komplette Datei) ===
// Enthält: Spotify-Playback (wie gehabt), Glücksrad (3s), pulsation + buzzer
// Wichtig: Song startet erst NACH vollständigem Ende der Drehung.

let cachedPlaylistTracks = [];
let selectedTrackUri = null;
let spotifyReady = null;

let canvasEl = null;
let wheelContainer = null;
let wheelCtx = null;
let categories = [];

let hasSpun = false;
let hasPulsed = false;

// rotation in degrees (keine CSS transition für Drehung verwenden)
let rotationDeg = 0;

// pulse timers
let pulseTimeoutYellow = null;
let pulseTimeoutRed = null;
let pulseResolver = null;

const buzzerEl = typeof document !== 'undefined' ? document.getElementById('buzzer-sound') : null;

/* ---------------- Spotify + Playlist (unverändert) ---------------- */
function extractPlaylistId(url){
  if(!url) return null;
  let m=url.match(/spotify:playlist:([A-Za-z0-9-_]+)/);
  if(m) return m[1];
  m=url.match(/playlist\/([A-Za-z0-9-_]+)/);
  if(m) return m[1];
  m=url.match(/[?&]id=([A-Za-z0-9-_]+)/);
  return m?m[1]:null;
}

async function fetchPlaylistTracks(playlistId){
  const token=localStorage.getItem('access_token');
  if(!token) return [];
  const all=[]; const limit=50; let offset=0;
  try{
    const metaResp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
      headers:{ 'Authorization': `Bearer ${token}` }
    });
    if(!metaResp.ok) return [];
    const meta = await metaResp.json();
    const total = meta.tracks?.total || 0;
    while(offset < total) {
      const resp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if(!resp.ok) break;
      const data = await resp.json();
      const valid = (data.items || []).filter(i => i && i.track && i.track.uri && !i.is_local);
      all.push(...valid);
      offset += limit;
      if(!data.items || data.items.length === 0) break;
    }
  } catch(e) {
    console.error('fetchPlaylistTracks error', e);
  }
  return all;
}

spotifyReady = new Promise(resolve => {
  window.onSpotifyWebPlaybackSDKReady = () => {
    const token = localStorage.getItem('access_token');
    if(!token){ resolve(); return; }
    const player = new Spotify.Player({
      name: 'Julster Bingo Player',
      getOAuthToken: cb => cb(token)
    });
    player.addListener('ready', ({ device_id }) => {
      window.deviceId = device_id;
      window.bingoPlayer = player;
      resolve();
    });
    ['initialization_error','authentication_error','account_error','playback_error'].forEach(ev =>
      player.addListener(ev, ({message}) => console.warn('spotify event', ev, message))
    );
    player.connect().catch(()=>resolve());
  };
});

async function playTrack(uri){
  const token = localStorage.getItem('access_token');
  if(!token) return false;
  await spotifyReady;
  let wait = 0;
  while(!window.deviceId && wait < 6000){ await new Promise(r=>setTimeout(r,200)); wait+=200; }
  try{
    const dev = window.deviceId ? `?device_id=${window.deviceId}` : '';
    const resp = await fetch(`https://api.spotify.com/v1/me/player/play${dev}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ uris: [uri] })
    });
    return resp.status === 204;
  } catch(e) { console.error('playTrack error', e); return false; }
}

async function stopPlayback(){
  const token = localStorage.getItem('access_token');
  if(!token) return;
  try {
    await fetch('https://api.spotify.com/v1/me/player/pause', { method:'PUT', headers: {'Authorization': `Bearer ${token}`}});
  } catch(e) { console.warn('stopPlayback error', e); }
}

function getRandomTrack(arr){ if(!arr||!arr.length) return null; return arr[Math.floor(Math.random()*arr.length)]; }

/* ---------------- Track details / Nächstes Lied ---------------- */
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
        // stop song & abort pulse
        await stopPlayback();
        stopPulse(true); // aborted -> play buzzer feedback
        hasSpun = false;
        hasPulsed = false;
        document.getElementById('now-playing').style.display = 'none';
        document.getElementById('selected-category').textContent = '';
        // reset visual rotation
        canvasEl.style.transition = 'none';
        canvasEl.style.transform = 'rotate(0deg)';
        rotationDeg = 0;
        setTimeout(()=> { drawWheel(); }, 20);
      });

      expanded = true;
    } else {
      details.textContent = 'Songinfos auflösen';
      expanded = false;
    }
  };
}

/* ---------------- Canvas setup & draw ---------------- */
function setupCanvas(){
  canvasEl = document.getElementById('wheel-canvas');
  if(!canvasEl) return;
  // size from computed
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
  const arc = (2*Math.PI)/n;

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

    // text - responsive
    wheelCtx.save();
    wheelCtx.translate(cx, cx);
    wheelCtx.rotate(start + arc/2);
    wheelCtx.textAlign = 'right';
    wheelCtx.fillStyle = '#222';
    const fontSize = Math.max(12, Math.floor(cssSize / 20));
    wheelCtx.font = `bold ${fontSize}px Roboto, Arial`;
    let text = categories[i] || `Kategorie ${i+1}`;
    while (wheelCtx.measureText(text).width > r * 0.95 && text.length > 0) text = text.slice(0, -1);
    if (text.length < (categories[i]||'').length) text = text.slice(0,-1) + '…';
    wheelCtx.fillText(text, r - 10, fontSize/3);
    wheelCtx.restore();
  }
}

/* ---------------- spinWheel: animate with requestAnimationFrame, return chosen index ---------------- */
function spinWheelAsync() {
  return new Promise(resolve => {
    const n = Math.max(categories.length, 1);
    const segmentAngle = 360 / n; // degrees

    // pick chosen index
    const chosen = Math.floor(Math.random() * n);

    // compute angle so chosen segment center aligns with pointer DOWN
    // pointer down corresponds to 90deg in canvas coordinates when 0deg is to the RIGHT
    // We compute targetDegree such that (targetDegree + 90) % 360 == centerAngleOfChosen
    const centerAngleChosen = (chosen * segmentAngle) + segmentAngle / 2; // degrees
    // targetDegree = (centerAngleChosen - 90) normalized into [0,360)
    let targetDegree = (centerAngleChosen - 90) % 360;
    if (targetDegree < 0) targetDegree += 360;

    // final rotation: several full spins + targetDegree
    const rotations = 3; // change number of full rotations if desired
    const finalRotation = rotationDeg + rotations * 360 + targetDegree;

    const startRotation = rotationDeg;
    const duration = 3000; // 3 seconds
    const startTime = performance.now();

    // lock clicks during spin
    canvasEl.style.pointerEvents = 'none';

    function animate(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      // ease out cubic
      const ease = 1 - Math.pow(1 - t, 3);
      const current = startRotation + (finalRotation - startRotation) * ease;
      canvasEl.style.transform = `rotate(${current}deg)`;
      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        rotationDeg = finalRotation % 360;
        // unlock clicks after tiny delay
        setTimeout(() => { canvasEl.style.pointerEvents = ''; }, 50);
        // small wait to ensure visual settled, then resolve
        setTimeout(() => resolve(chosen), 10);
      }
    }
    requestAnimationFrame(animate);
  });
}

/* ---------------- Pulsation (abbrechbar) ---------------- */
function pulseWheel(){
  return new Promise(resolve => {
    const container = document.getElementById('wheel-container');
    stopPulse(false);
    container.classList.add('pulse-yellow');
    pulseResolver = resolve;
    pulseTimeoutYellow = setTimeout(() => {
      container.classList.remove('pulse-yellow');
      container.classList.add('pulse-red');
      pulseTimeoutRed = setTimeout(() => {
        container.classList.remove('pulse-red');
        try { if (buzzerEl) { buzzerEl.currentTime = 0; buzzerEl.play().catch(()=>{}); } } catch(e){}
        const r = pulseResolver; pulseResolver = null;
        resolve();
      }, 5000);
    }, 15000);
  });
}

function stopPulse(abortPlayBuzzer = false){
  const container = document.getElementById('wheel-container');
  if(container) container.classList.remove('pulse-yellow','pulse-red');
  if(pulseTimeoutYellow){ clearTimeout(pulseTimeoutYellow); pulseTimeoutYellow = null; }
  if(pulseTimeoutRed){ clearTimeout(pulseTimeoutRed); pulseTimeoutRed = null; }
  if(pulseResolver){
    const r = pulseResolver; pulseResolver = null;
    if(abortPlayBuzzer){
      try { if(buzzerEl) { buzzerEl.currentTime = 0; buzzerEl.play().catch(()=>{}); } } catch(e){}
    }
    r();
  }
}

/* ---------------- Main initialization ---------------- */
document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('access_token');
  if(!token){ window.location.href = 'index.html'; return; }

  canvasEl = document.getElementById('wheel-canvas');
  wheelContainer = document.getElementById('wheel-container');

  const loading = document.getElementById('loading-text');
  const startBtn = document.getElementById('start-btn');
  const selectedCategoryDiv = document.getElementById('selected-category');
  const nowPlaying = document.getElementById('now-playing');

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

  // load categories (bingoCategories primary)
  let stored = localStorage.getItem('bingoCategories') || localStorage.getItem('mobileCategories') || '[]';
  try { categories = JSON.parse(stored) || []; } catch(e){ categories = []; }

  // prepare canvas and draw (if categories exist)
  setupCanvas();
  if(Array.isArray(categories) && categories.length > 0){
    drawWheel();
  } else {
    // no categories -> wheel stays hidden (as you requested)
    console.log('No categories — wheel will remain hidden until categories exist.');
  }

  // Start button handler
  startBtn.addEventListener('click', () => {
    startBtn.style.display = 'none';
    if(Array.isArray(categories) && categories.length > 0){
      wheelContainer.style.display = 'block';
      // ensure canvas re-setup (visible)
      setupCanvas(); drawWheel();

      // attach handler once
      if(!canvasEl._attached) {
        canvasEl.addEventListener('click', async () => {
          try {
            if(!hasSpun){
              // spin wheel, wait until finished (spinWheelAsync ensures full animation)
              const chosenIndex = await spinWheelAsync();
              // only now show category & start song
              const category = categories[chosenIndex] || '';
              // tiny grace delay for visuals
              await new Promise(r=>setTimeout(r,50));
              selectedCategoryDiv.textContent = 'Kategorie: ' + category;

              const item = getRandomTrack(cachedPlaylistTracks);
              if(!item || !item.track) { if(window.M) M.toast({ html: 'Kein Song verfügbar', classes: 'rounded' }); return; }
              selectedTrackUri = item.track.uri;
              const ok = await playTrack(selectedTrackUri);
              if(!ok && window.M) M.toast({ html: 'Fehler beim Abspielen des Songs', classes: 'rounded' });
              updateTrackDetailsElement(item.track);
              nowPlaying.style.display = 'block';
              cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);
              hasSpun = true;
              hasPulsed = false;
              return;
            }

            if(hasSpun && !hasPulsed){
              await pulseWheel();
              await stopPlayback();
              hasPulsed = true;
            }
          } catch(e){
            console.error('wheel click error', e);
          }
        });
        canvasEl._attached = true;
      }

    } else {
      // fallback: no categories => normal behavior (play immediately)
      (async () => {
        const item = getRandomTrack(cachedPlaylistTracks);
        if(!item||!item.track) { if(window.M) M.toast({ html: 'Kein Song verfügbar', classes: 'rounded' }); return; }
        selectedTrackUri = item.track.uri;
        await playTrack(selectedTrackUri);
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
    rt = setTimeout(() => {
      setupCanvas();
      if(Array.isArray(categories) && categories.length > 0) drawWheel();
    }, 120);
  });
});
