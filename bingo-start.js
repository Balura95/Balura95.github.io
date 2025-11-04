/* bingo-start.js - überarbeitete, komplette Datei */

/* Globals */
let cachedPlaylistTracks = [];
let selectedTrackUri = null;
let spotifyReady = null;

let categories = [];              // loaded from localStorage
let canvasEl = null;
let ctx = null;
let wheelContainer = null;
let startBtn = null;
let nowPlayingEl = null;
let selectedCategoryEl = null;

let canvasSize = 0;
let dpr = 1;

// rotation state (radians)
let currentAngle = 0;
let isSpinning = false;
let hasSpunForThisSong = false;
let hasPulsedForThisSong = false;

// pulse timers so we can cancel
let pulseTimerYellow = null;
let pulseTimerRed = null;

// buzzer element
const buzzer = document.getElementById ? document.getElementById('buzzer-sound') : null;

/* --- Spotify SDK init (unchanged) --- */
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
    ['initialization_error','authentication_error','account_error','playback_error'].forEach(e => {
      player.addListener(e, () => { console.warn('spotify player event', e); resolve(); });
    });
    player.connect().catch(err => { console.warn('player connect err', err); resolve(); });
  };
});

/* --- Helpers: playlist id / fetch tracks --- */
function extractPlaylistId(url) {
  if (!url) return null;
  let m = url.match(/spotify:playlist:([A-Za-z0-9-_]+)/);
  if (m) return m[1];
  m = url.match(/playlist\/([A-Za-z0-9-_]+)/);
  if (m) return m[1];
  m = url.match(/[?&]id=([A-Za-z0-9-_]+)/);
  return m ? m[1] : null;
}

async function fetchPlaylistTracks(playlistId) {
  const token = localStorage.getItem('access_token');
  if (!token) return [];
  const all = [];
  const limit = 50;
  let offset = 0;
  try {
    const metaResp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!metaResp.ok) { console.error('meta fetch error'); return []; }
    const meta = await metaResp.json();
    const total = meta.tracks?.total || 0;
    while (offset < total) {
      const resp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (!resp.ok) { console.error('tracks fetch error'); break; }
      const data = await resp.json();
      const valid = (data.items || []).filter(i => i && i.track && i.track.uri && !i.is_local);
      all.push(...valid);
      offset += limit;
      if (!data.items || data.items.length === 0) break;
    }
  } catch (err) {
    console.error('fetchPlaylistTracks error', err);
  }
  return all;
}

/* --- Play / Pause via Web API --- */
async function playTrack(uri) {
  const token = localStorage.getItem('access_token');
  if (!token) return false;
  await spotifyReady;
  let wait = 0;
  while (!window.deviceId && wait < 6000) { await new Promise(r => setTimeout(r, 200)); wait += 200; }
  try {
    const dev = window.deviceId ? `?device_id=${window.deviceId}` : '';
    const resp = await fetch(`https://api.spotify.com/v1/me/player/play${dev}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri] })
    });
    return resp.status === 204;
  } catch (err) { console.error('playTrack error', err); return false; }
}

async function stopPlayback() {
  const token = localStorage.getItem('access_token');
  if (!token) return;
  try {
    await fetch('https://api.spotify.com/v1/me/player/pause', { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` } });
  } catch (err) { console.warn('stopPlayback error', err); }
}

