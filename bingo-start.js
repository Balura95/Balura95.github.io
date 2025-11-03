// bingo-start.js - angepasst:
// - keine Icons/Emojis
// - "Weiter" Button innerhalb der Track-Box (zentral, breit, grün)
// - Start-Button rund & erscheint erst nachdem Playlist geladen wurde

let cachedPlaylistTracks = [];
let selectedTrackUri = null;
let spotifyReady = null;

// Playlist-ID extrahieren (unterstützt URI & Link)
function extractPlaylistId(url) {
  if (!url) return null;
  let m = url.match(/spotify:playlist:([A-Za-z0-9]+)/);
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
    // meta to get total
    let metaResp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!metaResp.ok) {
      console.error("Fehler beim Laden der Playlist-Meta:", await metaResp.text());
      return [];
    }
    const meta = await metaResp.json();
    const total = meta.tracks && meta.tracks.total ? meta.tracks.total : 0;

    while (offset < total) {
      const resp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!resp.ok) {
        console.error("Fehler beim Laden von Tracks:", await resp.text());
        break;
      }
      const data = await resp.json();
      if (data && Array.isArray(data.items)) {
        const filtered = data.items.filter(i => i && i.track && i.track.uri && !i.is_local);
        all.push(...filtered);
      }
      offset += limit;
      if (!data.items || data.items.length === 0) break;
    }
    return all;
  } catch (err) {
    console.error("fetchPlaylistTracks error:", err);
    return [];
  }
}

function getRandomTrack(tracks) {
  if (!tracks || tracks.length === 0) return null;
  const idx = Math.floor(Math.random() * tracks.length);
  return tracks[idx];
}

// Spotify Web Playback SDK initialisieren
spotifyReady = new Promise((resolve) => {
  window.onSpotifyWebPlaybackSDKReady = () => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      console.warn("Kein Spotify-Token beim SDK ready");
      resolve();
      return;
    }
    const player = new Spotify.Player({
      name: 'Julster Bingo Player',
      getOAuthToken: cb => cb(token)
    });

    player.addListener('ready', ({ device_id }) => {
      window.deviceId = device_id;
      window.bingoPlayer = player;
      console.log("Spotify Player ready, device id:", device_id);
      resolve();
    });

    // Fehlerbehandlung: resolve trotzdem, damit UI weiter funktioniert
    player.addListener('initialization_error', ({ message }) => { console.error(message); resolve(); });
    player.addListener('authentication_error', ({ message }) => { console.error(message); resolve(); });
    player.addListener('account_error', ({ message }) => { console.error(message); resolve(); });
    player.addListener('playback_error', ({ message }) => { console.error(message); resolve(); });

    player.connect().catch(err => { console.warn("Spotify player connect error:", err); resolve(); });
  };
});

// Spielt einen URI via Web API (device optional)
async function playTrack(uri) {
  const token = localStorage.getItem('access_token');
  if (!token) return false;

  await spotifyReady;

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
      console.error("playTrack response:", response.status, txt);
      return false;
    }
  } catch (err) {
    console.error("playTrack error:", err);
    return false;
  }
}

// Pause/Stop
async function stopPlayback() {
  const token = localStorage.getItem('access_token');
  if (!token) return;
  try {
    await fetch('https://api.spotify.com/v1/me/player/pause', {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  } catch (err) {
    console.warn("stopPlayback error:", err);
  }
}

// Trackdetails & "Weiter"-Button inside details
function updateTrackDetailsElement(track) {
  const details = document.getElementById('track-details');
  if (!details) return;
  let expanded = false;

  // collapsed state text
  details.textContent = "Songinfos auflösen";

  // remove old listener if exists, then set new onclick
  details.onclick = () => {
    if (!expanded) {
      details.innerHTML = `
        <div>
          <p><strong>Titel:</strong> ${track.name}</p>
          <p><strong>Interpret:</strong> ${track.artists.map(a => a.name).join(', ')}</p>
          <p><strong>Album:</strong> ${track.album.name || ''}</p>
          <p><strong>Erscheinungsjahr:</strong> ${track.album.release_date ? track.album.release_date.substring(0,4) : ''}</p>
        </div>
      `;
      // "Weiter"-Button zentral & breit & grün
      const weiterBtn = document.createElement('button');
      weiterBtn.className = 'btn details-weiter-btn green waves-effect waves-light';
      weiterBtn.textContent = 'Weiter';
      weiterBtn.type = 'button';
      weiterBtn.id = 'details-weiter-btn';
      details.appendChild(weiterBtn);

      // Listener: nächster Song
      weiterBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation(); // verhindert, dass das details onclick erneut feuert
        await handleNextSong();
      });

      expanded = true;
    } else {
      details.textContent = "Songinfos auflösen";
      expanded = false;
    }
  };
}

