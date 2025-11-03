document.addEventListener('DOMContentLoaded', () => {
  const nextButton = document.getElementById('bingo-next-button');

  nextButton.addEventListener('click', () => {
    const playlistUrl = document.getElementById('bingo-playlist-url').value.trim();

    if (!playlistUrl) {
      M.toast({ html: "Bitte eine Playlist-URL eingeben", classes: "rounded", displayLength: 2000 });
      return;
    }

    // Playlist speichern
    localStorage.setItem('bingoPlaylistUrl', playlistUrl);

    // Optional: Prüfen, ob der Spotify-Token vorhanden ist
    const token = localStorage.getItem('access_token');
    if (!token) {
      M.toast({ html: "Spotify-Login erforderlich – du wirst weitergeleitet", classes: "rounded", displayLength: 3000 });
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 1500);
      return;
    }

    // Weiterleitung zur nächsten Seite (z. B. bingo2.html oder mobil.html)
    window.location.href = 'mobil.html';
  });
});
