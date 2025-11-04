/* bingo-start.js - komplette Logik */
/* Hinweis: dieses Skript ist eigenständig - ersetze deine alte Datei damit */

let cachedPlaylistTracks = [];
let selectedTrackUri = null;
let spotifyReady = null;
let categories = [];
let hasSpun = false;
let hasPulsed = false;
let pulseTimerYellow = null;
let pulseTimerRed = null;
let currentAngle = 0; // in radians

// Spotify Web Playback SDK setup
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
      player.addListener(e, () => { console.warn('Spotify player event', e); resolve(); });
    });
    player.connect().catch(err => { console.warn('player.connect err', err); resolve(); });
  };
});

// --- Helper: Playlist id extraction
function extractPlaylistId(url) {
  if (!url) return null;
  let m = url.match(/spotify:playlist:([A-Za-z0-9-_]+)/);
  if (m) return m[1];
  m = url.match(/playlist\/([A-Za-z0-9-_]+)/);
  if (m) return m[1];
  m = url.match(/[?&]id=([A-Za-z0-9-_]+)/);
  return m ? m[1] : null;
}

// --- Fetch tracks paginated
async function fetchPlaylistTracks(playlistId) {
  const token = localStorage.getItem('access_token');
  if (!token) return [];
  const all = [];
  const limit = 50;
  let offset = 0;
  try {
    const metaResp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!metaResp.ok) { console.error('Playlist meta error', await metaResp.text()); return []; }
    const meta = await metaResp.json();
    const total = meta.tracks?.total || 0;
    while (offset < total) {
      const resp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (!resp.ok) { console.error('Tracks fetch error', await resp.text()); break; }
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

// --- Play/stop track via Web API (uses deviceId if SDK connected)
async function playTrack(uri) {
  const token = localStorage.getItem('access_token');
  if (!token) return false;
  await spotifyReady;
  // wait a bit for deviceId
  let waitTime = 0;
  while (!window.deviceId && waitTime < 6000) {
    await new Promise(r => setTimeout(r, 200));
    waitTime += 200;
  }
  try {
    const deviceParam = window.deviceId ? `?device_id=${window.deviceId}` : '';
    const response = await fetch(`https://api.spotify.com/v1/me/player/play${deviceParam}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri] })
    });
    return response.status === 204;
  } catch (err) {
    console.error('playTrack error', err);
    return false;
  }
}

async function stopPlayback() {
  const token = localStorage.getItem('access_token');
  if (!token) return;
  try {
    await fetch('https://api.spotify.com/v1/me/player/pause', { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` } });
  } catch (err) { console.warn('stopPlayback error', err); }
}

function getRandomTrack(tracks) {
  if (!tracks || tracks.length === 0) return null;
  return tracks[Math.floor(Math.random() * tracks.length)];
}

/* --------- Canvas wheel drawing / responsive handling --------- */
function setupCanvas(canvasEl) {
  // set canvas pixel size for DPR
  const rect = canvasEl.getBoundingClientRect();
  const dpr = Math.max(window.devicePixelRatio || 1, 1);
  const size = Math.round(rect.width);
  canvasEl.width = size * dpr;
  canvasEl.height = size * dpr;
  canvasEl.style.width = rect.width + 'px';
  canvasEl.style.height = rect.width + 'px';
  const ctx = canvasEl.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // scale drawing operations
  return ctx;
}

