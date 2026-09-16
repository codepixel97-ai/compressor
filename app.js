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
  setProgress(2,"Loading video engine…","First use downloads the browser video engine (~30 MB)");
  const { FFmpeg } = await import("https://esm.sh/@ffmpeg/ffmpeg@0.12.15");
  const { fetchFile, toBlobURL } = await import("https://esm.sh/@ffmpeg/util@0.12.2");

  const ffmpeg = new FFmpeg();
  let lastProgress=0;
  ffmpeg.on("progress",({progress})=>{
    if(Number.isFinite(progress)){
      lastProgress=Math.max(lastProgress,Math.min(0.98,progress));
      setProgress(8+lastProgress*88,"Compressing video…",`${Math.round(lastProgress*100)}% encoded • Keep this tab open`);
    }
  });

  // Single-thread core is intentionally used for broad compatibility, including iOS.
  const base="https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`,"text/javascript"),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`,"application/wasm")
  });

  setProgress(8,"Preparing video…","Reading file into the local video engine");
  const ext=(file.name.split(".").pop()||"mp4").replace(/[^a-z0-9]/gi,"").toLowerCase()||"mp4";
  const input=`input.${ext}`, output="output.mp4";
  await ffmpeg.writeFile(input,await fetchFile(file));

  let args;
  if(mode==="target"){
    const target=(Number($("#targetSize").value)||20)*($("#targetUnit").value==="MB"?1048576:1024);

    // Read duration in-browser so target bitrate can be calculated.
    const u=URL.createObjectURL(file), v=document.createElement("video");
    v.preload="metadata"; v.src=u;
    await new Promise((r,j)=>{v.onloadedmetadata=r;v.onerror=()=>j(new Error("Could not read this video's duration."))});
    const duration=v.duration; URL.revokeObjectURL(u);
    if(!Number.isFinite(duration)||duration<=0)throw new Error("Could not read this video's duration.");

    // Reserve about 96 kbps for audio plus ~4% container overhead.
    const totalKbps=Math.max(160,Math.floor((target*8/duration/1000)*0.95));
    const audioKbps=Math.min(96,Math.max(48,Math.floor(totalKbps*.16)));
    const videoKbps=Math.max(100,totalKbps-audioKbps);

    args=["-i",input,"-c:v","libx264","-preset","veryfast","-b:v",`${videoKbps}k`,
      "-maxrate",`${Math.round(videoKbps*1.08)}k`,"-bufsize",`${videoKbps*2}k`,
      "-c:a","aac","-b:a",`${audioKbps}k`,"-movflags","+faststart",output];
  }else{
    const p=$("#speed").value;
    const crf=p==="fast"?"28":p==="balanced"?"30":"33";
    const preset=p==="maximum"?"medium":"veryfast";
    args=["-i",input,"-c:v","libx264","-preset",preset,"-crf",crf,
      "-c:a","aac","-b:a",p==="maximum"?"64k":"96k","-movflags","+faststart",output];
  }

  setProgress(10,"Compressing video…","This can take a while on phones. Keep this tab open.");
  await ffmpeg.exec(args);
  const data=await ffmpeg.readFile(output);
  try{await ffmpeg.deleteFile(input);await ffmpeg.deleteFile(output)}catch{}
  ffmpeg.terminate();
  setProgress(100,"Done","MP4 video created locally");
  return new Blob([data.buffer],{type:"video/mp4"});
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
      file.type.startsWith("video/")?`${base}-compressed.mp4`:`${base}-compressed.zip`;
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
