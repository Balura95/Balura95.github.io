// bingo-start.js - erweitert:
// - Labels zentriert
// - "Spin the wheel" Hinweis über dem Rad bis erstes Anklicken
// - Trackdetails erscheinen erst nach dem Stop des Spins (wenn Kategorien vorhanden)
// - Während des laufenden Songs: Rad klicken -> 15s weiß pulsieren -> 5s rot pulsieren -> Pause

let cachedPlaylistTracks = [];
let selectedTrackUri = null;
let currentPreparedItem = null;
let bingoCategories = [];
let isSpinning = false;
let isPulsing = false;
let spinHappened = false; // ob das Rad schon einmal gedreht wurde
let pulseTimers = { whiteTimeout: null, redTimeout: null, endTimeout: null };
let spotifyReady = null;

//--------------------- Hilfsfunktionen ---------------------
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
  const all = []; const limit = 50; let offset = 0;
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

spotifyReady = new Promise((resolve) => {
  window.onSpotifyWebPlaybackSDKReady = () => {
    const token = localStorage.getItem('access_token');
    if (!token) { resolve(); return; }
    const player = new Spotify.Player({ name: 'Julster Bingo Player', getOAuthToken: cb => cb(token) });
    player.addListener('ready', ({ device_id }) => { window.deviceId = device_id; window.bingoPlayer = player; resolve(); });
    player.addListener('initialization_error', ({ message }) => { console.error(message); resolve(); });
    player.addListener('authentication_error', ({ message }) => { console.error(message); resolve(); });
    player.connect().catch(err => { console.warn('player connect err', err); resolve(); });
  };
});

