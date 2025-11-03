// bingo1.js
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('playlist-url');
  const checkbox = document.getElementById('discokugel-checkbox');
  const categoriesWrapper = document.getElementById('categories-wrapper');
  const categoriesContainer = document.getElementById('categories-container');
  const addBtn = document.getElementById('add-category');
  const removeBtn = document.getElementById('remove-category');
  const nextBtn = document.getElementById('next-button');

  // Vorbefüllen: falls bereits gespeichert (bingoPlaylistUrl oder mobilePlaylistUrl)
  const existing = localStorage.getItem('bingoPlaylistUrl') || localStorage.getItem('mobilePlaylistUrl') || '';
  if (existing && input) {
    input.value = existing;
    if (window.M && typeof M.updateTextFields === 'function') M.updateTextFields();
  }

  // Checkbox toggelt Kategorien-Wrapper
  if (checkbox && categoriesWrapper) {
    checkbox.addEventListener('change', () => {
      categoriesWrapper.style.display = checkbox.checked ? 'block' : 'none';
    });
  }

  // Kategorie hinzufügen (Buttons bewegen sich, weil sie innerhalb wrapper sind)
  if (addBtn && categoriesContainer) {
    addBtn.addEventListener('click', () => {
      const div = document.createElement('div');
      div.className = 'input-field';
      div.innerHTML = '<input class="category-input" type="text"><label>Weitere Kategorie eintragen</label>';
      categoriesContainer.appendChild(div);
      // Materialize: update labels (falls vorhanden)
      if (window.M && typeof M.updateTextFields === 'function') M.updateTextFields();
      div.querySelector('.category-input').focus();
    });
  }

  // Kategorie entfernen
  if (removeBtn && categoriesContainer) {
    removeBtn.addEventListener('click', () => {
      const fields = categoriesContainer.querySelectorAll('.input-field');
      if (fields.length > 1) {
        fields[fields.length - 1].remove();
      }
    });
  }

  // Weiter-Button: speichert Playlist + Kategorien (nur UI; Bingo-Start nutzt nur bingoPlaylistUrl)
  nextBtn.addEventListener('click', () => {
    const playlistUrl = input.value.trim();
    if (!playlistUrl) {
      if (window.M) M.toast({ html: "Bitte Playlist URL eingeben", classes: "rounded", displayLength: 2000 });
      return;
    }
    localStorage.setItem('bingoPlaylistUrl', playlistUrl);

    // Kategorien optional speichern (nur UI; werden aktuell nicht im Player ausgewertet)
    if (checkbox && checkbox.checked) {
      const catInputs = categoriesContainer.querySelectorAll('.category-input');
      const cats = [];
      catInputs.forEach(i => {
        const v = i.value.trim();
        if (v) cats.push(v);
      });
      localStorage.setItem('bingoCategories', JSON.stringify(cats));
    } else {
      localStorage.setItem('bingoCategories', JSON.stringify([]));
    }

    // Weiter zu bingo-start.html
    window.location.href = 'bingo-start.html';
  });
});
