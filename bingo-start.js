// bingo-start.js — korrigierte, vollständige Version
// Features:
// - Wheel labels centered inside segments
// - "Spin the wheel" heading above the wheel
// - track-details shown only after spin/play
// - wheel spins only when no song is playing
// - during playback: click wheel -> pulse (15s white -> 5s red -> stops playback)

// state
let cachedPlaylistTracks = [];
let bingoCategories = [];
let currentPreparedItem = null;
let selectedTrackUri = null;
let isSpinning = false;
let isPlaying = false;
let pulseTimers = [];

// Spotify SDK readiness (optional)
let spotifyReady = new Promise((res) => {
  window.onSpotifyWebPlaybackSDKReady = () => {
    const token = localStorage.getItem('access_token');
    if (!token) { res(); return; }
    const player = new Spotify.Player({ name: 'Julster Bingo Player', getOAuthToken: cb => cb(token) });
    player.addListener('ready', ({ device_id }) => { window.deviceId = device_id; window.bingoPlayer = player; res(); });
    player.addListener('initialization_error', ({ message }) => { console.error(message); res(); });
    player.addListener('authentication_error', ({ message }) => { console.error(message); res(); });
    player.connect().catch(e => { console.warn('SDK connect failed', e); res(); });
  };
});

// utilities
function extractPlaylistId(url) {
  if (!url) return null;
  const m1 = url.match(/spotify:playlist:([A-Za-z0-9-_]+)/);
  if (m1) return m1[1];
  const m2 = url.match(/playlist\/([A-Za-z0-9-_]+)/);
  if (m2) return m2[1];
  const m3 = url.match(/[?&]id=([A-Za-z0-9-_]+)/);
  if (m3) return m3[1];
  return null;
}

async function fetchPlaylistTracks(playlistId) {
  const token = localStorage.getItem('access_token');
  if (!token) return [];
  const limit = 50;
  let offset = 0;
  let all = [];
  // get meta to know total (more robust)
  try {
    const metaResp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!metaResp.ok) return [];
    const meta = await metaResp.json();
    const total = meta.tracks?.total || 0;
    while (offset < total) {
      const resp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!resp.ok) break;
      const data = await resp.json();
      const valid = (data.items || []).filter(i => i && i.track && i.track.uri && !i.is_local);
      all.push(...valid);
      offset += limit;
      if (!data.items || data.items.length === 0) break;
    }
    return all;
  } catch (err) {
    console.error('fetchPlaylistTracks error', err);
    return [];
  }
}

// play via Web API using deviceId if available; returns true only if 204
async function playTrack(uri) {
  const token = localStorage.getItem('access_token');
  if (!token) return false;
  await spotifyReady;
  let waited = 0;
  while (!window.deviceId && waited < 4000) { await new Promise(r => setTimeout(r, 200)); waited += 200; }
  try {
    const deviceParam = window.deviceId ? `?device_id=${window.deviceId}` : '';
    const resp = await fetch(`https://api.spotify.com/v1/me/player/play${deviceParam}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri] })
    });
    if (resp.status === 204) {
      isPlaying = true;
      return true;
    } else {
      // not 204 -> error (e.g., no active device)
      console.warn('playTrack non-204', resp.status);
      return false;
    }
  } catch (err) {
    console.error('playTrack error', err);
    return false;
  }
}

async function pauseTrack() {
  const token = localStorage.getItem('access_token');
  if (!token) return;
  try {
    await fetch('https://api.spotify.com/v1/me/player/pause', { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` } });
  } catch (e) { console.warn('pause error', e); }
  isPlaying = false;
}

