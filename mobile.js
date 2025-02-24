// Globale Variablen
let cachedPlaylistTracks = null;
let selectedTrackUri = null;
let currentTrack = null;
let trackDetailsExpanded = false;
let mobileCategories = [];

// Funktion: Extrahiere die Playlist-ID aus einer URL
function extractPlaylistId(url) {
  const regex = /playlist\/([a-zA-Z0-9]+)/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

// Liest die gespeicherte Playlist-URL aus categories.html
function getStoredPlaylistUrl() {
  return localStorage.getItem('mobilePlaylistUrl') || "";
}

// Funktion zum Abrufen und Cachen der Playlist-Tracks
async function fetchPlaylistTracks(playlistId) {
  const token = localStorage.getItem('access_token');
  const endpoint = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50`;
  try {
    const response = await fetch(endpoint, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    console.log("Playlist data received:", data);
    if (data && data.items) {
      console.log("Anzahl geladener Tracks:", data.items.length);
      cachedPlaylistTracks = data.items;
      return cachedPlaylistTracks;
    } else {
      console.error("Keine Tracks gefunden:", data);
      return [];
    }
  } catch (error) {
    console.error("Error fetching playlist tracks:", error);
    return null;
  }
}

// Funktion zum Laden der Playlist aus dem gespeicherten Wert
async function loadPlaylist() {
  const playlistUrl = getStoredPlaylistUrl();
  console.log("Stored Playlist URL:", playlistUrl);
  const playlistId = extractPlaylistId(playlistUrl);
  if (!playlistId) {
    M.toast({ html: "Ungültige gespeicherte Playlist URL", classes: "rounded", displayLength: 2000 });
    return;
  }
  const tracks = await fetchPlaylistTracks(playlistId);
  if (tracks && tracks.length > 0) {
    M.toast({ html: `${tracks.length} Songs geladen`, classes: "rounded", displayLength: 2000 });
    console.log("Cached Playlist Tracks:", cachedPlaylistTracks);
  } else {
    M.toast({ html: "Keine Songs in der gespeicherten Playlist gefunden", classes: "rounded", displayLength: 2000 });
  }
}

// Funktion, die einen zufälligen Track auswählt
function getRandomTrack(tracks) {
  if (!tracks || tracks.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * tracks.length);
  return tracks[randomIndex];
}

// Aktualisiert die Box für Songdetails (nur Songinfos) und die Kategorie-Box separat
function updateTrackDetails(track) {
  const detailsContainer = document.getElementById('track-details');
  if (detailsContainer) {
    detailsContainer.innerHTML = `
      <p id="track-info">Songinfos</p>
      <p id="track-title">Titel: ${track.name}</p>
      <p id="track-artist">Interpret: ${track.artists.map(a => a.name).join(", ")}</p>
      <p id="track-year">Erscheinungsjahr: ${track.album.release_date.substring(0,4)}</p>
      <p id="track-added">Hinzugefügt von: ${track.added_by ? track.added_by.id : "unbekannt"}</p>
    `;
    detailsContainer.style.display = 'block';
  }
}

function updateCategoryDisplay(category) {
  const catContainer = document.getElementById('category-display');
  if (catContainer) {
    catContainer.innerHTML = `<p id="category-info">Kategorie: ${category}</p>`;
    catContainer.style.display = 'block';
  }
}

// Lade Kategorien aus localStorage (aus categories.html)
function loadCategories() {
  const catStr = localStorage.getItem('mobileCategories');
  if (catStr) {
    try {
      return JSON.parse(catStr);
    } catch (e) {
      console.error("Error parsing categories:", e);
      return [];
    }
  }
  return [];
}

// Promise, das aufgelöst wird, sobald der Spotify SDK bereit ist
let spotifySDKReady = new Promise((resolve) => {
  window.onSpotifyWebPlaybackSDKReady = () => {
    const token = localStorage.getItem('access_token');
    if (!token) return;
    const player = new Spotify.Player({
      name: 'Mobile Web Player',
      getOAuthToken: cb => { cb(token); }
    });
    window.mobilePlayer = player;
    player.addListener('ready', ({ device_id }) => {
      window.deviceId = device_id;
      console.log("Spotify player ready, device_id:", device_id);
    });
    // Fehler-Listener (optional)
    player.addListener('initialization_error', ({ message }) => {
      console.error('Initialization Error:', message);
    });
    player.addListener('authentication_error', ({ message }) => {
      console.error('Authentication Error:', message);
    });
    player.addListener('account_error', ({ message }) => {
      console.error('Account Error:', message);
    });
    player.addListener('playback_error', ({ message }) => {
      console.error('Playback Error:', message);
    });
    player.connect().then(() => {
      window.playTrack = async function(trackUri) {
        const token = localStorage.getItem('access_token');
        if (!token) return false;
        let waitTime = 0;
        while (!window.deviceId && waitTime < 10000) {
          await new Promise(res => setTimeout(res, 200));
          waitTime += 200;
        }
        if (!window.deviceId) {
          console.error("Spotify player not ready");
          return false;
        }
        try {
          let response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${window.deviceId}`, {
            method: 'PUT',
            body: JSON.stringify({ uris: [trackUri] }),
            headers: { 
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });
          if (response.status === 204) {
            console.log("Track started successfully.");
            return true;
          } else if (response.status === 401) {
            console.error("Session expired");
            return false;
          } else {
            const data = await response.json();
            console.error("Spotify API error:", data);
            return false;
          }
        } catch (error) {
          console.error("Error playing track:", error);
          return false;
        }
      };

      window.stopPlayback = async function() {
        const token = localStorage.getItem('access_token');
        if (!token) return;
        try {
          let response = await fetch('https://api.spotify.com/v1/me/player/pause', {
            method: 'PUT',
            headers: { 
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });
          if (response.status === 204) {
            console.log("Playback stopped.");
          } else {
            console.error("Error stopping playback:", await response.json());
          }
        } catch (error) {
          console.error("Error stopping track:", error);
        }
      };

      resolve();
    });
  };
});

