// bingo-start.js
// Vollständige, robuste Version mit Spotify-Playlist-Laden, Glücksrad, Spin, Pulse, Track-Details

// --- State ---
let cachedPlaylistTracks = [];
let bingoCategories = [];
let currentPreparedItem = null;
let selectedTrackUri = null;
let isSpinning = false;
let hasSpunThisSong = false;
let isPlaying = false;
let isPulsing = false;
let pulseTimers = [];
let spotifyReady = null;

// --- Spotify Web Playback SDK readiness (optional) ---
spotifyReady = new Promise((resolve) => {
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
    player.addListener('initialization_error', ({ message }) => { console.error('SDK init error', message); resolve(); });
    player.addListener('authentication_error', ({ message }) => { console.error('SDK auth error', message); resolve(); });
    player.addListener('account_error', ({ message }) => { console.error('SDK account error', message); resolve(); });
    player.connect().catch(err => { console.warn('SDK connect failed', err); resolve(); });
  };
});

// --- Helpers ---
function extractPlaylistId(url) {
  if (!url) return null;
  let m = url.match(/spotify:playlist:([A-Za-z0-9-_]+)/);
  if (m) return m[1];
  m = url.match(/playlist\/([A-Za-z0-9-_]+)/);
  if (m) return m[1];
  m = url.match(/[?&]id=([A-Za-z0-9-_]+)/);
  if (m) return m[1];
  return null;
}