function drawWheelOnCanvas(canvasEl, ctx) {
  if (!ctx) ctx = canvasEl.getContext('2d');
  const rect = canvasEl.getBoundingClientRect();
  const size = rect.width;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2;
  const count = categories.length || 1;
  const angle = (2 * Math.PI) / count;

  ctx.clearRect(0, 0, size, size);

  // pastel color palette
  const palette = ['#ffd8cc','#ffe0f0','#e6d8ff','#dfe9ff','#d8fff3','#e8f8d8','#fff1cf','#fbd8ff','#dfe6ff','#fce7e0'];
  for (let i = 0; i < count; i++) {
    const start = i * angle;
    const end = (i + 1) * angle;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = palette[i % palette.length];
    ctx.fill();
    // thin border for segments
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // text
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(start + angle / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#222';
    // adaptive font size
    const fontSize = Math.max(12, Math.floor(size / 22));
    ctx.font = `bold ${fontSize}px Roboto, Arial`;
    const text = categories[i] || `Kategorie ${i+1}`;
    // wrap text if too long (simple truncation)
    let toDraw = text;
    if (ctx.measureText(toDraw).width > radius * 1.2) {
      // truncate
      while (ctx.measureText(toDraw + '…').width > radius * 1.2 && toDraw.length > 0) toDraw = toDraw.slice(0, -1);
      toDraw = toDraw + '…';
    }
    ctx.fillText(toDraw, radius - 10, 6);
    ctx.restore();
  }
}

/* Spin wheel: returns index chosen after transition ends */
function spinWheelAsync(canvasEl) {
  return new Promise(resolve => {
    const count = categories.length || 1;
    const segmentAngle = (2 * Math.PI) / count;
    // choose random index to land on by computing final rotation
    const rotations = 5 + Math.floor(Math.random() * 4); // 5..8 rotations
    const chosen = Math.floor(Math.random() * count);

    // target: we want segment center angle theta_chosen to align with pointer (which is at -PI/2)
    const theta_chosen = chosen * segmentAngle + segmentAngle / 2;
    // finalAngle such that (theta_chosen + finalAngle) % (2π) === -PI/2
    // => finalAngle === -PI/2 - theta_chosen (mod 2π)
    // We'll add rotations * 2π to make it spin multiple times
    const base = (-Math.PI / 2 - theta_chosen);
    const jitter = (Math.random() * 0.2) - 0.1; // small jitter +/-0.1 rad
    const finalAngle = rotations * 2 * Math.PI + base + jitter;

    currentAngle = currentAngle + finalAngle;

    const deg = currentAngle * 180 / Math.PI;
    // apply transform
    canvasEl.style.transition = 'transform 5s cubic-bezier(0.33, 1, 0.68, 1)';
    canvasEl.style.transform = `rotate(${deg}deg)`;

    // listen for transition end
    const onEnd = (e) => {
      if (e.propertyName !== 'transform') return;
      canvasEl.removeEventListener('transitionend', onEnd);
      // Normalize angle and compute landed index to double-check
      const normalized = ((currentAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      // compute target = (-PI/2 - normalized) mod 2π shifted to [0,2π)
      let target = (-Math.PI / 2 - normalized) % (2 * Math.PI);
      if (target < 0) target += 2 * Math.PI;
      const landedIndex = Math.floor(target / segmentAngle) % count;
      // ensure landedIndex equals chosen; small numerical differences aside
      resolve(landedIndex);
    };
    canvasEl.addEventListener('transitionend', onEnd);
  });
}

/* Pulsation with ability to cancel */
function pulseWheel(containerEl) {
  return new Promise(resolve => {
    // clear any existing timers
    clearTimeout(pulseTimerYellow);
    clearTimeout(pulseTimerRed);
    containerEl.classList.remove('pulse-yellow','pulse-red');

    containerEl.classList.add('pulse-yellow');
    pulseTimerYellow = setTimeout(() => {
      containerEl.classList.remove('pulse-yellow');
      containerEl.classList.add('pulse-red');
      pulseTimerRed = setTimeout(() => {
        containerEl.classList.remove('pulse-red');
        // play buzzer
        const buz = document.getElementById('buzzer-sound');
        if (buz) { try { buz.currentTime = 0; buz.play().catch(()=>{}); } catch(e){} }
        resolve();
      }, 5000); // red duration
    }, 15000); // yellow duration
  });
}

function cancelPulse(containerEl) {
  clearTimeout(pulseTimerYellow);
  clearTimeout(pulseTimerRed);
  containerEl.classList.remove('pulse-yellow','pulse-red');
  // stop buzzer if playing
  const buz = document.getElementById('buzzer-sound');
  if (buz) try { buz.pause(); buz.currentTime = 0; } catch(e){}
}

/* --- Track details box: "Nächstes Lied" stops playback + cancels pulse --- */
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
      const weiter = document.createElement('button');
      weiter.className = 'btn details-weiter-btn green';
      weiter.textContent = 'Nächstes Lied';
      weiter.type = 'button';
      details.appendChild(weiter);

      weiter.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        // cancel pulsation + buzzer
        const container = document.getElementById('wheel-container');
        cancelPulse(container);
        // stop playback
        await stopPlayback();
        // reset UI flags and hide info
        hasSpun = false;
        hasPulsed = false;
        document.getElementById('now-playing').style.display = 'none';
        document.getElementById('selected-category').textContent = '';
        // reset wheel rotation visually to 0 (no transition)
        const canvasEl = document.getElementById('wheel-canvas');
        canvasEl.style.transition = 'none';
        canvasEl.style.transform = 'rotate(0deg)';
        // reset currentAngle to 0 mod 2π to avoid huge numbers (keeps future math sane)
        currentAngle = 0;
        // re-draw wheel (in case)
        const ctx = setupCanvas(canvasEl);
        drawWheelOnCanvas(canvasEl, ctx);
      });

      expanded = true;
    } else {
      details.textContent = 'Songinfos auflösen';
      expanded = false;
    }
  };
}