// DOMContentLoaded-Block
document.addEventListener('DOMContentLoaded', () => {
  if (!localStorage.getItem('access_token')) {
    window.location.href = 'index.html';
    return;
  }
  
  // Lade Kategorien aus localStorage
  mobileCategories = loadCategories();
  console.log("Geladene Kategorien:", mobileCategories);
  
  // Aktiviere den AudioContext (iOS)
  document.addEventListener('touchstart', function resumeAudioContext() {
    if (window.AudioContext || window.webkitAudioContext) {
      const context = new (window.AudioContext || window.webkitAudioContext)();
      context.resume();
    }
    document.removeEventListener('touchstart', resumeAudioContext);
  });
  
  // Lade die Playlist
  loadPlaylist();
  
  // Event Listener für den Play-Button
  const playButton = document.getElementById('play-button');
  if (playButton) {
    playButton.addEventListener('click', async () => {
      if (!cachedPlaylistTracks) {
        M.toast({ html: "Playlist wurde nicht geladen.", classes: "rounded", displayLength: 2000 });
        return;
      }
      const randomItem = getRandomTrack(cachedPlaylistTracks);
      console.log("Random Item:", randomItem);
      if (!randomItem || !randomItem.track) {
        M.toast({ html: "Fehler beim Abrufen des Songs", classes: "rounded", displayLength: 2000 });
        return;
      }
      selectedTrackUri = randomItem.track.uri;
      console.log("Ausgewählte Track URI:", selectedTrackUri);
      // Wähle zufällig eine Kategorie aus
      let randomCategory = "";
      if (mobileCategories && mobileCategories.length > 0) {
        const randomIndex = Math.floor(Math.random() * mobileCategories.length);
        randomCategory = mobileCategories[randomIndex];
      }
      console.log("Ausgewählte Kategorie:", randomCategory);
      // Aktualisiere die Songdetails und das separate Kategorie-Feld
      updateTrackDetails(randomItem.track);
      updateCategoryDisplay(randomCategory);
      await spotifySDKReady;
      const success = await window.playTrack(selectedTrackUri);
      if (!success) {
        M.toast({ html: "Fehler beim Abspielen des Songs", classes: "rounded", displayLength: 2000 });
      }
    });
  } else {
    console.error("play-button not found");
  }
  
  // Event Listener für den Stop-Button
  const stopButton = document.getElementById('stop-button');
  if (stopButton) {
    stopButton.addEventListener('click', async () => {
      if (window.stopPlayback) {
        await window.stopPlayback();
        M.toast({ html: "Playback gestoppt", classes: "rounded", displayLength: 2000 });
      } else {
        console.error("stopPlayback is not defined");
      }
    });
  } else {
    console.error("stop-button not found");
  }
  
  // Event Listener für den Reset-Button
  const resetButton = document.getElementById('reset-app');
  if (resetButton) {
    resetButton.addEventListener('click', () => {
      if (confirm("Möchtest du die App wirklich zurücksetzen?")) {
        logout();
      }
    });
  } else {
    console.error("reset-app not found");
  }
});

// Logout-Funktion
function logout() {
  localStorage.clear();
  sessionStorage.clear();
  window.location.href = 'index.html';
}
