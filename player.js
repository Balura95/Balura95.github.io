// --- Player Page Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  console.log("Access Token:", localStorage.getItem('access_token'));
  if (!localStorage.getItem('access_token')) {
    window.location.href = 'index.html';
    return;
  }
  // Resume AudioContext on first touch for iOS
  document.addEventListener('touchstart', function resumeAudioContext() {
    if (window.AudioContext || window.webkitAudioContext) {
      const context = new (window.AudioContext || window.webkitAudioContext)();
      context.resume().then(() => {
        console.log("Audio context resumed");
      });
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

  // Optionally update the title (kept static here)
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
        // Autoplay: Automatically trigger playback using the Web Playback SDK
        window.playTrack(trackUri);
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

// --- Spotify Web Playback SDK Integration ---
window.deviceId = null;

window.onSpotifyWebPlaybackSDKReady = () => {
  const token = localStorage.getItem('access_token');
  if (!token) return;

  const player = new Spotify.Player({
    name: 'Web Player',
    getOAuthToken: cb => { cb(token); }
  });

  player.addListener('ready', ({ device_id }) => {
    window.deviceId = device_id;
  });
  
  // Error event listeners (errors will be logged)
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

  player.connect();

  // Playback function with debug toasts
  window.playTrack = async function(trackUri) {
    const token = localStorage.getItem('access_token');
    if (!token) {
      M.toast({ html: "Nicht authentifiziert!", classes: "rounded", displayLength: 2000 });
      logout();
      return;
    } else {
      M.toast({ html: "Authentifiziert.", classes: "rounded", displayLength: 1000 });
    }
    
    let waitTime = 0;
    while (!window.deviceId && waitTime < 10000) {
      await new Promise(resolve => setTimeout(resolve, 200));
      waitTime += 200;
    }
    if (!window.deviceId) {
      M.toast({ html: "Spotify player ist nicht bereit. Versuche es später erneut.", classes: "rounded", displayLength: 2000 });
      return;
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
        M.toast({ html: "Song wird abgespielt.", classes: "rounded", displayLength: 1000 });
        document.getElementById('scan-next').style.display = 'block';
      } else if (response.status === 401) {
        M.toast({ html: "Session abgelaufen. Bitte neu anmelden.", classes: "rounded", displayLength: 2000 });
        logout();
      } else {
        const data = await response.json();
        M.toast({ html: "Spotify API Fehler: " + data.error.message, classes: "rounded", displayLength: 3000 });
        console.error("Spotify API error:", data);
      }
    } catch (error) {
      M.toast({ html: "Fehler beim Abspielen: " + error.message, classes: "rounded", displayLength: 3000 });
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

// --- Event Listener for Scan Next Button ---
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('scan-next').addEventListener('click', () => {
    window.stopPlayback(); // Stop current song before scanning a new one
    startQrScanner();
  });
});

// --- Logout Function ---
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