async function playTrack(uri) {
  const token = localStorage.getItem('access_token');
  if (!token) return false;
  await spotifyReady;
  let wt = 0;
  while (!window.deviceId && wt < 6000) { await new Promise(r => setTimeout(r, 200)); wt += 200; }
  try {
    const deviceParam = window.deviceId ? `?device_id=${window.deviceId}` : '';
    const resp = await fetch(`https://api.spotify.com/v1/me/player/play${deviceParam}`, {
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
    await fetch('https://api.spotify.com/v1/me/player/pause', {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  } catch (err) { console.warn('stopPlayback error', err); }
}

function getRandomTrackIdx(tracks) { return Math.floor(Math.random() * tracks.length); }

// --------------------- WHEEL / UI ---------------------
function buildWheel(categories) {
  const wheel = document.getElementById('wheel');
  const container = document.getElementById('wheel-container');
  wheel.innerHTML = '';
  if (!categories || categories.length === 0) { container.style.display = 'none'; return; }
  container.style.display = 'block';

  const n = categories.length;
  const angle = 360 / n;
  const stops = [];
  for (let i = 0; i < n; i++) {
    const hue = Math.round((i * (360 / n)) % 360);
    const color = `hsl(${hue} 70% 60%)`;
    const start = i * angle;
    const end = (i + 1) * angle;
    stops.push(`${color} ${start}deg ${end}deg`);
  }
  wheel.style.background = `conic-gradient(${stops.join(',')})`;

  // Labels: zentriert in Segment
  for (let i = 0; i < n; i++) {
    const rot = i * angle + angle / 2;
    const lbl = document.createElement('div');
    lbl.className = 'wheel-label';
    // First rotate to segment center, then translate outward, then rotate back to keep text upright
    lbl.style.transform = `rotate(${rot}deg) translateY(-42%) rotate(${-rot}deg)`;
    lbl.style.left = '50%'; lbl.style.top = '50%';
    lbl.style.textAlign = 'center';
    lbl.textContent = categories[i];
    wheel.appendChild(lbl);
  }

  // reset rotation
  wheel.style.transition = 'none';
  wheel.style.transform = 'rotate(0deg)';
  setTimeout(() => { wheel.style.transition = 'transform 3s cubic-bezier(.25,.9,.1,1)'; }, 30);
}

// spin the wheel for 3s and return chosen index/category
async function spinWheelAndPick(categories) {
  if (!categories || categories.length === 0) return null;
  if (isSpinning) return null;
  isSpinning = true;
  spinHappened = true;
  document.getElementById('spin-hint').style.display = 'none';

  const wheel = document.getElementById('wheel');
  const n = categories.length;
  const angle = 360 / n;
  const targetIdx = Math.floor(Math.random() * n);
  const randomOffset = (Math.random() * (angle - 8)) + 4;
  const targetAngleFromTop = (targetIdx * angle) + angle / 2;
  const fullRounds = 4 + Math.floor(Math.random() * 2);
  const finalRotation = fullRounds * 360 + (360 - targetAngleFromTop) + (angle / 2 - randomOffset);

  wheel.style.transition = 'transform 3s cubic-bezier(.25,.9,.1,1)';
  wheel.style.transform = `rotate(${finalRotation}deg)`;

  await new Promise((resolve) => {
    const onEnd = () => { wheel.removeEventListener('transitionend', onEnd); resolve(); };
    wheel.addEventListener('transitionend', onEnd);
    setTimeout(() => { resolve(); }, 3500);
  });

  // normalize
  wheel.style.transition = 'none';
  const normalized = finalRotation % 360;
  wheel.style.transform = `rotate(${normalized}deg)`;
  setTimeout(() => { wheel.style.transition = 'transform 3s cubic-bezier(.25,.9,.1,1)'; }, 20);

  isSpinning = false;
  return { index: targetIdx, category: categories[targetIdx] };
}

// When a spin finished -> show category, start playing & reveal trackbox
async function handleSpinStart() {
  if (!bingoCategories || bingoCategories.length === 0) return;
  const result = await spinWheelAndPick(bingoCategories);
  if (!result) return;
  document.getElementById('now-playing-text').textContent = `Kategorie: ${result.category}`;
  // Start the prepared track
  if (currentPreparedItem && currentPreparedItem.track && selectedTrackUri) {
    const ok = await playTrack(selectedTrackUri);
    if (!ok) M.toast({ html: 'Fehler beim Abspielen des Songs', classes: 'rounded' });
    // show track-details now that spin is finished and song started
    const td = document.getElementById('track-details');
    td.style.display = 'block';
    updateTrackDetailsElement(currentPreparedItem.track);
    // remove from cache
    cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);
    document.getElementById('now-playing-text').textContent = 'Song läuft …';
  }
}

// update track box (toggle -> show details and Weiter button)
function updateTrackDetailsElement(track) {
  const details = document.getElementById('track-details');
  if (!details) return;
  // collapsed by default; we want click to expand
  details.innerHTML = 'Songinfos auflösen';
  let expanded = false;
  details.onclick = () => {
    if (!expanded) {
      details.innerHTML = `
        <div>
          <p><strong>Titel:</strong> ${track.name}</p>
          <p><strong>Interpret:</strong> ${track.artists.map(a => a.name).join(', ')}</p>
          <p><strong>Album:</strong> ${track.album?.name || ''}</p>
        </div>
      `;
      const weiterBtn = document.createElement('button');
      weiterBtn.className = 'btn details-weiter-btn green';
      weiterBtn.textContent = 'Weiter';
      weiterBtn.type = 'button';
      details.appendChild(weiterBtn);

      weiterBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        // pause and prepare next
        await stopPlayback();
        // clear possible pulses
        stopPulse();
        await prepareNextTrack();
      });

      expanded = true;
    } else {
      details.innerHTML = 'Songinfos auflösen';
      expanded = false;
    }
  };
}

// prepare next track but do not play if categories exist (wait for spin)
async function prepareNextTrack() {
  if (!cachedPlaylistTracks || cachedPlaylistTracks.length === 0) {
    M.toast({ html: 'Keine weiteren Songs verfügbar.', classes: 'rounded' });
    return;
  }
  const idx = getRandomTrackIdx(cachedPlaylistTracks);
  const item = cachedPlaylistTracks[idx];
  currentPreparedItem = item;
  selectedTrackUri = item.track.uri;

  // Hide track details until spin completed (if categories exist)
  const td = document.getElementById('track-details');
  td.style.display = 'none';
  td.innerHTML = 'Songinfos auflösen';

  if (bingoCategories && bingoCategories.length > 0) {
    // build wheel and show hint until user clicks wheel
    buildWheel(bingoCategories);
    document.getElementById('spin-hint').style.display = spinHappened ? 'none' : 'block';
    document.getElementById('wheel-container').style.display = 'block';
    document.getElementById('now-playing').style.display = 'block';
    document.getElementById('now-playing-text').textContent = 'Kategorie wählen';
  } else {
    // no categories -> play immediately and show details
    document.getElementById('wheel-container').style.display = 'none';
    document.getElementById('now-playing').style.display = 'block';
    document.getElementById('now-playing-text').textContent = 'Song läuft …';
    const ok = await playTrack(selectedTrackUri);
    if (!ok) M.toast({ html: 'Fehler beim Abspielen des Songs', classes: 'rounded' });
    td.style.display = 'block';
    updateTrackDetailsElement(item.track);
    cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);
  }
}

