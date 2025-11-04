document.addEventListener("DOMContentLoaded", async () => {
  const loading = document.getElementById("loading");
  const startButton = document.getElementById("start-button");
  const wheelCanvas = document.getElementById("wheel");
  const spinText = document.getElementById("spin-text");
  const songInfoBox = document.getElementById("song-info");
  const songName = document.getElementById("song-name");
  const nextSongBtn = document.getElementById("next-song");

  const ctx = wheelCanvas.getContext("2d");

  // ===== Playlist laden =====
  await new Promise(resolve => setTimeout(resolve, 1500)); // simulierte Ladezeit
  loading.style.display = "none";
  startButton.style.display = "inline-block";

  // ===== Variablen =====
  const categories = JSON.parse(localStorage.getItem("bingoCategories") || "[]");
  const playlist = JSON.parse(localStorage.getItem("bingoPlaylist") || "[]");

  let currentSongIndex = 0;
  let spinning = false;
  let spinningDone = false;
  let audio = new Audio();

  // ===== Startbutton =====
  startButton.addEventListener("click", () => {
    startButton.style.display = "none";
    wheelCanvas.style.display = "block";
    spinText.style.display = "block";
    drawWheel();
  });

  // ===== Glücksrad zeichnen =====
  function drawWheel(rotation = 0) {
    const radius = wheelCanvas.width / 2;
    const centerX = radius;
    const centerY = radius;
    const numSegments = categories.length || 6;
    const arc = (2 * Math.PI) / numSegments;

    ctx.clearRect(0, 0, wheelCanvas.width, wheelCanvas.height);

    for (let i = 0; i < numSegments; i++) {
      const angle = i * arc + rotation;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, angle, angle + arc);
      ctx.fillStyle = i % 2 === 0 ? "#3f51b5" : "#2196f3";
      ctx.fill();
      ctx.save();

      // Text mittig in Segment schreiben
      ctx.translate(centerX, centerY);
      ctx.rotate(angle + arc / 2);
      ctx.textAlign = "center";
      ctx.fillStyle = "white";
      ctx.font = "bold 16px Arial";

      const text = categories[i] || `Kategorie ${i + 1}`;
      const textX = radius * 0.6;
      const textY = 6;
      ctx.fillText(text, textX, textY);
      ctx.restore();
    }
  }

  // ===== Drehen des Glücksrads =====
  function spinWheel() {
    if (spinning || spinningDone) return;
    spinning = true;

    const spinTime = 4000;
    const finalAngle = Math.random() * 2 * Math.PI;
    let start = null;

    function animate(timestamp) {
      if (!start) start = timestamp;
      const elapsed = timestamp - start;
      const progress = Math.min(elapsed / spinTime, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const rotation = easeOut * (10 * Math.PI) + finalAngle;
      drawWheel(rotation);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        spinning = false;
        spinningDone = true;

        // Bestimme gewählte Kategorie
        const chosenIndex =
          Math.floor(((2 * Math.PI) - (finalAngle % (2 * Math.PI))) / ((2 * Math.PI) / (categories.length || 6))) %
          (categories.length || 6);
        spinText.textContent = `Kategorie: ${categories[chosenIndex] || "Unbekannt"}`;

        // Song starten
        startSong();
      }
    }

    requestAnimationFrame(animate);
  }

  // ===== Song starten =====
  function startSong() {
    const song = playlist[currentSongIndex] || { name: "Song " + (currentSongIndex + 1) };
    songName.textContent = song.name;
    songInfoBox.style.display = "block";
    audio = new Audio(song.preview_url || "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3");
    audio.play();
  }

  // ===== Pulsierende Phase (20 Sekunden) =====
  function pulseEffect() {
    if (!spinningDone) return;
    let timeLeft = 20;
    let pulseClass = "pulse-yellow";
    wheelCanvas.classList.add(pulseClass);

    const timer = setInterval(() => {
      timeLeft--;
      if (timeLeft === 5) {
        wheelCanvas.classList.remove("pulse-yellow");
        wheelCanvas.classList.add("pulse-red");
      }
      if (timeLeft <= 0) {
        clearInterval(timer);
        wheelCanvas.classList.remove("pulse-red");
        audio.pause();
      }
    }, 1000);
  }

  // ===== Klick auf das Rad =====
  wheelCanvas.addEventListener("click", () => {
    if (!spinningDone) {
      spinWheel();
    } else {
      pulseEffect();
    }
  });

  // ===== "Weiter"-Button =====
  nextSongBtn.addEventListener("click", () => {
    spinningDone = false;
    spinText.textContent = "Spin the Wheel";
    songInfoBox.style.display = "none";
    currentSongIndex = (currentSongIndex + 1) % playlist.length;
    drawWheel();
  });
});
