// --- Player Page Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  console.log("Access Token:", localStorage.getItem('access_token'));
  if (!localStorage.getItem('access_token')) {
    window.location.href = 'index.html';
    return;
  }
  // Resume AudioContext on first touch (iOS requirement)
  document.addEventListener('touchstart', function resumeAudioContext() {
    if (window.AudioContext || window.webkitAudioContext) {
      const context = new (window.AudioContext || window.webkitAudioContext)();
      context.resume();
    }
    document.removeEventListener('touchstart', resumeAudioContext);
  });
  toggleUIAfterLogin();
});

// Show player area and start the QR scanner
function toggleUIAfterLogin() {
  document.getElementById('player-area').style.display = 'block';
  startQrScanner();
}

// --- QR-Code Scanner Setup ---
window.qrScannerActive = false;
window.qrScanner = null;

function startQrScanner() {
  if (window.qrScannerActive) return; // Prevent multiple scanners

  window.qrScanner = new Html5Qrcode("qr-reader");
  window.qrScannerActive = true;
  document.getElementById('qr-reader').style.display = 'block';

  // Set title text (optional)
  const titleElement = document.getElementById('title');
  if (titleElement) {
    titleElement.textContent = 'QR Code scannen';
  }
  
  // Hide the Scan Next button initially
  document.getElementById('scan-next').style.display = 'none';

  const qrConfig = { fps: 10, qrbox: 250 };

  window.qrScanner.start(
    { facingMode: "environment" },
    qrConfig,
    (decodedText, decodedResult) => {
      console.log("QR Code Scanned:", decodedText);
      const cleanedText = decodedText.replace(/\s/g, '');
      const match = cleanedText.match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([a-zA-Z0-9]+)/);
      if (match && match[1]) {
        const trackUri = `spotify:track:${match[1]}`;
        window.lastScannedTrackUri = trackUri;
        M.toast({ html: "Song erfolgreich geladen", classes: "rounded", displayLength: 1000 });
        stopQrScanner();
        // If iOS, show the Play button so user can tap to trigger playback.
        // On Android, autoplay directly.
        if (isIOS()) {
          document.getElementById('play-track').style.display = 'inline-flex';
        } else {
          window.playTrack(trackUri);
        }
      } else {
        M.toast({ html: "Invalid Spotify QR Code. Try again.", classes: "rounded", displayLength: 1000 });
      }
    }
  ).catch(err => console.error("QR code scanning failed:", err));
}

function stopQrScanner() {
  if (window.qrScanner) {
    window.qrScanner.stop().then(() => {
      window.qrScannerActive = false;
      document.getElementById('qr-reader').style.display = 'none';
      // Optionally update title after scanning
      const titleElement = document.getElementById('title');
      if (titleElement) {
        titleElement.textContent = 'Song läuft...';
      }
      document.getElementById('scan-next').style.display = 'block';
    }).catch(err => console.error("Error stopping QR scanner:", err));
  }
}

// --- iOS Detection ---
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

// --- Spotify Web Playback SDK Integration ---
window.deviceId = null;

window.onSpotifyWebPlaybackSDKReady = () => {
  const token = localStorage.getItem('access_token');
  if (!token) return;

  const player = new Spotify.Player({
    name: 'Web Player',
    getOAuthToken: cb => { cb(token); }
  });
  // Save player globally for activateElement
  window.player = player;

  player.addListener('ready', ({ device_id }) => {
    window.deviceId = device_id;
  });
  
  // Error event listeners (fallback deep linking is optional; here wir redirect on error)
  player.addListener('initialization_error', ({ message }) => {
    console.error('Initialization Error:', message);
    window.location.href = window.lastScannedTrackUri;
  });
  player.addListener('authentication_error', ({ message }) => {
    console.error('Authentication Error:', message);
    window.location.href = window.lastScannedTrackUri;
  });
  player.addListener('account_error', ({ message }) => {
    console.error('Account Error:', message);
    window.location.href = window.lastScannedTrackUri;
  });
  player.addListener('playback_error', ({ message }) => {
    console.error('Playback Error:', message);
    window.location.href = window.lastScannedTrackUri;
  });

  player.connect();

  window.playTrack = async function(trackUri) {
    const token = localStorage.getItem('access_token');
    if (!token) {
      M.toast({ html: "Session expired. Please log in again.", classes: "rounded", displayLength: 1000 });
      logout();
      return;
    }
    
    let waitTime = 0;
    while (!window.deviceId && waitTime < 10000) {
      await new Promise(resolve => setTimeout(resolve, 200));
      waitTime += 200;
    }
    if (!window.deviceId) {
      M.toast({ html: "Spotify player is not ready yet. Try again soon.", classes: "rounded", displayLength: 1000 });
      return;
    }
    
    // On iOS, user must trigger activateElement via the Play button.
    if (isIOS() && window.player && typeof window.player.activateElement === 'function') {
      // We assume the user has tapped the Play button.
      const playButton = document.getElementById('play-track');
      window.player.activateElement(playButton);
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
        document.getElementById('scan-next').style.display = 'block';
      } else if (response.status === 401) {
        M.toast({ html: "Session expired. Logging out...", classes: "rounded", displayLength: 1000 });
        logout();
      } else {
        const data = await response.json();
        console.error("Spotify API error:", data);
      }
    } catch (error) {
      console.error("Error playing track:", error);
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
};

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('play-track').addEventListener('click', () => {
    // On iOS, activate the element before playback
    if (isIOS() && window.player && typeof window.player.activateElement === 'function') {
      const playButton = document.getElementById('play-track');
      window.player.activateElement(playButton);
    }
    window.playTrack(window.lastScannedTrackUri);
    document.getElementById('play-track').style.display = 'none';
    document.getElementById('scan-next').style.display = 'inline-flex';
  });
});

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('scan-next').addEventListener('click', () => {
    window.stopPlayback();
    startQrScanner();
  });
});

function logout() {
  localStorage.clear();
  sessionStorage.clear();
  window.location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', () => {
  const resetButton = document.getElementById('reset-app');
  if (resetButton) {
    resetButton.addEventListener('click', () => {
      if (confirm("Möchtest du die App wirklich zurücksetzen?")) {
        logout();
      }
    });
  }
});

function setViewportHeight() {
  let vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
}
setViewportHeight();
window.addEventListener('resize', setViewportHeight);

async function checkSpotifySessionValidity() {
  const token = localStorage.getItem('access_token');
  if (!token) {
    window.location.href = 'index.html';
    return;
  }
  try {
    const response = await fetch('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.status === 401) {
      // Session ist abgelaufen
      window.location.href = 'index.html';
    }
  } catch (error) {
    console.error("Fehler beim Überprüfen der Spotify-Session:", error);
    // Optional: Bei einem Fehler ebenfalls umleiten oder eine Fehlermeldung anzeigen
  }
}

window.onload = () => {
  checkSpotifySessionValidity();
};