// build wheel with centered labels per segment
function buildWheel(categories) {
  const wheel = document.getElementById('wheel');
  const container = document.getElementById('wheel-section');
  wheel.innerHTML = '';
  if (!categories || categories.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';

  const n = categories.length;
  const slice = 360 / n;
  // colors: hue stepping
  const stops = [];
  for (let i = 0; i < n; i++) {
    const hue = (i * (360 / n)) % 360;
    const c = `hsl(${Math.round(hue)} 70% 55%)`;
    stops.push(`${c} ${i * slice}deg ${(i + 1) * slice}deg`);
  }
  wheel.style.background = `conic-gradient(${stops.join(',')})`;
  // insert labels centered in each segment
  for (let i = 0; i < n; i++) {
    const angleCenter = i * slice + slice / 2;
    const lbl = document.createElement('div');
    lbl.className = 'wheel-label';
    // Transform: rotate to segment center, translate outward, rotate back so text upright
    // translateY negative moves upward relative to center; tuned value relative to wheel radius
    const translateY = `translateY(-42%)`;
    lbl.style.transform = `rotate(${angleCenter}deg) ${translateY} rotate(${-angleCenter}deg)`;
    lbl.textContent = categories[i];
    wheel.appendChild(lbl);
  }

  // reset rotation
  wheel.style.transition = 'none';
  wheel.style.transform = 'rotate(0deg)';
  setTimeout(() => { wheel.style.transition = 'transform 3s cubic-bezier(.25,.9,.1,1)'; }, 20);
}

// spin wheel, pick random segment
async function spinWheelAndPick(categories) {
  if (!categories || categories.length === 0) return null;
  if (isSpinning) return null;
  isSpinning = true;
  // pick index
  const n = categories.length;
  const slice = 360 / n;
  const targetIdx = Math.floor(Math.random() * n);
  const randomJitter = (Math.random() * (slice - 8)) - (slice / 2 - 4); // jitter around center
  const centerAngle = targetIdx * slice + slice / 2 + randomJitter;
  // compute rotation so centerAngle ends at pointer (top = 0deg)
  const full = 4 + Math.floor(Math.random() * 2); // 4 or 5 spins
  const finalRotation = full * 360 + (360 - centerAngle);

  const wheel = document.getElementById('wheel');
  wheel.style.transition = 'transform 3s cubic-bezier(.25,.9,.1,1)';
  wheel.style.transform = `rotate(${finalRotation}deg)`;

  await new Promise((resolve) => {
    const onEnd = () => { wheel.removeEventListener('transitionend', onEnd); resolve(); };
    wheel.addEventListener('transitionend', onEnd);
    // safety fallback
    setTimeout(resolve, 3500);
  });

  // normalize transform to keep values small
  const normalized = finalRotation % 360;
  wheel.style.transition = 'none';
  wheel.style.transform = `rotate(${normalized}deg)`;
  setTimeout(() => { wheel.style.transition = 'transform 3s cubic-bezier(.25,.9,.1,1)'; }, 30);

  isSpinning = false;
  return { index: targetIdx, category: categories[targetIdx] };
}

// show collapsed track details initially, expand when clicked (with Weiter inside)
function setupTrackDetails(track) {
  const td = document.getElementById('track-details');
  td.style.display = 'none'; // ensure hidden until song started
  td.innerHTML = 'Songinfos auflösen';
  // onclick will expand/collapse
  let expanded = false;
  td.onclick = () => {
    if (!expanded) {
      td.innerHTML = `
        <div>
          <p><strong>Titel:</strong> ${escapeHtml(track.name)}</p>
          <p><strong>Interpret:</strong> ${track.artists.map(a => escapeHtml(a.name)).join(', ')}</p>
          <p><strong>Album:</strong> ${escapeHtml(track.album?.name || '')}</p>
        </div>
      `;
      const btn = document.createElement('button');
      btn.className = 'btn details-weiter-btn green';
      btn.textContent = 'Weiter';
      td.appendChild(btn);
      btn.onclick = async (ev) => {
        ev.stopPropagation();
        // stop current playback and prepare next
        await stopPulse(); // ensure pulse timers cleared
        await pauseTrack();
        await prepareNextTrack();
      };
      expanded = true;
    } else {
      td.innerHTML = 'Songinfos auflösen';
      expanded = false;
    }
  };
}

// prepare next track (pick random), show wheel if categories exist, else auto play
async function prepareNextTrack() {
  if (!cachedPlaylistTracks || cachedPlaylistTracks.length === 0) {
    M.toast({ html: 'Keine weiteren Songs verfügbar.', classes: 'rounded' });
    return;
  }
  const idx = Math.floor(Math.random() * cachedPlaylistTracks.length);
  const item = cachedPlaylistTracks[idx];
  currentPreparedItem = item;
  selectedTrackUri = item.track.uri;

  // hide details until playback started
  const td = document.getElementById('track-details');
  td.style.display = 'none';
  td.innerHTML = 'Songinfos auflösen';

  const wheelSection = document.getElementById('wheel-section');
  const nowPlaying = document.getElementById('now-playing');
  const nowText = document.getElementById('now-playing-text');

  if (bingoCategories && bingoCategories.length > 0) {
    // show wheel and prompt spin
    buildWheel(bingoCategories);
    wheelSection.style.display = 'block';
    nowPlaying.style.display = 'block';
    nowText.textContent = 'Kategorie wählen';
    // Wait for user to spin; do not auto-play
  } else {
    // no categories: auto play immediately, show details after play started
    wheelSection.style.display = 'none';
    nowPlaying.style.display = 'block';
    nowText.textContent = 'Song läuft …';
    const ok = await playTrack(selectedTrackUri);
    if (ok) {
      // display details panel now that track is playing
      document.getElementById('track-details').style.display = 'block';
      setupTrackDetails(item.track);
      // remove from cache to avoid repeats
      cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);
    } else {
      M.toast({ html: 'Fehler beim Starten des Songs (prüfe aktives Spotify-Device).', classes: 'rounded' });
    }
  }
}