/* --- Utility: pick random track --- */
function getRandomTrack(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

/* ---------- Canvas / Wheel ---------- */
function setupCanvas() {
  // set canvas physical pixels using DPR
  dpr = Math.max(window.devicePixelRatio || 1, 1);
  const rect = canvasEl.getBoundingClientRect();
  canvasSize = Math.round(rect.width);
  canvasEl.width = canvasSize * dpr;
  canvasEl.height = canvasSize * dpr;
  canvasEl.style.width = rect.width + 'px';
  canvasEl.style.height = rect.width + 'px';
  ctx = canvasEl.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawWheel() {
  if (!ctx) setupCanvas();
  ctx.clearRect(0, 0, canvasSize, canvasSize);
  const cx = canvasSize / 2;
  const cy = canvasSize / 2;
  const r = canvasSize / 2;
  const n = Math.max(categories.length, 1);
  const angle = (2 * Math.PI) / n;

  // pastel palette
  const palette = ['#ffd8cc','#e6f7ff','#e8e8ff','#dfffe6','#fff7d9','#fde2f3','#e6f2ff','#e9f8f3','#fff0d9','#f0e6ff'];

  for (let i = 0; i < n; i++) {
    const start = i * angle;
    const end = (i + 1) * angle;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end);
    ctx.closePath();
    ctx.fillStyle = palette[i % palette.length];
    ctx.fill();
    // thin border
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // text
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(start + angle / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#222';
    // responsive font size
    const fontSize = Math.max(12, Math.floor(canvasSize / 20));
    ctx.font = `bold ${fontSize}px Roboto, Arial`;
    let text = categories[i] || `Kategorie ${i+1}`;
    // truncate if too long
    while (ctx.measureText(text).width > r * 0.95 && text.length > 0) text = text.slice(0, -1);
    if (text.length < categories[i]?.length) text = text.slice(0, -1) + '…';
    ctx.fillText(text, r - 10, fontSize / 3);
    ctx.restore();
  }
}

/* Spin: compute a final rotation so that chosen segment lands under pointer (top) */
function spinWheelAsync() {
  return new Promise(resolve => {
    const n = Math.max(categories.length, 1);
    const segmentAngle = (2 * Math.PI) / n;
    // choose random index
    const chosen = Math.floor(Math.random() * n);
    // compute target such that chosen segment center aligns with -PI/2 (top)
    const thetaChosen = chosen * segmentAngle + segmentAngle / 2;
    const rotations = 5 + Math.floor(Math.random() * 3); // 5..7
    const base = (-Math.PI / 2 - thetaChosen);
    const jitter = (Math.random() * 0.2) - 0.1;
    const finalDelta = rotations * 2 * Math.PI + base + jitter;

    // update currentAngle
    currentAngle += finalDelta;

    // apply transform (deg)
    const deg = currentAngle * 180 / Math.PI;
    canvasEl.style.transition = 'transform 4.6s cubic-bezier(0.33,1,0.68,1)';
    canvasEl.style.transform = `rotate(${deg}deg)`;

    // wait for transition end
    const onEnd = (e) => {
      if (e.propertyName !== 'transform') return;
      canvasEl.removeEventListener('transitionend', onEnd);
      // compute landed index (safeguard)
      const normalized = ((currentAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      let target = (-Math.PI / 2 - normalized) % (2 * Math.PI);
      if (target < 0) target += 2 * Math.PI;
      const landedIndex = Math.floor(target / segmentAngle) % n;
      resolve(landedIndex);
    };
    canvasEl.addEventListener('transitionend', onEnd);
  });
}

/* ---------- Pulsation (with cancel) ---------- */
function startPulsationSequence() {
  const container = wheelContainer;
  cancelPulsation();
  container.classList.add('pulse-yellow');
  pulseTimerYellow = setTimeout(() => {
    container.classList.remove('pulse-yellow');
    container.classList.add('pulse-red');
    pulseTimerRed = setTimeout(() => {
      container.classList.remove('pulse-red');
      // buzzer
      if (buzzer) try { buzzer.currentTime = 0; buzzer.play().catch(()=>{}); } catch(e){}
      // stop playback when timer finishes
      stopPlayback().catch(()=>{});
      hasPulsedForThisSong = true;
    }, 5000); // red
  }, 15000); // yellow
}

function cancelPulsation() {
  wheelContainer.classList.remove('pulse-yellow', 'pulse-red');
  if (pulseTimerYellow) { clearTimeout(pulseTimerYellow); pulseTimerYellow = null; }
  if (pulseTimerRed) { clearTimeout(pulseTimerRed); pulseTimerRed = null; }
  if (buzzer) try { buzzer.pause(); buzzer.currentTime = 0; } catch(e){}
}

/* ---------- Track info UI ---------- */
function updateTrackDetailsElement(track) {
  const details = document.getElementById('track-details');
  if (!details) return;
  let expanded = false;
  details.textContent = 'Songinfos auflösen';
  details.onclick = () => {
    if (!expanded) {
      details.innerHTML = `
        <div style="text-align:left;">
          <p><strong>Titel:</strong> ${track.name}</p>
          <p><strong>Interpret:</strong> ${track.artists.map(a => a.name).join(', ')}</p>
          <p><strong>Album:</strong> ${track.album.name || ''}</p>
          <p><strong>Jahr:</strong> ${track.album.release_date ? track.album.release_date.substring(0,4) : ''}</p>
        </div>
      `;
      const nextBtn = document.createElement('button');
      nextBtn.className = 'btn details-weiter-btn green';
      nextBtn.textContent = 'Nächstes Lied';
      nextBtn.type = 'button';
      details.appendChild(nextBtn);

      nextBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        // stop song and cancel pulsation
        await stopPlayback();
        cancelPulsation();
        // reset UI and wheel for next round
        hasSpunForThisSong = false;
        hasPulsedForThisSong = false;
        currentAngle = 0;
        canvasEl.style.transition = 'none';
        canvasEl.style.transform = 'rotate(0deg)';
        // small timeout to allow transition removal to take effect before redraw
        setTimeout(() => {
          setupCanvas(); drawWheel();
        }, 20);
        document.getElementById('now-playing').style.display = 'none';
        document.getElementById('selected-category').textContent = '';
      });
      expanded = true;
    } else {
      details.textContent = 'Songinfos auflösen';
      expanded = false;
    }
  };
}

/* ---------- Song start after spin ---------- */
async function startSongAfterSpin(landedIndex) {
  const cat = categories[landedIndex] || '';
  document.getElementById('selected-category').textContent = `Kategorie: ${cat}`;
  // pick and play a random track (only after spin finished)
  if (!cachedPlaylistTracks || cachedPlaylistTracks.length === 0) {
    if (window.M) M.toast({ html: 'Keine Songs verfügbar', classes: 'rounded' });
    return;
  }
  const item = getRandomTrack(cachedPlaylistTracks);
  if (!item || !item.track) {
    if (window.M) M.toast({ html: 'Fehler beim Abrufen des Songs', classes: 'rounded' });
    return;
  }
  selectedTrackUri = item.track.uri;
  const ok = await playTrack(selectedTrackUri);
  if (!ok && window.M) M.toast({ html: 'Fehler beim Abspielen des Songs', classes: 'rounded' });
  updateTrackDetailsElement(item.track);
  document.getElementById('now-playing').style.display = 'block';
  // remove from cached tracks so not replayed
  cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);
  hasSpunForThisSong = true;
  hasPulsedForThisSong = false;
}

/* ---------- Init & wiring ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  // DOM refs
  canvasEl = document.getElementById('wheel-canvas');
  wheelContainer = document.getElementById('wheel-container');
  startBtn = document.getElementById('start-btn');
  nowPlayingEl = document.getElementById('now-playing');
  selectedCategoryEl = document.getElementById('selected-category');

  const token = localStorage.getItem('access_token');
  if (!token) { window.location.href = 'index.html'; return; }

  // load categories from localStorage
  categories = JSON.parse(localStorage.getItem('bingoCategories') || '[]');

  // fetch playlist tracks
  const playlistUrl = localStorage.getItem('bingoPlaylistUrl') || localStorage.getItem('mobilePlaylistUrl') || '';
  const playlistId = extractPlaylistId(playlistUrl);
  if (!playlistId) { document.getElementById('loading-text').textContent = 'Keine gültige Playlist gefunden.'; return; }

  document.getElementById('loading-text').style.display = 'block';
  cachedPlaylistTracks = await fetchPlaylistTracks(playlistId);
  document.getElementById('loading-text').style.display = 'none';

  if (!cachedPlaylistTracks || cachedPlaylistTracks.length === 0) {
    document.getElementById('empty-warning').style.display = 'block';
    return;
  }

  // show start button now that playlist loaded
  startBtn.style.display = 'inline-block';

  // prepare canvas for drawing
  setupCanvas();
  if (Array.isArray(categories) && categories.length > 0) drawWheel();
  else {
    // if no categories, hide wheel UI (we still support non-discokugel flow)
    wheelContainer.style.display = 'none';
  }

  // start button click
  startBtn.addEventListener('click', async () => {
    startBtn.style.display = 'none';
    // show wheel if categories exist
    if (Array.isArray(categories) && categories.length > 0) {
      wheelContainer.style.display = 'block';
      // ensure canvas sized & drawn
      setupCanvas();
      drawWheel();

      // attach click handler (only once)
      if (!canvasEl._attached) {
        canvasEl.addEventListener('click', async () => {
          // if not spun yet for this song -> spin
          if (!hasSpunForThisSong && !isSpinning) {
            isSpinning = true;
            try {
              const landedIndex = await spinWheelAsync();
              isSpinning = false;
              // start the song and show category
              await startSongAfterSpin(landedIndex);
            } catch (e) {
              console.error('spin error', e);
              isSpinning = false;
            }
          } else if (hasSpunForThisSong && !hasPulsedForThisSong) {
            // start pulsation and then stop after it finishes
            startPulsationSequence();
            hasPulsedForThisSong = true; // prevent starting twice
          } else {
            // nothing to do (either pulsed already or spin in progress)
            if (window.M) M.toast({ html: 'Bitte "Nächstes Lied" drücken, um fortzufahren.', classes: 'rounded' });
          }
        });
        canvasEl._attached = true;
      }
    } else {
      // no categories => normal behavior: play a track immediately
      await (async () => {
        const item = getRandomTrack(cachedPlaylistTracks);
        if (!item || !item.track) { if (window.M) M.toast({ html: 'Kein Song verfügbar', classes: 'rounded' }); return; }
        selectedTrackUri = item.track.uri;
        const ok = await playTrack(selectedTrackUri);
        if (!ok && window.M) M.toast({ html: 'Fehler beim Abspielen', classes: 'rounded' });
        updateTrackDetailsElement(item.track);
        document.getElementById('now-playing').style.display = 'block';
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
      drawWheel();
    }, 120);
  });
});
