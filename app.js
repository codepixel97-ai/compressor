const $=s=>document.querySelector(s);
const fileInput=$("#fileInput"), drop=$("#dropZone"), workspace=$("#workspace");
let file=null, mode="regular", outputBlob=null, outputName="";

const fmt=n=>{
  if(n<1024)return n+" B";
  if(n<1048576)return (n/1024).toFixed(1)+" KB";
  if(n<1073741824)return (n/1048576).toFixed(2)+" MB";
  return (n/1073741824).toFixed(2)+" GB";
};
function setProgress(p,text,detail=""){
  $("#progressBox").classList.remove("hidden");
  $("#progressText").textContent=Math.round(p)+"%";
  $("#barFill").style.width=Math.max(1,p)+"%";
  $("#statusText").textContent=text;
  $("#progressDetail").textContent=detail;
}
function resetResult(){
  outputBlob=null; $("#result").classList.add("hidden"); $("#progressBox").classList.add("hidden");
}
function loadFile(f){
  if(!f)return;
  file=f; resetResult();
  drop.classList.add("hidden"); workspace.classList.remove("hidden");
  $("#fileName").textContent=f.name;
  $("#fileMeta").textContent=`${fmt(f.size)} • ${f.type||"Unknown file type"}`;
  $("#imageFormatWrap").style.display=f.type.startsWith("image/")?"block":"none";
  updateHint();
}
function updateHint(){
  if(!file)return;
  const val=Number($("#targetSize").value)||0;
  const bytes=val*($("#targetUnit").value==="MB"?1048576:1024);
  $("#targetHint").textContent=bytes>=file.size
    ?"Your target is the same size or larger than the original."
    :`Target is ${Math.round((1-bytes/file.size)*100)}% smaller than the original.`;
}
$("#chooseBtn").onclick=()=>fileInput.click();
fileInput.onchange=e=>loadFile(e.target.files[0]);
$("#removeBtn").onclick=()=>{file=null;fileInput.value="";workspace.classList.add("hidden");drop.classList.remove("hidden");resetResult()};
["dragenter","dragover"].forEach(x=>drop.addEventListener(x,e=>{e.preventDefault();drop.classList.add("drag")}));
["dragleave","drop"].forEach(x=>drop.addEventListener(x,e=>{e.preventDefault();drop.classList.remove("drag")}));
drop.addEventListener("drop",e=>loadFile(e.dataTransfer.files[0]));
drop.addEventListener("click",e=>{if(e.target.id!=="chooseBtn")fileInput.click()});
document.querySelectorAll(".mode").forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll(".mode").forEach(b=>b.classList.remove("active"));
  btn.classList.add("active"); mode=btn.dataset.mode;
  $("#targetPanel").classList.toggle("hidden",mode!=="target"); updateHint();
});
$("#targetSize").oninput=updateHint; $("#targetUnit").onchange=updateHint;

async function imageToCanvas(f){
  const bmp=await createImageBitmap(f);
  let scale=1;
  const preset=$("#speed").value;
  const maxDim=preset==="fast"?2560:preset==="balanced"?2048:1600;
  if(Math.max(bmp.width,bmp.height)>maxDim) scale=maxDim/Math.max(bmp.width,bmp.height);
  const c=document.createElement("canvas");
  c.width=Math.max(1,Math.round(bmp.width*scale)); c.height=Math.max(1,Math.round(bmp.height*scale));
  c.getContext("2d",{alpha:false}).drawImage(bmp,0,0,c.width,c.height);
  bmp.close?.(); return c;
}
const canvasBlob=(c,type,q)=>new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error("Could not encode image.")),type,q));

async function compressImage(){
  setProgress(10,"Preparing image…","Decoding locally");
  const c=await imageToCanvas(file), type=$("#imageFormat").value;
  if(mode==="regular"){
    const q={fast:.82,balanced:.72,maximum:.55}[$("#speed").value];
    setProgress(45,"Compressing image…","Optimizing quality and dimensions");
    const b=await canvasBlob(c,type,q); setProgress(100,"Done","Image compressed");
    return b;
  }
  const target=(Number($("#targetSize").value)||20)*($("#targetUnit").value==="MB"?1048576:1024);
  let lo=.05,hi=.95,best=null;
  for(let i=0;i<9;i++){
    const q=(lo+hi)/2, b=await canvasBlob(c,type,q);
    setProgress(20+i*8,"Finding target size…",`Attempt ${i+1}/9 • ${fmt(b.size)}`);
    if(b.size<=target){best=b;lo=q}else hi=q;
  }
  if(!best){
    // Reduce dimensions progressively when quality alone is not enough.
    let current=c;
    for(let i=0;i<5&&!best;i++){
      const n=document.createElement("canvas"); n.width=Math.max(1,Math.round(current.width*.78)); n.height=Math.max(1,Math.round(current.height*.78));
      n.getContext("2d",{alpha:false}).drawImage(current,0,0,n.width,n.height); current=n;
      const b=await canvasBlob(current,type,.25);
      setProgress(85+i*2,"Reducing dimensions…",`${current.width}×${current.height} • ${fmt(b.size)}`);
      if(b.size<=target)best=b;
    }
  }
  if(!best)best=await canvasBlob(c,type,.05);
  setProgress(100,"Done",best.size<=target?"Target reached":"Closest practical browser result");
  return best;
}