// spin handler (user clicked wheel while not playing)
async function handleSpinClick() {
  if (isSpinning) return;
  if (!currentPreparedItem) { M.toast({ html: 'Kein vorbereiteter Song gefunden.', classes: 'rounded' }); return; }
  // spin wheel and determine category
  const res = await spinWheelAndPick(bingoCategories);
  if (!res) return;
  // show chosen category
  document.getElementById('now-playing-text').textContent = `Kategorie: ${res.category}`;
  // start playing selected track
  const ok = await playTrack(selectedTrackUri);
  if (ok) {
    // show track details now that song is playing
    const td = document.getElementById('track-details');
    td.style.display = 'block';
    setupTrackDetails(currentPreparedItem.track);
    // remove played from cache
    cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);
  } else {
    M.toast({ html: 'Fehler beim Abspielen (kein aktives Device).', classes: 'rounded' });
  }
}

// pulse during playback: 15s white then 5s red then stop playback
function clearPulseTimers() {
  pulseTimers.forEach(t => clearTimeout(t));
  pulseTimers = [];
  const wheel = document.getElementById('wheel');
  wheel.classList.remove('pulse-white', 'pulse-red');
}

async function stopPulse() {
  clearPulseTimers();
}

function startPulseDuringPlayback() {
  if (!isPlaying) { return; }
  const wheel = document.getElementById('wheel');
  // prevent double start
  if (wheel.classList.contains('pulse-white') || wheel.classList.contains('pulse-red')) return;
  wheel.classList.add('pulse-white');
  // after 15s -> red
  const t1 = setTimeout(() => {
    wheel.classList.remove('pulse-white');
    wheel.classList.add('pulse-red');
  }, 15000);
  // after 20s -> stop playback and clear
  const t2 = setTimeout(async () => {
    wheel.classList.remove('pulse-red');
    // pause playback
    await pauseTrack();
    M.toast({ html: 'Song gestoppt (Disco-Zeit abgelaufen).', classes: 'rounded' });
    clearPulseTimers();
    // after stop, allow preparing next track etc.
  }, 20000);
  pulseTimers.push(t1, t2);
}

// ---------------- init --------------
document.addEventListener('DOMContentLoaded', async () => {
  // token check
  const token = localStorage.getItem('access_token');
  if (!token) { window.location.href = 'index.html'; return; }

  // load categories (if any)
  try { bingoCategories = JSON.parse(localStorage.getItem('bingoCategories') || '[]'); } catch { bingoCategories = []; }

  // load playlist
  const playlistUrl = localStorage.getItem('bingoPlaylistUrl') || localStorage.getItem('mobilePlaylistUrl') || '';
  const playlistId = extractPlaylistId(playlistUrl);
  if (!playlistId) {
    document.getElementById('loading-text').style.display = 'none';
    M.toast({ html: 'Keine gültige Playlist gefunden. Bitte Playlist eintragen.', classes: 'rounded' });
    document.getElementById('empty-warning').style.display = 'block';
    return;
  }

  document.getElementById('loading-text').style.display = 'block';
  cachedPlaylistTracks = await fetchPlaylistTracks(playlistId);
  document.getElementById('loading-text').style.display = 'none';

  if (!cachedPlaylistTracks || cachedPlaylistTracks.length === 0) {
    document.getElementById('empty-warning').style.display = 'block';
    return;
  }

  // show start button
  const startBtn = document.getElementById('start-btn');
  startBtn.style.display = 'inline-block';
  startBtn.classList.add('pulse');

  // start prepares the first track (but does not auto-play if categories exist)
  startBtn.addEventListener('click', async () => {
    startBtn.style.display = 'none';
    await prepareNextTrack();
  });

  // wheel click logic:
  // - if nothing playing and a prepared track exists -> spin -> start song
  // - if song playing -> start pulse sequence
  const wheel = document.getElementById('wheel');
  wheel.addEventListener('click', async () => {
    if (isSpinning) return;
    if (!isPlaying && currentPreparedItem && bingoCategories.length > 0) {
      // spin to pick category and start
      await handleSpinClick();
      return;
    }
    if (isPlaying) {
      // start pulse
      startPulseDuringPlayback();
      return;
    }
  });
});

// small helper to escape text content (basic)
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