// gemeinsame Funktion zum Abspielen des nächsten Songs
async function handleNextSong() {
  if (!cachedPlaylistTracks || cachedPlaylistTracks.length === 0) {
    M.toast({ html: "Keine weiteren Songs verfügbar.", classes: "rounded", displayLength: 2000 });
    return;
  }

  // Versuche vorherigen Track zu pausieren
  await stopPlayback();
  document.getElementById('now-playing-text').textContent = "Song läuft …";

  const item = getRandomTrack(cachedPlaylistTracks);
  if (!item || !item.track) {
    M.toast({ html: "Fehler beim Abrufen des nächsten Songs", classes: "rounded", displayLength: 2000 });
    return;
  }

  selectedTrackUri = item.track.uri;
  const ok = await playTrack(selectedTrackUri);
  if (!ok) {
    M.toast({ html: "Fehler beim Abspielen des Songs", classes: "rounded", displayLength: 2200 });
  }
  updateTrackDetailsElement(item.track);

  // entferne abgespielten Song
  cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);

  // falls leer, Hinweis & disableweiter (Button bleibt vorhanden aber in Toast informiert)
  if (cachedPlaylistTracks.length === 0) {
    M.toast({ html: "Alle Songs der Playlist wurden abgespielt.", classes: "rounded", displayLength: 3000 });
  }
}

function showEmptyWarning() {
  document.getElementById('now-playing').style.display = 'none';
  document.getElementById('start-btn').style.display = 'none';
  document.getElementById('loading-text').style.display = 'none';
  document.getElementById('empty-warning').style.display = 'block';
}

// Main
document.addEventListener('DOMContentLoaded', async () => {
  if (!localStorage.getItem('access_token')) {
    window.location.href = 'index.html';
    return;
  }

  const startBtn = document.getElementById('start-btn');
  const nowPlaying = document.getElementById('now-playing');
  const loadingText = document.getElementById('loading-text');

  // Load playlist (bingoPlaylistUrl then mobilePlaylistUrl)
  const playlistUrl = localStorage.getItem('bingoPlaylistUrl') || localStorage.getItem('mobilePlaylistUrl') || '';
  const playlistId = extractPlaylistId(playlistUrl);

  if (!playlistId) {
    M.toast({ html: "Keine gültige Playlist gefunden. Bitte Playlist eintragen.", classes: "rounded", displayLength: 2500 });
    showEmptyWarning();
    return;
  }

  // lade Tracks - zeige Lade-Text bis fertig
  loadingText.style.display = 'block';
  try {
    cachedPlaylistTracks = await fetchPlaylistTracks(playlistId);
  } catch (e) {
    console.error("Fehler beim Laden der Playlist:", e);
    cachedPlaylistTracks = [];
  }
  loadingText.style.display = 'none';

  if (!cachedPlaylistTracks || cachedPlaylistTracks.length === 0) {
    showEmptyWarning();
    return;
  }

  // Playlist geladen -> Startbutton anzeigen
  startBtn.style.display = 'inline-block';
  startBtn.classList.add('pulse');

  // Start: spiele ersten zufälligen Song (ohne stopPlayback vorher)
  startBtn.addEventListener('click', async () => {
    startBtn.style.display = 'none';
    nowPlaying.style.display = 'block';
    document.getElementById('now-playing-text').textContent = "Song läuft …";

    const item = getRandomTrack(cachedPlaylistTracks);
    if (!item || !item.track) {
      M.toast({ html: "Kein Song verfügbar", classes: "rounded", displayLength: 2000 });
      return;
    }

    selectedTrackUri = item.track.uri;
    const ok = await playTrack(selectedTrackUri);
    if (!ok) {
      M.toast({ html: "Fehler beim Abspielen des Songs", classes: "rounded", displayLength: 2200 });
    }
    updateTrackDetailsElement(item.track);
    cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);

    if (cachedPlaylistTracks.length === 0) {
      M.toast({ html: "Alle Songs der Playlist wurden abgespielt.", classes: "rounded", displayLength: 3000 });
    }
  });
});
