document.addEventListener('DOMContentLoaded', () => {
  const nextButton = document.getElementById('next-button');
  const input = document.getElementById('playlist-url'); // bitte id in bingo1.html: playlist-url
  const checkbox = document.getElementById('discokugel-checkbox');
  const categoriesWrapper = document.getElementById('categories-wrapper');

  // Vorbefüllen falls schon gespeichert
  const existing = localStorage.getItem('bingoPlaylistUrl') || localStorage.getItem('mobilePlaylistUrl') || '';
  if (existing && input) {
    input.value = existing;
    if (window.M) M.updateTextFields();
  }

  // Checkbox toggelt Kategorien-Wrapper
  if (checkbox && categoriesWrapper) {
    checkbox.addEventListener('change', () => {
      categoriesWrapper.style.display = checkbox.checked ? 'block' : 'none';
    });
  }

  // Kategorie Buttons (nur UI, keine Spiel-Integration)
  const categoriesContainer = document.getElementById('categories-container');
  const addBtn = document.getElementById('add-category');
  const removeBtn = document.getElementById('remove-category');

  if (addBtn && categoriesContainer) {
    addBtn.addEventListener('click', () => {
      const div = document.createElement('div');
      div.className = 'input-field';
      div.innerHTML = '<input class="category-input" type="text"><label>Weitere Kategorie hinzufügen</label>';
      categoriesContainer.appendChild(div);
      div.querySelector('.category-input').focus();
    });
  }
  if (removeBtn && categoriesContainer) {
    removeBtn.addEventListener('click', () => {
      const fields = categoriesContainer.querySelectorAll('.input-field');
      if (fields.length > 1) fields[fields.length - 1].remove();
    });
  }

  // Next-Button speichert Playlist unter bingoPlaylistUrl
  nextButton.addEventListener('click', () => {
    const playlistUrl = input.value.trim();
    if (!playlistUrl) {
      if (window.M) M.toast({ html: "Bitte Playlist URL eingeben", classes: "rounded", displayLength: 2000 });
      return;
    }
    localStorage.setItem('bingoPlaylistUrl', playlistUrl);

    // Kategorien optional speichern (UI only)
    if (checkbox && checkbox.checked) {
      const catInputs = document.querySelectorAll('.category-input');
      const categories = [];
      catInputs.forEach(i => { const v = i.value.trim(); if (v) categories.push(v); });
      localStorage.setItem('bingoCategories', JSON.stringify(categories));
    } else {
      localStorage.setItem('bingoCategories', JSON.stringify([]));
    }

    window.location.href = 'bingo-start.html';
  });
});
