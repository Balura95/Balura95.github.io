let cachedPlaylistTracks = [];
let selectedTrackUri = null;
let spotifyReady = null;
let wheelCtx, categories = [];
let hasSpun = false;
let hasPulsed = false;
let rotation = 0;
let pulseTimer1, pulseTimer2;
const buzzer = document.getElementById("buzzer-sound");

function extractPlaylistId(url){
  if(!url) return null;
  let m=url.match(/spotify:playlist:([A-Za-z0-9-_]+)/);
  if(m) return m[1];
  m=url.match(/playlist\/([A-Za-z0-9-_]+)/);
  if(m) return m[1];
  m=url.match(/[?&]id=([A-Za-z0-9-_]+)/);
  return m?m[1]:null;
}

async function fetchPlaylistTracks(playlistId){
  const token=localStorage.getItem('access_token');
  if(!token) return [];
  const all=[]; const limit=50; let offset=0;
  try{
    const meta=await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`,{headers:{'Authorization':`Bearer ${token}`}});
    const metaData=await meta.json(); const total=metaData.tracks?.total||0;
    while(offset<total){
      const resp=await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`,{
        headers:{'Authorization':`Bearer ${token}`}
      });
      const data=await resp.json();
      const valid=(data.items||[]).filter(i=>i&&i.track&&i.track.uri&&!i.is_local);
      all.push(...valid); offset+=limit;
      if(!data.items||data.items.length===0) break;
    }
    return all;
  }catch(e){console.error(e);return [];}
}

spotifyReady=new Promise(resolve=>{
  window.onSpotifyWebPlaybackSDKReady=()=>{
    const token=localStorage.getItem('access_token');
    if(!token){resolve();return;}
    const player=new Spotify.Player({
      name:'Julster Bingo Player',
      getOAuthToken:cb=>cb(token)
    });
    player.addListener('ready',({device_id})=>{
      window.deviceId=device_id;
      window.bingoPlayer=player;
      resolve();
    });
    player.connect().catch(()=>resolve());
  };
});

async function playTrack(uri){
  const token=localStorage.getItem('access_token');
  if(!token) return false;
  await spotifyReady;
  try{
    const dev=window.deviceId?`?device_id=${window.deviceId}`:'';
    const res=await fetch(`https://api.spotify.com/v1/me/player/play${dev}`,{
      method:'PUT',
      headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({uris:[uri]})
    });
    return res.status===204;
  }catch(e){console.error(e);return false;}
}

async function stopPlayback(){
  const token=localStorage.getItem('access_token');
  if(!token) return;
  try{
    await fetch('https://api.spotify.com/v1/me/player/pause',{method:'PUT',headers:{'Authorization':`Bearer ${token}`}});
  }catch(e){console.warn('stop error',e);}
}

function getRandomTrack(tracks){
  if(!tracks||!tracks.length) return null;
  const idx=Math.floor(Math.random()*tracks.length);
  return tracks[idx];
}

function updateTrackDetailsElement(track){
  const details=document.getElementById('track-details');
  if(!details) return;
  let expanded=false;
  details.textContent='Songinfos auflösen';
  details.onclick=()=>{
    if(!expanded){
      details.innerHTML=`
        <div style="text-align:left;">
          <p><strong>Titel:</strong> ${track.name}</p>
          <p><strong>Interpret:</strong> ${track.artists.map(a=>a.name).join(', ')}</p>
          <p><strong>Album:</strong> ${track.album.name||''}</p>
          <p><strong>Jahr:</strong> ${track.album.release_date?track.album.release_date.substring(0,4):''}</p>
        </div>
      `;
      const weiter=document.createElement('button');
      weiter.className='btn details-weiter-btn green';
      weiter.textContent='Nächstes Lied';
      weiter.type='button';
      details.appendChild(weiter);

      weiter.addEventListener('click',async(ev)=>{
        ev.stopPropagation();
        clearTimeout(pulseTimer1);
        clearTimeout(pulseTimer2);
        document.getElementById('wheel-container').classList.remove('pulse-yellow','pulse-red');
        await stopPlayback();
        hasSpun=false; hasPulsed=false;
        document.getElementById('now-playing').style.display='none';
        document.getElementById('selected-category').textContent='';
      });
      expanded=true;
    }else{
      details.textContent='Songinfos auflösen';
      expanded=false;
    }
  };
}

