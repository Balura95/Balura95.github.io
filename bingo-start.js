// bingo-start.js
// Lädt Playlist aus localStorage (bingoPlaylistUrl oder mobilePlaylistUrl),
// zeigt "Playlist wird geladen..." bis alle Tracks geladen sind.
// Zeigt anschließend runden Start-Button. Nach Start: Song läuft, Trackinfos auflösen
// und zentraler "Weiter"-Button innerhalb des Track-Boxes.

let cachedPlaylistTracks = [];
let selectedTrackUri = null;
let spotifyReady = null;

// Playlist-ID extrahieren (URI oder Link)
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

// Tracks laden (Pagination)
async function fetchPlaylistTracks(playlistId) {
  const token = localStorage.getItem('access_token');
  if (!token) return [];

  const all = [];
  const limit = 50;
  let offset = 0;
  try {
    const metaResp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!metaResp.ok) {
      console.error('Playlist meta error:', await metaResp.text());
      return [];
    }
    const meta = await metaResp.json();
    const total = meta.tracks?.total || 0;

    while (offset < total) {
      const resp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!resp.ok) {
        console.error('Tracks fetch error:', await resp.text());
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

// Spotify Web Playback SDK initialisieren (wenn verfügbar)
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
      console.log('Spotify Player ready, device id:', device_id);
      resolve();
    });

    // Fehlerbehandlung: resolve trotzdem, damit Fallback / Web-API funktioniert
    player.addListener('initialization_error', ({ message }) => { console.error(message); resolve(); });
    player.addListener('authentication_error', ({ message }) => { console.error(message); resolve(); });
    player.addListener('account_error', ({ message }) => { console.error(message); resolve(); });
    player.addListener('playback_error', ({ message }) => { console.error(message); resolve(); });

    player.connect().catch(err => { console.warn('player connect error', err); resolve(); });
  };
});

// Play a track (Web API) — nutzt deviceId wenn SDK bereit ist
async function playTrack(uri) {
  const token = localStorage.getItem('access_token');
  if (!token) return false;

  await spotifyReady;

  // Warte kurz auf deviceId (falls SDK registriert)
  let waitTime = 0;
  while (!window.deviceId && waitTime < 6000) {
    await new Promise(r => setTimeout(r, 200));
    waitTime += 200;
  }

  try {
    const deviceParam = window.deviceId ? `?device_id=${window.deviceId}` : '';
    const response = await fetch(`https://api.spotify.com/v1/me/player/play${deviceParam}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ uris: [uri] })
    });

    if (response.status === 204) {
      return true;
    } else {
      const txt = await response.text();
      console.error('playTrack response', response.status, txt);
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
}

function getRandomTrack(tracks) {
  if (!tracks || tracks.length === 0) return null;
  const idx = Math.floor(Math.random() * tracks.length);
  return tracks[idx];
}

// Update details box (toggles infos + fügt "Weiter"-Button hinein)
function updateTrackDetailsElement(track) {
  const details = document.getElementById('track-details');
  if (!details) return;
  let expanded = false;

  details.textContent = 'Songinfos auflösen';
  details.onclick = () => {
    if (!expanded) {
      details.innerHTML = `
        <div>
          <p><strong>Titel:</strong> ${track.name}</p>
          <p><strong>Interpret:</strong> ${track.artists.map(a => a.name).join(', ')}</p>
          <p><strong>Album:</strong> ${track.album.name || ''}</p>
          <p><strong>Jahr:</strong> ${track.album.release_date ? track.album.release_date.substring(0,4) : ''}</p>
        </div>
      `;
      const weiterBtn = document.createElement('button');
      weiterBtn.className = 'btn details-weiter-btn green';
      weiterBtn.textContent = 'Weiter';
      weiterBtn.type = 'button';
      details.appendChild(weiterBtn);

      weiterBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        await handleNextSong();
      });

      expanded = true;
    } else {
      details.textContent = 'Songinfos auflösen';
      expanded = false;
    }
  };
}

// handle next song (pauses previous, plays a random track and removes it from cache)
async function handleNextSong() {
  if (!cachedPlaylistTracks || cachedPlaylistTracks.length === 0) {
    if (window.M) M.toast({ html: 'Keine weiteren Songs verfügbar.', classes: 'rounded' });
    return;
  }

  await stopPlayback();
  document.getElementById('now-playing-text').textContent = 'Song läuft …';

  const item = getRandomTrack(cachedPlaylistTracks);
  if (!item || !item.track) {
    if (window.M) M.toast({ html: 'Fehler beim Abrufen des nächsten Songs', classes: 'rounded' });
    return;
  }

  selectedTrackUri = item.track.uri;
  const ok = await playTrack(selectedTrackUri);
  if (!ok && window.M) M.toast({ html: 'Fehler beim Abspielen des Songs', classes: 'rounded' });

  updateTrackDetailsElement(item.track);
  // remove played
  cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);

  if (!cachedPlaylistTracks.length && window.M) {
    M.toast({ html: 'Alle Songs der Playlist wurden abgespielt.', classes: 'rounded' });
  }
}

function showEmptyWarning() {
  document.getElementById('loading-text').style.display = 'none';
  document.getElementById('start-btn').style.display = 'none';
  document.getElementById('empty-warning').style.display = 'block';
}

document.addEventListener('DOMContentLoaded', async () => {
  // token check
  const token = localStorage.getItem('access_token');
  if (!token) { window.location.href = 'index.html'; return; }

  const loadingText = document.getElementById('loading-text');
  const startBtn = document.getElementById('start-btn');
  const nowPlaying = document.getElementById('now-playing');

  // playlist url aus localStorage (bingoPlaylistUrl bevorzugt)
  const playlistUrl = localStorage.getItem('bingoPlaylistUrl') || localStorage.getItem('mobilePlaylistUrl') || '';
  const playlistId = extractPlaylistId(playlistUrl);
  if (!playlistId) {
    if (window.M) M.toast({ html: 'Keine gültige Playlist gefunden. Bitte Playlist eintragen.', classes: 'rounded' });
    return showEmptyWarning();
  }

  // Ladeanzeige an
  loadingText.style.display = 'block';

  try {
    cachedPlaylistTracks = await fetchPlaylistTracks(playlistId);
  } catch (e) {
    console.error('Fehler beim Laden der Playlist:', e);
    cachedPlaylistTracks = [];
  }

  // Ladeanzeige ausblenden
  loadingText.style.display = 'none';

  if (!cachedPlaylistTracks || cachedPlaylistTracks.length === 0) {
    return showEmptyWarning();
  }

  // Playlist geladen -> Start-Button sichtbar
  startBtn.style.display = 'inline-block';
  startBtn.classList.add('pulse');

  // Start: spiele ersten zufälligen Song
  startBtn.addEventListener('click', async () => {
    startBtn.style.display = 'none';
    nowPlaying.style.display = 'block';
    document.getElementById('now-playing-text').textContent = 'Song läuft …';

    const item = getRandomTrack(cachedPlaylistTracks);
    if (!item || !item.track) {
      if (window.M) M.toast({ html: 'Kein Song verfügbar', classes: 'rounded' });
      return;
    }

    selectedTrackUri = item.track.uri;
    const ok = await playTrack(selectedTrackUri);
    if (!ok && window.M) M.toast({ html: 'Fehler beim Abspielen des Songs', classes: 'rounded' });

    updateTrackDetailsElement(item.track);
    cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);

    if (!cachedPlaylistTracks.length && window.M) {
      M.toast({ html: 'Alle Songs der Playlist wurden abgespielt.', classes: 'rounded' });
    }
  });

});
