let playlist = [];
let categories = [];
let isPlaying = false;
let isSpinning = false;
let currentTrack = null;
let pulseTimeouts = [];

function extractPlaylistId(url) {
  const m = url.match(/playlist\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

async function fetchPlaylistTracks(id) {
  const token = localStorage.getItem('access_token');
  if (!token) return [];
  const out = [];
  let offset = 0;
  while (true) {
    const res = await fetch(`https://api.spotify.com/v1/playlists/${id}/tracks?limit=50&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) break;
    const data = await res.json();
    out.push(...data.items.filter(i => i.track && i.track.uri));
    if (data.items.length < 50) break;
    offset += 50;
  }
  return out;
}

async function playTrack(uri) {
  const token = localStorage.getItem('access_token');
  const device_id = window.deviceId || "";
  try {
    await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${device_id}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ uris: [uri] })
    });
    isPlaying = true;
  } catch (e) { console.error(e); }
}

async function pauseTrack() {
  const token = localStorage.getItem('access_token');
  await fetch(`https://api.spotify.com/v1/me/player/pause`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` }
  });
  isPlaying = false;
}

function clearPulse() {
  pulseTimeouts.forEach(t => clearTimeout(t));
  pulseTimeouts = [];
  const wheel = document.getElementById("wheel");
  wheel.classList.remove("pulse-white", "pulse-red");
}

function startPulse() {
  const wheel = document.getElementById("wheel");
  if (wheel.classList.contains("pulse-white") || wheel.classList.contains("pulse-red")) return;

  wheel.classList.add("pulse-white");
  pulseTimeouts.push(setTimeout(() => {
    wheel.classList.remove("pulse-white");
    wheel.classList.add("pulse-red");
  }, 15000));
  pulseTimeouts.push(setTimeout(async () => {
    clearPulse();
    await pauseTrack();
    M.toast({html:"Song gestoppt"});
  }, 20000));
}

function buildWheel() {
  const wheel = document.getElementById("wheel");
  const n = categories.length;
  if (n === 0) { document.getElementById("wheel-section").style.display="none"; return; }
  document.getElementById("wheel-section").style.display="block";
  const slice = 360/n;
  const colors = categories.map((c,i)=>`hsl(${i*60%360},70%,55%) ${i*slice}deg ${(i+1)*slice}deg`);
  wheel.style.background=`conic-gradient(${colors.join(",")})`;
  wheel.innerHTML="";
  for (let i=0;i<n;i++){
    const lbl=document.createElement("div");
    lbl.className="wheel-label";
    lbl.style.transform=`rotate(${i*slice+slice/2}deg) translate(0,-110px) rotate(${-i*slice - slice/2}deg)`;
    lbl.textContent=categories[i];
    wheel.appendChild(lbl);
  }
}

async function spinWheel() {
  if (isSpinning) return;
  isSpinning=true;
  const wheel=document.getElementById("wheel");
  const n=categories.length;
  const slice=360/n;
  const idx=Math.floor(Math.random()*n);
  const rot=360*4 + (360-(idx*slice+slice/2));
  wheel.style.transform=`rotate(${rot}deg)`;
  await new Promise(r=>setTimeout(r,3100));
  isSpinning=false;
  document.getElementById("now-playing").style.display="block";
  const randomTrack = playlist[Math.floor(Math.random()*playlist.length)].track;
  currentTrack=randomTrack;
  await playTrack(randomTrack.uri);
  updateTrackDetails(randomTrack);
}

function updateTrackDetails(track){
  const d=document.getElementById("track-details");
  d.style.display="block";
  d.innerHTML="Songinfos auflösen";
  let open=false;
  d.onclick=()=>{
    if(!open){
      d.innerHTML=`
        <div><p><b>${track.name}</b></p>
        <p>${track.artists.map(a=>a.name).join(", ")}</p>
        <p>${track.album.name}</p></div>
        <button class='btn green details-weiter-btn'>Weiter</button>`;
      d.querySelector("button").onclick=async(ev)=>{
        ev.stopPropagation();
        await pauseTrack();
        clearPulse();
        spinWheel();
      };
      open=true;
    }else{
      d.innerHTML="Songinfos auflösen";
      open=false;
    }
  };
}

document.addEventListener("DOMContentLoaded", async()=>{
  const token=localStorage.getItem("access_token");
  if(!token) return location.href="index.html";
  try { categories=JSON.parse(localStorage.getItem("bingoCategories")||"[]"); }catch{categories=[];}

  const playlistUrl=localStorage.getItem("bingoPlaylistUrl");
  const id=extractPlaylistId(playlistUrl||"");
  const loading=document.getElementById("loading-text");
  playlist=await fetchPlaylistTracks(id);
  loading.style.display="none";
  if(playlist.length===0){ M.toast({html:"Keine Songs"}); return; }
  document.getElementById("start-btn").style.display="inline-block";

  document.getElementById("start-btn").onclick=()=>{
    document.getElementById("start-btn").style.display="none";
    buildWheel();
  };

  document.getElementById("wheel").onclick=async()=>{
    if(!isPlaying) await spinWheel();
    else startPulse();
  };
});