/* ==== Glücksrad ==== */
function drawWheel(){
  const canvas=document.getElementById('wheel-canvas');
  const ctx=canvas.getContext('2d');
  const count=categories.length;
  const arc=(2*Math.PI)/count;
  const colors=['#ff8a80','#f48fb1','#ce93d8','#9fa8da','#81d4fa','#80cbc4','#a5d6a7','#ffcc80','#fff59d','#c5e1a5','#b39ddb','#ffab91'];
  ctx.clearRect(0,0,400,400);
  for(let i=0;i<count;i++){
    ctx.beginPath();
    ctx.fillStyle=colors[i%colors.length];
    ctx.moveTo(200,200);
    ctx.arc(200,200,200,i*arc,(i+1)*arc);
    ctx.lineTo(200,200);
    ctx.fill();
    ctx.save();
    ctx.translate(200,200);
    ctx.rotate(i*arc+arc/2);
    ctx.textAlign='right';
    ctx.fillStyle='#222';
    ctx.font='bold 18px Roboto';
    ctx.fillText(categories[i],180,10);
    ctx.restore();
  }
}

function spinWheel(){
  const canvas=document.getElementById('wheel-canvas');
  const count=categories.length;
  const arc=360/count;
  const spin=3600+Math.floor(Math.random()*360);
  rotation+=spin;
  canvas.style.transform=`rotate(${rotation}deg)`;
  const picked=(count - Math.floor(((rotation%360)/arc)))%count;
  return categories[picked];
}

function pulseWheel(){
  return new Promise(resolve=>{
    const wheel=document.getElementById('wheel-container');
    wheel.classList.add('pulse-yellow');
    pulseTimer1=setTimeout(()=>{
      wheel.classList.remove('pulse-yellow');
      wheel.classList.add('pulse-red');
      pulseTimer2=setTimeout(()=>{
        wheel.classList.remove('pulse-red');
        buzzer.currentTime=0; buzzer.play().catch(()=>{});
        resolve();
      },5000);
    },15000);
  });
}

/* ==== Hauptlogik ==== */
document.addEventListener('DOMContentLoaded',async()=>{
  const token=localStorage.getItem('access_token');
  if(!token){window.location.href='index.html';return;}
  const loading=document.getElementById('loading-text');
  const startBtn=document.getElementById('start-btn');
  const wheelContainer=document.getElementById('wheel-container');
  const wheelCanvas=document.getElementById('wheel-canvas');
  const selectedCategoryDiv=document.getElementById('selected-category');
  const nowPlaying=document.getElementById('now-playing');

  const playlistUrl=localStorage.getItem('bingoPlaylistUrl')||localStorage.getItem('mobilePlaylistUrl')||'';
  const playlistId=extractPlaylistId(playlistUrl);
  if(!playlistId)return;

  loading.style.display='block';
  cachedPlaylistTracks=await fetchPlaylistTracks(playlistId);
  loading.style.display='none';

  if(!cachedPlaylistTracks.length){
    document.getElementById('empty-warning').style.display='block';
    return;
  }

  startBtn.style.display='inline-block';
  categories=JSON.parse(localStorage.getItem('bingoCategories')||'[]');
  const discokugelActive=categories.length>0;
  wheelCtx=wheelCanvas.getContext('2d');

  if(discokugelActive){
    startBtn.addEventListener('click',()=>{
      startBtn.style.display='none';
      wheelContainer.style.display='block';
      drawWheel();

      wheelCanvas.addEventListener('click',async()=>{
        if(!hasSpun){
          const category=spinWheel();
          selectedCategoryDiv.textContent='';
          setTimeout(async()=>{
            selectedCategoryDiv.textContent="Kategorie: "+category;
            const item=getRandomTrack(cachedPlaylistTracks);
            if(!item||!item.track)return;
            selectedTrackUri=item.track.uri;
            await playTrack(selectedTrackUri);
            updateTrackDetailsElement(item.track);
            nowPlaying.style.display='block';
            cachedPlaylistTracks=cachedPlaylistTracks.filter(x=>x.track&&x.track.uri!==selectedTrackUri);
            hasSpun=true;
            hasPulsed=false;
          },5000);
          return;
        }
        if(!hasPulsed){
          await pulseWheel();
          await stopPlayback();
          hasPulsed=true;
        }
      });
    });
  }else{
    startBtn.addEventListener('click',async()=>{
      startBtn.style.display='none';
      nowPlaying.style.display='block';
      const track=getRandomTrack(cachedPlaylistTracks);
      if(!track||!track.track)return;
      selectedTrackUri=track.track.uri;
      await playTrack(selectedTrackUri);
      updateTrackDetailsElement(track.track);
      cachedPlaylistTracks=cachedPlaylistTracks.filter(x=>x.track&&x.track.uri!==selectedTrackUri);
    });
  }
});