async function compressVideo(){
  // MediaRecorder re-encodes in real time using browser-native codecs. This avoids shipping a huge FFmpeg WASM bundle.
  const url=URL.createObjectURL(file), video=document.createElement("video");
  video.src=url; video.muted=true; video.playsInline=true;
  await new Promise((r,j)=>{video.onloadedmetadata=r;video.onerror=()=>j(new Error("This browser cannot decode this video format."))});
  const duration=video.duration;
  if(!Number.isFinite(duration)||duration<=0)throw new Error("Could not read video duration.");
  const targetBytes=(Number($("#targetSize").value)||20)*($("#targetUnit").value==="MB"?1048576:1024);
  let bitrate;
  if(mode==="target"){
    bitrate=Math.max(180000,Math.floor((targetBytes*8/duration)*0.92));
  }else{
    bitrate={fast:3500000,balanced:2200000,maximum:1200000}[$("#speed").value];
  }
  const stream=video.captureStream?.();
  if(!stream)throw new Error("Video compression is not supported by this browser. Try Chrome or Edge.");
  const candidates=["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm"];
  const mime=candidates.find(x=>MediaRecorder.isTypeSupported(x));
  if(!mime)throw new Error("Your browser does not provide a compatible video encoder.");
  const rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:bitrate,audioBitsPerSecond:96000});
  const chunks=[];
  rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  const done=new Promise((r,j)=>{rec.onstop=r;rec.onerror=e=>j(e.error||new Error("Video encoding failed."))});
  rec.start(1000); video.currentTime=0; await video.play();
  const timer=setInterval(()=>setProgress(Math.min(96,(video.currentTime/duration)*100),"Compressing video…",`${Math.round(video.currentTime)}s / ${Math.round(duration)}s • ${(bitrate/1e6).toFixed(2)} Mbps`),300);
  await new Promise(r=>video.onended=r); rec.stop(); await done; clearInterval(timer); URL.revokeObjectURL(url);
  setProgress(100,"Done","Video re-encoded locally");
  return new Blob(chunks,{type:"video/webm"});
}

async function compressZip(){
  if(!window.JSZip)throw new Error("ZIP library failed to load.");
  setProgress(15,"Preparing ZIP…","Reading file");
  const zip=new JSZip(); zip.file(file.name,file);
  const blob=await zip.generateAsync({type:"blob",compression:"DEFLATE",compressionOptions:{level:$("#speed").value==="fast"?3:$("#speed").value==="balanced"?6:9}},m=>{
    setProgress(15+m.percent*.84,"Compressing ZIP…",`${m.percent.toFixed(0)}% processed`);
  });
  setProgress(100,"Done","ZIP created");
  return blob;
}

$("#compressBtn").onclick=async()=>{
  if(!file)return;
  resetResult(); $("#compressBtn").disabled=true;
  try{
    if(mode==="target"){
      const target=(Number($("#targetSize").value)||0)*($("#targetUnit").value==="MB"?1048576:1024);
      if(target<=0)throw new Error("Enter a valid target size.");
    }
    outputBlob=file.type.startsWith("image/")?await compressImage():file.type.startsWith("video/")?await compressVideo():await compressZip();
    const base=file.name.replace(/\.[^.]+$/,"");
    outputName=file.type.startsWith("image/")?`${base}-compressed.${$("#imageFormat").value==="image/webp"?"webp":"jpg"}`:
      file.type.startsWith("video/")?`${base}-compressed.webm`:`${base}-compressed.zip`;
    const saved=(1-outputBlob.size/file.size)*100;
    $("#resultStats").textContent=`${fmt(file.size)} → ${fmt(outputBlob.size)}${saved>0?` • ${saved.toFixed(1)}% smaller`:" • File did not become smaller"}`;
    $("#result").classList.remove("hidden");
  }catch(err){
    setProgress(0,"Compression failed",err.message||String(err));
  }finally{$("#compressBtn").disabled=false}
};
$("#downloadBtn").onclick=()=>{
  if(!outputBlob)return;
  const a=document.createElement("a"); a.href=URL.createObjectURL(outputBlob); a.download=outputName; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),5000);
};