/* --- Main initialization & wiring --- */
document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('access_token');
  if (!token) { window.location.href = 'index.html'; return; }

  const loadingText = document.getElementById('loading-text');
  const startBtn = document.getElementById('start-btn');
  const wheelContainer = document.getElementById('wheel-container');
  const canvasEl = document.getElementById('wheel-canvas');
  const selectedCategoryEl = document.getElementById('selected-category');
  const nowPlayingEl = document.getElementById('now-playing');

  // prepare canvas DPR
  setupCanvas(canvasEl);

  const playlistUrl = localStorage.getItem('bingoPlaylistUrl') || localStorage.getItem('mobilePlaylistUrl') || '';
  const playlistId = extractPlaylistId(playlistUrl);
  if (!playlistId) {
    loadingText.textContent = 'Keine gültige Playlist gefunden.';
    return;
  }

  loadingText.style.display = 'block';
  cachedPlaylistTracks = await fetchPlaylistTracks(playlistId);
  loadingText.style.display = 'none';

  if (!cachedPlaylistTracks || cachedPlaylistTracks.length === 0) {
    document.getElementById('empty-warning').style.display = 'block';
    return;
  }

  // show start button now that tracks are ready
  startBtn.style.display = 'inline-block';

  // load categories (bingoCategories saved as array)
  categories = JSON.parse(localStorage.getItem('bingoCategories') || '[]');

  // draw initial wheel if discokugel active
  const discokugelActive = Array.isArray(categories) && categories.length > 0;
  if (discokugelActive) {
    // draw wheel (responsive)
    const ctx = setupCanvas(canvasEl);
    drawWheelOnCanvas(canvasEl, ctx);
  }

  // handle start click: reveal wheel (only if discokugel active), otherwise normal play
  startBtn.addEventListener('click', () => {
    startBtn.style.display = 'none';
    if (discokugelActive) {
      wheelContainer.style.display = 'block';
      // re-draw to ensure correct size after visible
      const ctx = setupCanvas(canvasEl);
      drawWheelOnCanvas(canvasEl, ctx);

      // attach click listener once
      const onCanvasClick = async () => {
        if (!hasSpun) {
          // spin and wait for result index
          const landedIndex = await spinWheelAsync(canvasEl);
          // show selected category text
          const cat = categories[landedIndex] || '';
          selectedCategoryEl.textContent = `Kategorie: ${cat}`;
          // start the song only after spin resolved
          const item = getRandomTrack(cachedPlaylistTracks);
          if (!item || !item.track) {
            if (window.M) M.toast({ html: 'Kein Song verfügbar', classes: 'rounded' });
            return;
          }
          selectedTrackUri = item.track.uri;
          const ok = await playTrack(selectedTrackUri);
          if (!ok && window.M) M.toast({ html: 'Fehler beim Abspielen des Songs', classes: 'rounded' });
          updateTrackDetailsElement(item.track);
          nowPlayingEl.style.display = 'block';
          // remove track from cache
          cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);
          hasSpun = true;
          hasPulsed = false;
        } else if (!hasPulsed) {
          // start pulsation, await, then stop playback
          await pulseWheel(wheelContainer);
          await stopPlayback();
          hasPulsed = true;
        } else {
          // already pulsed; tell user to press Nächstes Lied
          if (window.M) M.toast({ html: 'Bitte "Nächstes Lied" drücken, um fortzufahren.', classes: 'rounded' });
        }
      };

      // Add only once
      if (!canvasEl._hasClick) {
        canvasEl.addEventListener('click', onCanvasClick);
        canvasEl._hasClick = true;
      }
    } else {
      // no discokugel: start immediately a song (as before)
      (async () => {
        const item = getRandomTrack(cachedPlaylistTracks);
        if (!item || !item.track) { if (window.M) M.toast({ html: 'Kein Song verfügbar', classes: 'rounded' }); return; }
        selectedTrackUri = item.track.uri;
        const ok = await playTrack(selectedTrackUri);
        if (!ok && window.M) M.toast({ html: 'Fehler beim Abspielen des Songs', classes: 'rounded' });
        updateTrackDetailsElement(item.track);
        nowPlayingEl.style.display = 'block';
        cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);
      })();
    }
  });

  // redraw on resize for responsiveness
  let resizeTimeout = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      setupCanvas(canvasEl);
      if (Array.isArray(categories) && categories.length > 0) {
        drawWheelOnCanvas(canvasEl, canvasEl.getContext('2d'));
      }
    }, 120);
  });
});