async function fetchPlaylistTracks(playlistId) {
  const token = localStorage.getItem('access_token');
  if (!token) return [];
  const all = [];
  const limit = 50;
  let offset = 0;
  try {
    // Meta to get total (more reliable)
    const metaResp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!metaResp.ok) {
      console.error('Playlist meta error', await metaResp.text());
      return [];
    }
    const meta = await metaResp.json();
    const total = meta.tracks?.total || 0;
    while (offset < total) {
      const resp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!resp.ok) {
        console.error('Tracks fetch error', await resp.text());
        break;
      }
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

async function fetchUserName(userId) {
  const token = localStorage.getItem('access_token');
  if (!token) return userId;
  try {
    const resp = await fetch(`https://api.spotify.com/v1/users/${userId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!resp.ok) return userId;
    const data = await resp.json();
    return (data.display_name && data.display_name.trim() !== "") ? data.display_name : data.id;
  } catch (err) {
    console.error('fetchUserName error', err);
    return userId;
  }
}

// Play a track; returns true if started (204)
async function playTrack(uri) {
  const token = localStorage.getItem('access_token');
  if (!token) return false;
  await spotifyReady;
  // wait a little for deviceId (if SDK used)
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
      console.warn('playTrack non-204', resp.status);
      return false;
    }
  } catch (err) {
    console.error('playTrack error', err);
    return false;
  }
}

async function stopPlayback() {
  const token = localStorage.getItem('access_token');
  if (!token) return;
  try {
    await fetch('https://api.spotify.com/v1/me/player/pause', {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  } catch (err) {
    console.warn('stopPlayback error', err);
  }
  isPlaying = false;
}

// --- Wheel building & labels centered + different colors ---
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
  const angle = 360 / n;
  // build conic-gradient stops with varied HSL
  const stops = [];
  for (let i = 0; i < n; i++) {
    const hue = Math.round((i * (360 / n)) % 360);
    const color = `hsl(${hue} 75% 50%)`;
    const start = i * angle;
    const end = (i + 1) * angle;
    stops.push(`${color} ${start}deg ${end}deg`);
  }
  wheel.style.background = `conic-gradient(${stops.join(',')})`;

  // place labels centrally in each segment
  for (let i = 0; i < n; i++) {
    const lbl = document.createElement('div');
    lbl.className = 'wheel-label';
    // center angle for segment
    const rot = i * angle + angle / 2;
    // transform: rotate to segment center, translate outward, rotate back so text is upright
    // translateY negative moves label toward top; use percent for responsiveness
    lbl.style.transform = `rotate(${rot}deg) translateY(-42%) rotate(${-rot}deg)`;
    lbl.style.left = '50%';
    lbl.style.top = '50%';
    lbl.style.width = '45%';
    lbl.style.textAlign = 'center';
    lbl.style.fontWeight = '600';
    lbl.style.color = '#fff';
    lbl.style.pointerEvents = 'none';
    lbl.textContent = categories[i];
    wheel.appendChild(lbl);
  }

  // reset rotation to 0
  wheel.style.transition = 'none';
  wheel.style.transform = 'rotate(0deg)';
  setTimeout(() => { wheel.style.transition = 'transform 3s cubic-bezier(.25,.9,.1,1)'; }, 30);
}

function resetWheelVisual() {
  const wheel = document.getElementById('wheel');
  wheel.style.transition = 'none';
  wheel.style.transform = 'rotate(0deg)';
  wheel.classList.remove('pulse-yellow', 'pulse-red');
  setTimeout(() => { wheel.style.transition = 'transform 3s cubic-bezier(.25,.9,.1,1)'; }, 30);
}

// --- Spin logic ---
async function spinWheelAndPick(categories) {
  if (isSpinning) return null;
  isSpinning = true;
  const n = categories.length;
  const angle = 360 / n;
  const targetIdx = Math.floor(Math.random() * n);
  const randomOffset = (Math.random() * (angle - 8)) + 4;
  const targetAngleFromTop = (targetIdx * angle) + angle / 2;
  const fullRounds = 4 + Math.floor(Math.random() * 2);
  const finalRotation = fullRounds * 360 + (360 - targetAngleFromTop) + (angle / 2 - randomOffset);

  const wheel = document.getElementById('wheel');
  wheel.style.transition = 'transform 3s cubic-bezier(.25,.9,.1,1)';
  wheel.style.transform = `rotate(${finalRotation}deg)`;

  await new Promise(resolve => {
    const onEnd = () => { wheel.removeEventListener('transitionend', onEnd); resolve(); };
    wheel.addEventListener('transitionend', onEnd);
    setTimeout(resolve, 3600); // safety
  });

  // normalize
  const normalized = finalRotation % 360;
  wheel.style.transition = 'none';
  wheel.style.transform = `rotate(${normalized}deg)`;
  setTimeout(() => { wheel.style.transition = 'transform 3s cubic-bezier(.25,.9,.1,1)'; }, 30);

  isSpinning = false;
  return { index: targetIdx, category: categories[targetIdx] };
}

// --- Track details (toggle like before) ---
function updateTrackDetails(track, addedBy) {
  const detailsContainer = document.getElementById('track-details');
  if (!detailsContainer) return;
  detailsContainer.innerHTML = 'Songinfos auflösen';
  detailsContainer.style.display = 'none'; // will be shown only after playback started
  let expanded = false;

  detailsContainer.onclick = async function() {
    if (!expanded) {
      // fetch added by name if needed
      let addedByName = "unbekannt";
      if (addedBy) {
        if (addedBy.display_name && addedBy.display_name.trim() !== "") {
          addedByName = addedBy.display_name;
        } else if (addedBy.id) {
          addedByName = await fetchUserName(addedBy.id);
        }
      }
      const title = track.name || 'Unbekannt';
      const artists = (track.artists || []).map(a => a.name).join(', ');
      const album = track.album?.name || '';
      const year = track.album?.release_date ? track.album.release_date.substring(0,4) : '';
      detailsContainer.innerHTML = `
        <p id="track-title"><strong>Titel:</strong> ${escapeHtml(title)}</p>
        <p id="track-artist"><strong>Interpret:</strong> ${escapeHtml(artists)}</p>
        <p id="track-album"><strong>Album:</strong> ${escapeHtml(album)}</p>
        <p id="track-year"><strong>Jahr:</strong> ${escapeHtml(year)}</p>
        <p id="track-added"><strong>Hinzugefügt von:</strong> ${escapeHtml(addedByName)}</p>
      `;

      // Weiter-Button inside
      const weiter = document.createElement('button');
      weiter.className = 'btn details-weiter-btn green';
      weiter.textContent = 'Weiter';
      detailsContainer.appendChild(weiter);

      weiter.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        // Reset for next song:
        clearPulseTimers();
        await stopPlayback();
        isPlaying = false;
        hasSpunThisSong = false;
        resetWheelVisual();
        detailsContainer.style.display = 'none';
        // prepare next track
        await prepareNextTrack();
      });

      expanded = true;
    } else {
      detailsContainer.innerHTML = 'Songinfos auflösen';
      expanded = false;
    }
  };
}

// --- Pulse logic (15s yellow, 5s red) ---
function clearPulseTimers() {
  pulseTimers.forEach(t => clearTimeout(t));
  pulseTimers = [];
  const wheel = document.getElementById('wheel');
  wheel.classList.remove('pulse-yellow');
  wheel.classList.remove('pulse-red');
  isPulsing = false;
}

function startPulseDuringPlayback() {
  if (!isPlaying || isPulsing) return;
  isPulsing = true;
  const wheel = document.getElementById('wheel');
  wheel.classList.remove('pulse-red');
  wheel.classList.add('pulse-yellow');

  // after 15s -> red
  const t1 = setTimeout(() => {
    wheel.classList.remove('pulse-yellow');
    wheel.classList.add('pulse-red');
  }, 15000);

  // after 20s -> stop playback and clear
  const t2 = setTimeout(async () => {
    wheel.classList.remove('pulse-red');
    await stopPlayback();
    isPlaying = false;
    isPulsing = false;
    M.toast({ html: 'Song gestoppt (Discozeit abgelaufen).', classes: 'rounded' });
  }, 20000);

  pulseTimers.push(t1, t2);
}

// --- Prepare next track (pick random but do not play if categories exist) ---
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
    // show wheel & prompt to spin (do NOT auto-play)
    buildWheel(bingoCategories);
    wheelSection.style.display = 'block';
    nowPlaying.style.display = 'block';
    nowText.textContent = 'Kategorie wählen';
    hasSpunThisSong = false;
  } else {
    // no categories -> play immediately
    wheelSection.style.display = 'none';
    nowPlaying.style.display = 'block';
    nowText.textContent = 'Song läuft …';
    const ok = await playTrack(selectedTrackUri);
    if (ok) {
      td.style.display = 'block';
      updateTrackDetails(item.track, item.added_by);
      // remove played track from cache
      cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);
    } else {
      M.toast({ html: 'Fehler beim Abspielen des Songs (kein aktives Device).', classes: 'rounded' });
    }
  }
}

// --- Wheel click handling: spin OR pulse depending on state ---
async function handleWheelClick() {
  if (isSpinning) return;

  const nowPlayingText = document.getElementById('now-playing-text').textContent || '';
  const songIsPlaying = isPlaying === true;

  // If not playing and not spun this song -> spin & start
  if (!songIsPlaying && currentPreparedItem && !hasSpunThisSong && bingoCategories.length > 0) {
    const res = await spinWheelAndPick(bingoCategories);
    if (!res) return;
    document.getElementById('now-playing-text').textContent = `Kategorie: ${res.category}`;
    const ok = await playTrack(selectedTrackUri);
    if (ok) {
      isPlaying = true;
      hasSpunThisSong = true;
      // show details box now song started
      const td = document.getElementById('track-details');
      td.style.display = 'block';
      updateTrackDetails(currentPreparedItem.track, currentPreparedItem.added_by);
      // remove played track from cache
      cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);
      setTimeout(() => { document.getElementById('now-playing-text').textContent = 'Song läuft …'; }, 300);
    } else {
      M.toast({ html: 'Fehler beim Abspielen (kein aktives Spotify-Device).', classes: 'rounded' });
    }
    return;
  }

  // If playing and already spun for this song -> start pulse
  if (songIsPlaying && hasSpunThisSong && !isPulsing) {
    startPulseDuringPlayback();
    return;
  }

  // else: ignore (e.g., no prepared item)
}

// --- Init & wiring ---
document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('access_token');
  if (!token) { window.location.href = 'index.html'; return; }

  // Read categories & show wheel heading later
  try { bingoCategories = JSON.parse(localStorage.getItem('bingoCategories') || '[]'); } catch { bingoCategories = []; }

  // Load playlist (show loading text until done)
  const playlistUrl = localStorage.getItem('bingoPlaylistUrl') || localStorage.getItem('mobilePlaylistUrl') || '';
  const playlistId = extractPlaylistId(playlistUrl);
  if (!playlistId) {
    document.getElementById('loading-text').textContent = 'Keine gültige Playlist gefunden.';
    document.getElementById('empty-warning').style.display = 'block';
    return;
  }

  // Show loading indicator until tracks loaded
  document.getElementById('loading-text').style.display = 'block';
  cachedPlaylistTracks = await fetchPlaylistTracks(playlistId);
  document.getElementById('loading-text').style.display = 'none';

  if (!cachedPlaylistTracks || cachedPlaylistTracks.length === 0) {
    document.getElementById('empty-warning').style.display = 'block';
    return;
  }

  // Show Start button now
  const startBtn = document.getElementById('start-btn');
  startBtn.style.display = 'inline-block';

  // Wiring: Start -> prepare first track (no autoplay if categories exist)
  startBtn.addEventListener('click', async () => {
    startBtn.style.display = 'none';
    await prepareNextTrack();
  });

  // Build initial wheel if categories present (labels + colors)
  if (bingoCategories && bingoCategories.length > 0) {
    buildWheel(bingoCategories);
  }

  // Wheel click listener
  const wheelEl = document.getElementById('wheel');
  wheelEl.addEventListener('click', async () => {
    await handleWheelClick();
  });
});

// --- small helper ---
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