// click-on-wheel behavior during playback: start pulsing then stop after 20s (15 white, 5 red)
function startPulse() {
  if (isPulsing) return;
  isPulsing = true;
  const wheel = document.getElementById('wheel');
  // start white pulse
  wheel.classList.remove('pulse-red'); wheel.classList.add('pulse-white');
  // clear previous timers
  clearPulseTimers();

  // after 15s switch to red
  pulseTimers.whiteTimeout = setTimeout(() => {
    wheel.classList.remove('pulse-white'); wheel.classList.add('pulse-red');
  }, 15000);

  // after 20s stop pulse and pause playback
  pulseTimers.endTimeout = setTimeout(async () => {
    stopPulse();
    await stopPlayback();
    M.toast({ html: 'Song gestoppt (Disco-Zeit abgelaufen).', classes: 'rounded' });
  }, 20000);
}

function stopPulse() {
  isPulsing = false;
  const wheel = document.getElementById('wheel');
  wheel.classList.remove('pulse-white'); wheel.classList.remove('pulse-red');
  clearPulseTimers();
}

function clearPulseTimers() {
  if (pulseTimers.whiteTimeout) { clearTimeout(pulseTimers.whiteTimeout); pulseTimers.whiteTimeout = null; }
  if (pulseTimers.redTimeout) { clearTimeout(pulseTimers.redTimeout); pulseTimers.redTimeout = null; }
  if (pulseTimers.endTimeout) { clearTimeout(pulseTimers.endTimeout); pulseTimers.endTimeout = null; }
}

// --------------------- Init & wiring ---------------------
document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('access_token');
  if (!token) { window.location.href = 'index.html'; return; }

  const loadingText = document.getElementById('loading-text');
  const startBtn = document.getElementById('start-btn');
  const wheel = document.getElementById('wheel');
  const wheelContainer = document.getElementById('wheel-container');

  // read categories
  try { bingoCategories = JSON.parse(localStorage.getItem('bingoCategories') || '[]'); } catch(e){ bingoCategories = []; }

  // load playlist
  const playlistUrl = localStorage.getItem('bingoPlaylistUrl') || localStorage.getItem('mobilePlaylistUrl') || '';
  const playlistId = extractPlaylistId(playlistUrl);
  if (!playlistId) {
    M.toast({ html: 'Keine gültige Playlist gefunden. Bitte Playlist eintragen.', classes: 'rounded' });
    document.getElementById('loading-text').style.display = 'none';
    document.getElementById('empty-warning').style.display = 'block';
    return;
  }

  loadingText.style.display = 'block';
  cachedPlaylistTracks = await fetchPlaylistTracks(playlistId);
  loadingText.style.display = 'none';

  if (!cachedPlaylistTracks || cachedPlaylistTracks.length === 0) {
    document.getElementById('empty-warning').style.display = 'block';
    return;
  }

  // show start button
  startBtn.style.display = 'inline-block';
  startBtn.classList.add('pulse');

  // Start: prepare first track (but if categories exist, wait for spin)
  startBtn.addEventListener('click', async () => {
    startBtn.style.display = 'none';
    await prepareNextTrack();
  });

  // Wheel click behavior:
  // - if not spinning, and categories exist, it's a spin (if no song is playing)
  // - if song is playing, clicking wheel will start pulse (disco light)
  wheel.addEventListener('click', async () => {
    // if currently spinning, ignore
    if (isSpinning) return;

    // if there is a prepared track but not yet playing and categories exist -> spin to start
    // Determine if something is playing by checking cached removal: if currentPreparedItem exists and it's still in cache, then probably not playing yet.
    const nowPlayingText = document.getElementById('now-playing-text').textContent || '';
    const songIsPlaying = nowPlayingText.includes('Song läuft');

    if (!songIsPlaying && bingoCategories && bingoCategories.length > 0 && currentPreparedItem) {
      // Do spin & start
      await handleSpinStart();
      // after play started, spinHappened true and track-details now visible
      return;
    }

    // else if song is playing -> start pulse (disco light)
    if (songIsPlaying && !isPulsing) {
      startPulse();
      return;
    }
  });

});
