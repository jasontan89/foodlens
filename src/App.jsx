import { useState, useRef, useCallback, useEffect } from "react";

const C = {
  bg:"#FAFAF7", surface:"#FFFFFF", mint:"#E8F5E9",
  green:"#1A2E1A", lime:"#76C442",
  slate:"#4A5568", slateL:"#718096", border:"#E2E8F0",
  red:"#E53E3E", redL:"#FFF5F5",
  amber:"#D97706", amberL:"#FFFBEB",
  blue:"#3182CE", purple:"#9F7AEA",
  shadow:"rgba(26,46,26,0.10)",
};

function btn(variant, extra={}) {
  const base = { padding:"12px 16px", borderRadius:10, fontSize:14, fontWeight:600,
    cursor:"pointer", border:"none", transition:"all 0.15s", fontFamily:"inherit" };
  const styles = {
    primary: { background:C.lime, color:"#fff" },
    outline: { background:"transparent", border:`2px solid ${C.lime}`, color:C.lime },
    ghost:   { background:C.bg, border:`1px solid ${C.border}`, color:C.slate },
  };
  return { ...base, ...(styles[variant]||{}), ...extra };
}

const today   = () => new Date().toISOString().split("T")[0];
const fmtDate = d  => new Date(d).toLocaleDateString("en-SG",{day:"numeric",month:"short"});

function lsGet(k) { try { const v=localStorage.getItem(k); return v?JSON.parse(v):null; } catch { return null; } }
function lsSet(k,v) { try { localStorage.setItem(k,JSON.stringify(v)); } catch {} }

// ── Mifflin-St Jeor targets ──────────────────────────────────────────────────
function calcTargets(p) {
  if (!p?.age) return { calories:2000, protein:50, carbs:250, fat:65, fibre:25 };
  const w=Number(p.weight)||70, h=Number(p.height)||170, a=Number(p.age)||30;
  const bmr = p.gender==="female" ? 10*w+6.25*h-5*a-161 : 10*w+6.25*h-5*a+5;
  const mult = { sedentary:1.2, light:1.375, moderate:1.55, active:1.725, veryActive:1.9 };
  const tdee = bmr*(mult[p.activity]||1.375);
  const adj  = p.goal==="lose"?-500:p.goal==="gain"?300:0;
  const calories = Math.round(tdee+adj);
  const protein  = p.goal==="gain"?Math.round(w*2):p.goal==="lose"?Math.round(w*1.8):Math.round(w*1.5);
  const fat      = Math.round((calories*0.28)/9);
  const carbs    = Math.max(50,Math.round((calories-protein*4-fat*9)/4));
  const fibre    = p.gender==="female"?(a>50?21:25):(a>50?30:38);
  return { calories, protein, carbs, fat, fibre };
}

// ── Rule-based scoring engine ────────────────────────────────────────────────
function scoreNutrition(n, additiveCount=0) {
  const v = k => n[k]?.value!=null ? Number(n[k].value) : null;
  const curve = (val,breaks,scores) => {
    if (val===null) return 50;
    for (let i=0;i<breaks.length;i++) if (val<=breaks[i]) return scores[i];
    return scores[scores.length-1];
  };
  const sugarS  = curve(v("sugars"),       [1,5,10,20,30],  [100,80,60,35,15,0]);
  const satFatS = curve(v("saturatedFat"), [0.5,2,5,10],    [100,80,55,25,0]);
  const sodiumS = curve(v("sodium"),       [50,200,500,800],[100,80,55,25,0]);
  const fibreS  = curve(v("dietaryFibre"), [1,3,6,10],      [10,30,55,80,100]);
  const protS   = curve(v("protein"),      [3,6,10,15,20],  [10,25,50,75,100]);
  const novaS   = additiveCount===0?100:additiveCount<=1?75:additiveCount<=3?45:15;
  let score = sugarS*.25+satFatS*.20+sodiumS*.20+fibreS*.15+protS*.10+novaS*.10;
  if (v("transFat")>0) score-=12;
  score = Math.max(0,Math.min(100,Math.round(score)));
  const grade      = score>=80?"A":score>=60?"B":score>=40?"C":score>=20?"D":"F";
  const gradeColor = score>=80?"#2F855A":score>=60?"#38A169":score>=40?C.amber:C.red;
  const label      = score>=80?"Excellent":score>=60?"Good":score>=40?"Moderate":score>=20?"Poor":"Avoid";
  const emoji      = score>=80?"🟢":score>=60?"🟡":score>=40?"🟠":"🔴";
  return { overall:score, grade, gradeColor, label, emoji,
    breakdown:[
      {name:"Sugar",        score:sugarS,  weight:"25%"},
      {name:"Saturated fat",score:satFatS, weight:"20%"},
      {name:"Sodium",       score:sodiumS, weight:"20%"},
      {name:"Dietary fibre",score:fibreS,  weight:"15%"},
      {name:"Protein",      score:protS,   weight:"10%"},
      {name:"Processing",   score:novaS,   weight:"10%"},
    ]
  };
}

// ── API call — sends image + profile, gets extraction + AI analysis ──────────
async function callAnalyse(base64DataUrl, profile) {
  const base64   = base64DataUrl.split(",")[1];
  const mimeType = base64DataUrl.split(";")[0].split(":")[1] || "image/jpeg";
  const res = await fetch("/api/analyse", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ imageBase64:base64, mimeType, profile }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data;
}

// ══════════════════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ══════════════════════════════════════════════════════════════════════════════

function StepBar({ step }) {
  const steps=["Upload","Crop","Preview","Analyse"];
  return (
    <div style={{ display:"flex", alignItems:"center", marginBottom:24 }}>
      {steps.map((s,i)=>{
        const active=i===step, done=i<step;
        return (
          <div key={s} style={{ display:"flex", alignItems:"center", flex:i<3?1:"none" }}>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
              <div style={{ width:26, height:26, borderRadius:"50%",
                background:done?C.lime:active?C.green:C.border,
                color:done||active?"#fff":C.slateL,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:11, fontWeight:700, boxShadow:active?`0 0 0 3px ${C.mint}`:"none" }}>
                {done?"✓":i+1}
              </div>
              <span style={{ fontSize:9, fontWeight:600, whiteSpace:"nowrap",
                color:active?C.green:done?C.lime:C.slateL }}>{s}</span>
            </div>
            {i<3&&<div style={{ flex:1, height:2, margin:"0 4px", marginBottom:16,
              background:done?C.lime:C.border }} />}
          </div>
        );
      })}
    </div>
  );
}

function Card({ children, style={} }) {
  return <div style={{ background:C.surface, borderRadius:16, padding:16,
    border:`1px solid ${C.border}`, ...style }}>{children}</div>;
}

function SectionTitle({ children, style={} }) {
  return <p style={{ margin:"0 0 10px", fontSize:11, fontWeight:700,
    color:C.green, letterSpacing:0.5, ...style }}>{children}</p>;
}

function MacroBar({ label, current, target, color, unit="g" }) {
  const pct=Math.min(100,target>0?Math.round((current/target)*100):0);
  const over=current>target;
  return (
    <div style={{ marginBottom:10 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
        <span style={{ fontSize:12, color:C.slate }}>{label}</span>
        <span style={{ fontSize:12, fontWeight:700, color:over?C.red:C.green }}>
          {current.toFixed(1)}<span style={{ color:C.slateL, fontWeight:400 }}>/{target}{unit}</span>
        </span>
      </div>
      <div style={{ height:6, background:C.border, borderRadius:3, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${pct}%`, borderRadius:3, transition:"width 0.5s",
          background:over?C.red:pct>80?C.amber:color }} />
      </div>
    </div>
  );
}

// ── Profile form fields (defined OUTSIDE ProfileScreen to fix keyboard bug) ──
function ProfileInput({ label, field, value, onChange, type="number", placeholder="" }) {
  return (
    <div style={{ marginBottom:14 }}>
      <label style={{ fontSize:12, fontWeight:600, color:C.green, display:"block", marginBottom:5 }}>{label}</label>
      <input type={type} value={value} onChange={e=>onChange(field,e.target.value)} placeholder={placeholder}
        style={{ width:"100%", padding:"10px 12px", borderRadius:8, border:`1.5px solid ${C.border}`,
          fontSize:14, outline:"none", boxSizing:"border-box", background:C.bg,
          fontFamily:"inherit" }} />
    </div>
  );
}

function ProfileSelect({ label, field, value, onChange, options }) {
  return (
    <div style={{ marginBottom:14 }}>
      <label style={{ fontSize:12, fontWeight:600, color:C.green, display:"block", marginBottom:5 }}>{label}</label>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
        {options.map(([val,lbl])=>(
          <button key={val} onClick={()=>onChange(field,val)} style={{
            padding:"7px 12px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer",
            border:`1.5px solid ${value===val?C.lime:C.border}`,
            background:value===val?C.mint:"transparent",
            color:value===val?C.green:C.slateL }}>
            {lbl}
          </button>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SCREEN: PROFILE
// ══════════════════════════════════════════════════════════════════════════════
function ProfileScreen({ profile, onSave }) {
  const [form,setForm]=useState(profile||{ name:"",age:"",gender:"male",weight:"",height:"",activity:"moderate",goal:"maintain" });
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const targets=calcTargets(form);
  const isComplete=form.age&&form.weight&&form.height;

  return (
    <div>
      <div style={{ textAlign:"center", marginBottom:20 }}>
        <div style={{ display:"inline-flex", alignItems:"center", justifyContent:"center",
          width:48, height:48, borderRadius:14, background:C.mint, marginBottom:10 }}>
          <span style={{ fontSize:22 }}>👤</span>
        </div>
        <h2 style={{ margin:"0 0 4px", fontSize:20, fontWeight:700, color:C.green }}>Your Profile</h2>
        <p style={{ margin:0, fontSize:13, color:C.slateL }}>Used to calculate your daily nutrition targets</p>
      </div>

      <ProfileInput label="Name (optional)" field="name" value={form.name} onChange={set} type="text" placeholder="e.g. Jason" />
      <ProfileInput label="Age" field="age" value={form.age} onChange={set} placeholder="e.g. 28" />
      <ProfileInput label="Weight (kg)" field="weight" value={form.weight} onChange={set} placeholder="e.g. 72" />
      <ProfileInput label="Height (cm)" field="height" value={form.height} onChange={set} placeholder="e.g. 175" />
      <ProfileSelect label="Gender" field="gender" value={form.gender} onChange={set}
        options={[["male","Male"],["female","Female"]]} />
      <ProfileSelect label="Activity Level" field="activity" value={form.activity} onChange={set}
        options={[["sedentary","Sedentary"],["light","Light"],["moderate","Moderate"],["active","Active"],["veryActive","Very Active"]]} />
      <ProfileSelect label="Goal" field="goal" value={form.goal} onChange={set}
        options={[["lose","Lose Weight"],["maintain","Maintain"],["gain","Build Muscle"]]} />

      {isComplete&&(
        <Card style={{ background:C.mint, border:`1px solid ${C.lime}`, marginBottom:16 }}>
          <SectionTitle>YOUR ESTIMATED DAILY TARGETS</SectionTitle>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {[["🔥","Calories",targets.calories,"kcal"],["💪","Protein",targets.protein,"g"],
              ["🌾","Carbs",targets.carbs,"g"],["🫙","Fat",targets.fat,"g"],["🌿","Fibre",targets.fibre,"g"]].map(([icon,name,val,unit])=>(
              <div key={name} style={{ background:C.surface, borderRadius:8, padding:"8px 10px" }}>
                <div style={{ fontSize:11, color:C.slateL }}>{icon} {name}</div>
                <div style={{ fontSize:16, fontWeight:800, color:C.green }}>{val}
                  <span style={{ fontSize:11, fontWeight:400, color:C.slateL }}> {unit}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      <button onClick={()=>onSave(form)} style={{ ...btn("primary"), width:"100%" }}>Save Profile ✓</button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SCANNER STEPS
// ══════════════════════════════════════════════════════════════════════════════

// ── FIX: removed capture="environment" so mobile shows Camera + Gallery + Files
function UploadStep({ onImage }) {
  const inputRef=useRef();
  const [dragging,setDragging]=useState(false);
  const [error,setError]=useState("");

  const handleFile=file=>{
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")){ setError("Please upload an image file."); return; }
    if (file.size>20*1024*1024){ setError("File too large — max 20 MB."); return; }
    const reader=new FileReader();
    reader.onload=e=>onImage(e.target.result);
    reader.onerror=()=>setError("Failed to read file.");
    reader.readAsDataURL(file);
  };

  return (
    <div>
      <div style={{ textAlign:"center", marginBottom:20 }}>
        <div style={{ display:"inline-flex", alignItems:"center", justifyContent:"center",
          width:48, height:48, borderRadius:14, background:C.mint, marginBottom:10 }}>
          <span style={{ fontSize:22 }}>🔬</span>
        </div>
        <h2 style={{ margin:"0 0 4px", fontSize:20, fontWeight:700, color:C.green }}>Scan Food Label</h2>
        <p style={{ margin:0, fontSize:13, color:C.slateL }}>
          Take a photo or upload from your gallery
        </p>
      </div>

      <div onClick={()=>inputRef.current.click()}
        onDragOver={e=>{e.preventDefault();setDragging(true);}}
        onDragLeave={()=>setDragging(false)}
        onDrop={e=>{e.preventDefault();setDragging(false);handleFile(e.dataTransfer.files[0]);}}
        style={{ border:`2px dashed ${dragging?C.lime:C.border}`, borderRadius:16,
          padding:"36px 24px", textAlign:"center", cursor:"pointer",
          background:dragging?C.mint:C.bg, transition:"all 0.2s", marginBottom:14 }}>
        <div style={{ fontSize:36, marginBottom:10 }}>📷</div>
        <p style={{ margin:"0 0 6px", fontWeight:700, color:C.green, fontSize:15 }}>
          Tap to upload a photo
        </p>
        <p style={{ margin:"0 0 4px", fontSize:12, color:C.slateL }}>
          📱 Mobile: choose Camera, Gallery, or Files
        </p>
        <p style={{ margin:0, fontSize:12, color:C.slateL }}>
          💻 Desktop: drag & drop or click to browse
        </p>
      </div>

      {/* No capture="environment" — lets OS show full chooser on mobile */}
      <input ref={inputRef} type="file" accept="image/*"
        style={{ display:"none" }} onChange={e=>handleFile(e.target.files[0])} />

      {error&&<div style={{ background:C.redL, border:`1px solid ${C.red}`, borderRadius:10,
        padding:"10px 14px", color:C.red, fontSize:13, marginBottom:12 }}>⚠️ {error}</div>}

      <div style={{ background:C.mint, borderRadius:12, padding:"12px 14px" }}>
        <p style={{ margin:"0 0 6px", fontSize:11, fontWeight:700, color:C.green }}>📌 TIPS FOR BEST RESULTS</p>
        {["Lay packet flat on a surface","Good lighting — no glare or shadows",
          "Capture the full Nutrition Panel","Include ingredient list if visible"].map((t,i)=>(
          <div key={i} style={{ display:"flex", gap:8, marginBottom:i<3?3:0 }}>
            <span style={{ color:C.lime, fontSize:12 }}>✓</span>
            <span style={{ fontSize:12, color:C.slate }}>{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CropStep({ imageUrl, onCrop, onBack }) {
  const canvasRef=useRef(); const containerRef=useRef(); const imgRef=useRef(null);
  const [imgLoaded,setImgLoaded]=useState(false);
  const [imgDims,setImgDims]=useState({w:0,h:0});
  const [canvasDims,setCanvasDims]=useState({w:0,h:0});
  const [box,setBox]=useState(null); const [drag,setDrag]=useState(null);
  const [scanLine,setScanLine]=useState(0);
  const HANDLE=12;

  const handleImgLoad=()=>{
    const img=imgRef.current; if(!img) return;
    const nw=img.naturalWidth, nh=img.naturalHeight;
    setImgDims({w:nw,h:nh});
    if(containerRef.current){
      const cw=containerRef.current.clientWidth||340;
      const ratio=nh/nw, ch=Math.min(cw*ratio,360);
      setCanvasDims({w:ch/ratio,h:ch});
    }
    setImgLoaded(true);
  };
  useEffect(()=>{ if(!imgLoaded||!containerRef.current||canvasDims.w>0) return;
    const cw=containerRef.current.clientWidth||340;
    const ratio=imgDims.h/imgDims.w, ch=Math.min(cw*ratio,360);
    setCanvasDims({w:ch/ratio,h:ch}); },[imgLoaded,imgDims,canvasDims.w]);
  useEffect(()=>{ if(!canvasDims.w) return;
    const pad=canvasDims.w*0.1;
    setBox({x:pad,y:pad,w:canvasDims.w-pad*2,h:canvasDims.h-pad*2}); },[canvasDims.w,canvasDims.h]);
  useEffect(()=>{ const t=setInterval(()=>setScanLine(p=>(p+2)%(canvasDims.h||300)),16);
    return ()=>clearInterval(t); },[canvasDims.h]);
  useEffect(()=>{
    if(!canvasDims.w||!box||!imgLoaded||!canvasRef.current) return;
    const canvas=canvasRef.current, ctx=canvas.getContext("2d");
    const dpr=window.devicePixelRatio||1;
    canvas.width=canvasDims.w*dpr; canvas.height=canvasDims.h*dpr;
    canvas.style.width=canvasDims.w+"px"; canvas.style.height=canvasDims.h+"px";
    ctx.scale(dpr,dpr);
    ctx.drawImage(imgRef.current,0,0,canvasDims.w,canvasDims.h);
    ctx.fillStyle="rgba(0,0,0,0.52)";
    ctx.fillRect(0,0,canvasDims.w,box.y);
    ctx.fillRect(0,box.y,box.x,box.h);
    ctx.fillRect(box.x+box.w,box.y,canvasDims.w-box.x-box.w,box.h);
    ctx.fillRect(0,box.y+box.h,canvasDims.w,canvasDims.h-box.y-box.h);
    ctx.strokeStyle=C.lime; ctx.lineWidth=2; ctx.strokeRect(box.x,box.y,box.w,box.h);
    [[box.x,box.y],[box.x+box.w,box.y],[box.x,box.y+box.h],[box.x+box.w,box.y+box.h]].forEach(([cx,cy])=>{
      ctx.fillStyle=C.lime; ctx.fillRect(cx-HANDLE/2,cy-HANDLE/2,HANDLE,HANDLE);
    });
    ctx.strokeStyle="rgba(118,196,66,0.3)"; ctx.lineWidth=1;
    [1/3,2/3].forEach(f=>{
      ctx.beginPath(); ctx.moveTo(box.x+box.w*f,box.y); ctx.lineTo(box.x+box.w*f,box.y+box.h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(box.x,box.y+box.h*f); ctx.lineTo(box.x+box.w,box.y+box.h*f); ctx.stroke();
    });
    const sl=scanLine%box.h;
    const g=ctx.createLinearGradient(0,box.y+sl-12,0,box.y+sl+12);
    g.addColorStop(0,"rgba(118,196,66,0)"); g.addColorStop(0.5,"rgba(118,196,66,0.5)"); g.addColorStop(1,"rgba(118,196,66,0)");
    ctx.fillStyle=g; ctx.fillRect(box.x,box.y+sl-12,box.w,24);
  },[box,canvasDims,imgLoaded,scanLine]);

  const hitTest=(ex,ey)=>{ if(!box) return null;
    const {x,y,w,h}=box;
    const cs=[{type:"tl",cx:x,cy:y},{type:"tr",cx:x+w,cy:y},{type:"bl",cx:x,cy:y+h},{type:"br",cx:x+w,cy:y+h}];
    for(const c of cs) if(Math.abs(ex-c.cx)<16&&Math.abs(ey-c.cy)<16) return c.type;
    if(ex>x&&ex<x+w&&ey>y&&ey<y+h) return "move"; return null; };
  const getPos=e=>{ const r=canvasRef.current.getBoundingClientRect(), s=e.touches?e.touches[0]:e;
    return {x:s.clientX-r.left,y:s.clientY-r.top}; };
  const onPointerDown=e=>{ e.preventDefault(); const {x,y}=getPos(e); const type=hitTest(x,y);
    if(type) setDrag({type,startX:x,startY:y,origBox:{...box}}); };
  const onPointerMove=useCallback(e=>{ if(!drag) return; e.preventDefault();
    const {x,y}=getPos(e); const dx=x-drag.startX, dy=y-drag.startY;
    const o=drag.origBox, MIN=60, cw=canvasDims.w, ch=canvasDims.h; let nb={...o};
    if(drag.type==="move"){ nb.x=Math.max(0,Math.min(cw-o.w,o.x+dx)); nb.y=Math.max(0,Math.min(ch-o.h,o.y+dy)); }
    else {
      if(drag.type.includes("r")) nb.w=Math.max(MIN,Math.min(cw-o.x,o.w+dx));
      if(drag.type.includes("l")){ const nw=Math.max(MIN,o.w-dx); nb.x=o.x+o.w-nw; nb.w=nw; }
      if(drag.type.includes("b")) nb.h=Math.max(MIN,Math.min(ch-o.y,o.h+dy));
      if(drag.type.includes("t")){ const nh=Math.max(MIN,o.h-dy); nb.y=o.y+o.h-nh; nb.h=nh; }
    }
    setBox(nb); },[drag,canvasDims]);
  const onPointerUp=useCallback(()=>setDrag(null),[]);
  const confirmCrop=()=>{
    if(!box||!imgLoaded) return;
    const sx=box.x*(imgDims.w/canvasDims.w), sy=box.y*(imgDims.h/canvasDims.h);
    const sw=box.w*(imgDims.w/canvasDims.w), sh=box.h*(imgDims.h/canvasDims.h);
    const off=document.createElement("canvas"); off.width=sw; off.height=sh;
    off.getContext("2d").drawImage(imgRef.current,sx,sy,sw,sh,0,0,sw,sh);
    onCrop(off.toDataURL("image/jpeg",0.92),{naturalW:sw,naturalH:sh}); };
  const resetBox=()=>{ if(!canvasDims.w) return; const pad=canvasDims.w*0.1;
    setBox({x:pad,y:pad,w:canvasDims.w-pad*2,h:canvasDims.h-pad*2}); };

  return (
    <div>
      <img ref={imgRef} src={imageUrl} onLoad={handleImgLoad} alt="" style={{display:"none"}} />
      <div style={{ textAlign:"center", marginBottom:12 }}>
        <h2 style={{ margin:"0 0 4px", fontSize:18, fontWeight:700, color:C.green }}>Crop the Label</h2>
        <p style={{ margin:0, fontSize:12, color:C.slateL }}>Drag corners to frame the nutrition panel</p>
      </div>
      <div ref={containerRef} style={{ width:"100%", borderRadius:12, overflow:"hidden", background:"#111",
        boxShadow:`0 4px 20px ${C.shadow}`, marginBottom:10, display:"flex",
        alignItems:"center", justifyContent:"center", minHeight:180 }}>
        {!imgLoaded&&<div style={{ color:"#aaa", fontSize:13, padding:24, textAlign:"center" }}>
          <div style={{ fontSize:24, marginBottom:8 }}>⏳</div>Loading…</div>}
        <canvas ref={canvasRef} style={{ display:imgLoaded?"block":"none", touchAction:"none" }}
          onMouseDown={onPointerDown}
          onMouseMove={e=>{ onPointerMove(e); if(canvasRef.current){const {x,y}=getPos(e);const h=hitTest(x,y);const m={tl:"nwse-resize",tr:"nesw-resize",bl:"nesw-resize",br:"nwse-resize",move:"move"};canvasRef.current.style.cursor=m[h]||"default";}}}
          onMouseUp={onPointerUp} onMouseLeave={onPointerUp}
          onTouchStart={onPointerDown} onTouchMove={onPointerMove} onTouchEnd={onPointerUp} />
      </div>
      {box&&canvasDims.w>0&&(
        <div style={{ display:"flex", justifyContent:"space-around", background:C.mint,
          borderRadius:8, padding:"6px 0", marginBottom:12, fontSize:11 }}>
          {[["W",Math.round(box.w),"px"],["H",Math.round(box.h),"px"],
            ["Area",Math.round((box.w*box.h)/(canvasDims.w*canvasDims.h)*100),"%"]].map(([l,v,u])=>(
            <div key={l} style={{ textAlign:"center" }}>
              <div style={{ fontWeight:700, color:C.green }}>{v}{u}</div>
              <div style={{ color:C.slateL }}>{l}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={onBack} style={btn("ghost")}>← Back</button>
        <button onClick={resetBox} style={btn("outline")}>⟳</button>
        <button onClick={confirmCrop} style={{ ...btn("primary"), flex:2 }}>Confirm →</button>
      </div>
    </div>
  );
}

function PreviewStep({ croppedUrl, originalUrl, onConfirm, onRecrop }) {
  const [labelType,setLabelType]=useState("");
  const types=[
    {id:"nip", icon:"📊", label:"Nutrition Panel",  desc:"Macros & calories"},
    {id:"ing", icon:"🧪", label:"Ingredient List",  desc:"Full ingredient breakdown"},
    {id:"both",icon:"📋", label:"Both Sections",    desc:"Best results"},
  ];
  return (
    <div>
      <div style={{ textAlign:"center", marginBottom:14 }}>
        <h2 style={{ margin:"0 0 4px", fontSize:18, fontWeight:700, color:C.green }}>Preview Crop</h2>
        <p style={{ margin:0, fontSize:12, color:C.slateL }}>Confirm text is clear and complete</p>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:14 }}>
        {[{src:originalUrl,label:"Original"},{src:croppedUrl,label:"Cropped ✓",hi:true}].map(({src,label,hi})=>(
          <div key={label}>
            <div style={{ borderRadius:8, overflow:"hidden", border:`2px solid ${hi?C.lime:C.border}`, marginBottom:4 }}>
              <img src={src} alt={label} style={{ width:"100%", display:"block", maxHeight:120, objectFit:"cover" }} />
            </div>
            <p style={{ margin:0, textAlign:"center", fontSize:10, fontWeight:600,
              color:hi?C.lime:C.slateL }}>{label}</p>
          </div>
        ))}
      </div>
      <p style={{ fontSize:12, fontWeight:600, color:C.green, marginBottom:8 }}>What's in your crop?</p>
      <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:16 }}>
        {types.map(({id,icon,label,desc})=>(
          <div key={id} onClick={()=>setLabelType(id)} style={{ display:"flex", alignItems:"center",
            gap:10, padding:"9px 12px", borderRadius:10, cursor:"pointer",
            border:`2px solid ${labelType===id?C.lime:C.border}`,
            background:labelType===id?C.mint:C.surface, transition:"all 0.15s" }}>
            <span style={{ fontSize:18 }}>{icon}</span>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:600, color:C.green }}>{label}</div>
              <div style={{ fontSize:11, color:C.slateL }}>{desc}</div>
            </div>
            <div style={{ width:16, height:16, borderRadius:"50%",
              border:`2px solid ${labelType===id?C.lime:C.border}`,
              background:labelType===id?C.lime:"transparent",
              display:"flex", alignItems:"center", justifyContent:"center" }}>
              {labelType===id&&<span style={{ color:"#fff", fontSize:9 }}>✓</span>}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={onRecrop} style={btn("ghost")}>← Re-crop</button>
        <button onClick={()=>labelType&&onConfirm(labelType)} disabled={!labelType}
          style={{ ...btn("primary"), flex:2, opacity:labelType?1:0.45 }}>
          Analyse with Gemini 🔍
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// RESULTS
// ══════════════════════════════════════════════════════════════════════════════

function ScoreBar({ s }) {
  const color = s>=70?"#2F855A":s>=45?C.amber:C.red;
  return (
    <div style={{ height:5, background:C.border, borderRadius:3, overflow:"hidden" }}>
      <div style={{ height:"100%", width:`${s}%`, background:color, borderRadius:3, transition:"width 0.6s" }} />
    </div>
  );
}

// ── Rule-based score tab ─────────────────────────────────────────────────────
function RuleScoreTab({ result }) {
  const n=result.nutritionPer100g||{};
  const score=scoreNutrition(n, result.additiveCount||0);
  const sc=s=>s>=70?"#2F855A":s>=45?C.amber:C.red;
  return (
    <div>
      {/* Rule-based grade header */}
      <div style={{ background:"#2D3748", borderRadius:12, padding:"12px 14px",
        marginBottom:10, display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ width:48, height:48, borderRadius:10, background:score.gradeColor, flexShrink:0,
          display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
          <span style={{ fontSize:20, fontWeight:900, color:"#fff", lineHeight:1 }}>{score.grade}</span>
          <span style={{ fontSize:8, color:"rgba(255,255,255,0.7)" }}>RULES</span>
        </div>
        <div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.5)", marginBottom:2 }}>⚙️ Rule-Based Engine</div>
          <div style={{ fontSize:18, fontWeight:900, color:"#fff" }}>{score.overall}/100
            <span style={{ fontSize:12, fontWeight:400, marginLeft:6 }}>{score.emoji} {score.label}</span>
          </div>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)" }}>Weighted threshold scoring</div>
        </div>
      </div>

      <Card style={{ marginBottom:10 }}>
        <SectionTitle>SCORE BREAKDOWN</SectionTitle>
        {score.breakdown.map(({name,score:s,weight})=>(
          <div key={name} style={{ marginBottom:8 }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
              <span style={{ fontSize:12, color:C.slate }}>{name}</span>
              <span style={{ fontSize:12, fontWeight:700, color:sc(s) }}>
                {s}/100 <span style={{ color:C.slateL, fontWeight:400 }}>({weight})</span>
              </span>
            </div>
            <ScoreBar s={s} />
          </div>
        ))}
        <div style={{ marginTop:10, padding:"8px 10px", background:C.bg, borderRadius:8,
          fontSize:11, color:C.slateL, lineHeight:1.5 }}>
          ℹ️ Scores each nutrient against fixed thresholds (e.g. sugar ≤5g = 80pts).
          Fast and consistent but doesn't consider food context.
        </div>
      </Card>
    </div>
  );
}

// ── AI analysis tab ──────────────────────────────────────────────────────────
function AIScoreTab({ aiAnalysis }) {
  if (!aiAnalysis) return (
    <div style={{ textAlign:"center", padding:24, color:C.slateL, fontSize:13 }}>
      AI analysis not available.
    </div>
  );
  const a=aiAnalysis;
  return (
    <div>
      {/* AI grade header */}
      <div style={{ background:C.green, borderRadius:12, padding:"12px 14px",
        marginBottom:10, display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ width:48, height:48, borderRadius:10, background:a.aiGradeColor||C.red, flexShrink:0,
          display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
          <span style={{ fontSize:20, fontWeight:900, color:"#fff", lineHeight:1 }}>{a.aiGrade||"?"}</span>
          <span style={{ fontSize:8, color:"rgba(255,255,255,0.7)" }}>AI</span>
        </div>
        <div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.5)", marginBottom:2 }}>🧠 Gemini 2.5 Flash</div>
          <div style={{ fontSize:18, fontWeight:900, color:"#fff" }}>{a.aiScore||0}/100
            <span style={{ fontSize:12, fontWeight:400, marginLeft:6 }}>
              {a.aiScore>=80?"🟢":a.aiScore>=60?"🟡":a.aiScore>=40?"🟠":"🔴"} {a.aiLabel}
            </span>
          </div>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)" }}>
            {a.novaLabel||""}{a.novaGroup ? ` · NOVA Group ${a.novaGroup}` : ""}
          </div>
        </div>
      </div>

      {/* Verdict */}
      {a.verdict&&(
        <Card style={{ marginBottom:10, background:"#F0FFF4", border:`1px solid #9AE6B4` }}>
          <SectionTitle style={{ color:"#276749" }}>🧠 AI VERDICT</SectionTitle>
          <p style={{ margin:0, fontSize:13, color:"#276749", lineHeight:1.6 }}>{a.verdict}</p>
        </Card>
      )}

      {/* What's in it */}
      {a.whatIsInIt?.length>0&&(
        <Card style={{ marginBottom:10 }}>
          <SectionTitle>WHAT'S IN IT</SectionTitle>
          {a.whatIsInIt.map((w,i)=>(
            <div key={i} style={{ paddingBottom:i<a.whatIsInIt.length-1?10:0,
              marginBottom:i<a.whatIsInIt.length-1?10:0,
              borderBottom:i<a.whatIsInIt.length-1?`1px solid ${C.border}`:"none" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3 }}>
                <span style={{ fontSize:13, color:C.slate }}>{w.icon} {w.nutrient}</span>
                <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                  <span style={{ fontSize:11, fontWeight:700, color:"#fff",
                    background:w.statusColor||C.slateL, borderRadius:4, padding:"1px 7px" }}>
                    {w.status}
                  </span>
                  <span style={{ fontSize:12, fontWeight:700, color:C.green }}>{w.value}</span>
                </div>
              </div>
              {w.analogy&&<div style={{ fontSize:11, color:C.amber, marginBottom:2 }}>≈ {w.analogy}</div>}
              {w.implication&&<div style={{ fontSize:11, color:C.slateL }}>{w.implication}</div>}
            </div>
          ))}
        </Card>
      )}

      {/* Red & Green Flags */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
        {a.redFlags?.length>0&&(
          <Card style={{ background:C.redL, border:`1px solid ${C.red}` }}>
            <SectionTitle style={{ color:C.red }}>🚩 RED FLAGS</SectionTitle>
            {a.redFlags.map((f,i)=>(
              <div key={i} style={{ fontSize:11, color:C.red, marginBottom:i<a.redFlags.length-1?5:0,
                paddingLeft:4, borderLeft:`2px solid ${C.red}`, paddingBottom:2 }}>{f}</div>
            ))}
          </Card>
        )}
        {a.greenFlags?.length>0&&(
          <Card style={{ background:"#F0FFF4", border:"1px solid #9AE6B4" }}>
            <SectionTitle style={{ color:"#276749" }}>✅ GREEN FLAGS</SectionTitle>
            {a.greenFlags.map((f,i)=>(
              <div key={i} style={{ fontSize:11, color:"#276749", marginBottom:i<a.greenFlags.length-1?5:0,
                paddingLeft:4, borderLeft:"2px solid #9AE6B4", paddingBottom:2 }}>{f}</div>
            ))}
          </Card>
        )}
      </div>

      {/* Smarter Swap */}
      {a.smarterSwap&&(
        <Card style={{ background:C.amberL, border:`1px solid ${C.amber}`, marginBottom:10 }}>
          <SectionTitle style={{ color:C.amber }}>💡 SMARTER SWAP</SectionTitle>
          <p style={{ margin:0, fontSize:13, color:"#7C4A00", lineHeight:1.5 }}>{a.smarterSwap}</p>
        </Card>
      )}

      <div style={{ padding:"8px 10px", background:C.bg, borderRadius:8,
        fontSize:11, color:C.slateL, lineHeight:1.5, border:`1px solid ${C.border}` }}>
        ℹ️ AI analysis considers the full nutritional picture holistically and is personalised
        to your profile. Results may vary slightly between scans.
      </div>
    </div>
  );
}

// ── Full Results Card ─────────────────────────────────────────────────────────
function ResultsCard({ result, labelType, onReset, onLogFood }) {
  const [tab,setTab]=useState("rule");
  const n=result.nutritionPer100g||{};
  const fmt=(key,dec=1)=>{ const v=n[key]; return(v&&v.value!=null)?`${Number(v.value).toFixed(dec)}${v.unit}`:"—"; };
  const noIng=result.sectionsDetected&&!result.sectionsDetected.ingredientList&&(labelType==="ing"||labelType==="both");

  return (
    <div>
      {/* Product name + confidence */}
      <div style={{ marginBottom:12 }}>
        {result.productName&&(
          <div style={{ fontSize:15, fontWeight:700, color:C.green, marginBottom:2 }}>{result.productName}</div>
        )}
        <div style={{ fontSize:11, color:C.slateL }}>
          Extraction confidence: {Math.round((result.confidence||0)*100)}%
          {noIng&&<span style={{ color:C.amber, marginLeft:8 }}>⚠ Ingredient list not in crop</span>}
        </div>
      </div>

      {/* Tab navigation */}
      <div style={{ display:"flex", borderRadius:10, overflow:"hidden",
        border:`1px solid ${C.border}`, marginBottom:12 }}>
        {[
          ["rule",  "⚙️ Rule Score"],
          ["ai",    "🧠 AI Analysis"],
          ["facts", "🥗 Nutrition"],
          ["ing",   "🧪 Ingredients"],
        ].map(([id,label],i,arr)=>(
          <button key={id} onClick={()=>setTab(id)} style={{ flex:1, padding:"8px 4px",
            fontSize:10, fontWeight:600, border:"none", cursor:"pointer", fontFamily:"inherit",
            background:tab===id?C.green:C.surface, color:tab===id?"#fff":C.slateL,
            borderRight:i<arr.length-1?`1px solid ${C.border}`:"none" }}>{label}</button>
        ))}
      </div>

      {tab==="rule"&&<RuleScoreTab result={result} />}
      {tab==="ai"&&<AIScoreTab aiAnalysis={result.aiAnalysis} />}

      {tab==="facts"&&(
        <Card style={{ marginBottom:10 }}>
          <SectionTitle>PER 100g / 100ml</SectionTitle>
          {[["🔥 Calories",fmt("calories",0)],["💪 Protein",fmt("protein")],
            ["🫙 Total Fat",fmt("totalFat")],["🧈 Saturated",fmt("saturatedFat")],
            ["⚠️ Trans Fat",fmt("transFat")],["🌾 Carbs",fmt("totalCarbs")],
            ["🍬 Sugars",fmt("sugars")],["🌿 Fibre",fmt("dietaryFibre")],
            ["🧂 Sodium",fmt("sodium",0)]].map(([label,value])=>(
            <div key={label} style={{ display:"flex", justifyContent:"space-between",
              padding:"6px 0", borderBottom:`1px solid ${C.border}` }}>
              <span style={{ fontSize:12, color:C.slate }}>{label}</span>
              <span style={{ fontSize:12, fontWeight:700, color:C.green }}>{value}</span>
            </div>
          ))}
          {result.servingInfo?.servingSize?.value&&(
            <div style={{ marginTop:8, fontSize:11, color:C.slateL, textAlign:"center" }}>
              Serving: {result.servingInfo.servingSize.value}{result.servingInfo.servingSize.unit}
              {result.servingInfo.servingsPerPack?` · ${result.servingInfo.servingsPerPack} per pack`:""}
            </div>
          )}
        </Card>
      )}

      {tab==="ing"&&(
        <div style={{ marginBottom:10 }}>
          {result.allergensSummary?.length>0&&(
            <div style={{ background:C.redL, border:`1px solid ${C.red}`, borderRadius:8,
              padding:"8px 12px", marginBottom:8 }}>
              <p style={{ margin:"0 0 3px", fontSize:11, fontWeight:700, color:C.red }}>ALLERGENS DETECTED</p>
              <p style={{ margin:0, fontSize:13, color:C.red }}>{result.allergensSummary.join(", ")}</p>
            </div>
          )}
          {result.topThreeIngredients?.length>0&&(
            <div style={{ background:C.amberL, border:`1px solid ${C.amber}`, borderRadius:8,
              padding:"8px 12px", marginBottom:8 }}>
              <p style={{ margin:"0 0 4px", fontSize:11, fontWeight:700, color:C.amber }}>TOP INGREDIENTS BY QUANTITY</p>
              {result.topThreeIngredients.map((ing,i)=>(
                <div key={i} style={{ fontSize:12, color:"#7C4A00" }}>#{i+1} {ing}</div>
              ))}
            </div>
          )}
          {result.ingredients?.length>0?(
            <Card>
              <SectionTitle>ALL INGREDIENTS ({result.ingredients.length})</SectionTitle>
              {result.ingredients.map((ing,i)=>(
                <div key={i} style={{ padding:"5px 0",
                  borderBottom:i<result.ingredients.length-1?`1px solid ${C.border}`:"none" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
                    <span style={{ fontSize:12, fontWeight:600, color:C.green }}>#{ing.rank} {ing.name}</span>
                    {ing.eNumber&&<span style={{ fontSize:10, background:C.amberL, color:C.amber,
                      borderRadius:4, padding:"1px 5px", fontWeight:600 }}>{ing.eNumber}</span>}
                  </div>
                  <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                    {ing.type&&<span style={{ fontSize:10, color:C.slateL, background:C.bg,
                      borderRadius:4, padding:"1px 5px" }}>{ing.type}</span>}
                    {ing.allergen&&<span style={{ fontSize:10, color:C.red, background:C.redL,
                      borderRadius:4, padding:"1px 5px" }}>⚠ {ing.allergen}</span>}
                  </div>
                </div>
              ))}
            </Card>
          ):(
            <div style={{ textAlign:"center", padding:16, color:C.slateL, fontSize:13 }}>
              No ingredient list detected.<br/>Scan the other side of the pack.
            </div>
          )}
        </div>
      )}

      <div style={{ display:"flex", gap:8, marginTop:4 }}>
        <button onClick={onReset} style={btn("ghost")}>Scan another</button>
        <button onClick={onLogFood} style={{ ...btn("primary"), flex:2 }}>Log this food 📋</button>
      </div>
    </div>
  );
}

// ── Analyse Step ─────────────────────────────────────────────────────────────
function AnalyseStep({ croppedUrl, labelType, profile, onReset, onLogFood }) {
  const [phase,setPhase]=useState("loading");
  const [result,setResult]=useState(null);
  const [errMsg,setErrMsg]=useState("");
  const [progress,setProgress]=useState(0);
  const called=useRef(false);
  const stages=["Sending image to Gemini…","Extracting nutrition data…","Parsing ingredients…","Running AI analysis…","Building insights…"];

  useEffect(()=>{
    if(called.current) return; called.current=true;
    let i=0;
    const tick=setInterval(()=>{ i++; setProgress(Math.min(i,stages.length-1)); if(i>=stages.length-1) clearInterval(tick); },1200);
    callAnalyse(croppedUrl, profile)
      .then(data=>{ clearInterval(tick); setProgress(stages.length); setResult(data); setPhase("done"); })
      .catch(e=>{ clearInterval(tick); setErrMsg(e.message||"Unknown error"); setPhase("error"); });
    return ()=>clearInterval(tick);
  },[]);

  if(phase==="error") return (
    <div style={{ textAlign:"center" }}>
      <div style={{ fontSize:36, marginBottom:10 }}>😵</div>
      <h2 style={{ margin:"0 0 8px", fontSize:18, fontWeight:700, color:C.red }}>Analysis failed</h2>
      <div style={{ background:C.redL, border:`1px solid ${C.red}`, borderRadius:10,
        padding:"12px 14px", marginBottom:16, fontSize:13, color:C.red, textAlign:"left" }}>
        <strong>Error:</strong> {errMsg}
      </div>
      <button onClick={onReset} style={{ ...btn("outline"), width:"100%" }}>Start over</button>
    </div>
  );

  if(phase==="loading") return (
    <div>
      <div style={{ textAlign:"center", marginBottom:16 }}>
        <h2 style={{ margin:"0 0 4px", fontSize:18, fontWeight:700, color:C.green }}>Analysing label…</h2>
        <p style={{ margin:0, fontSize:12, color:C.slateL }}>
          Running extraction + AI analysis (2 calls)
        </p>
      </div>
      <div style={{ display:"flex", justifyContent:"center", marginBottom:14 }}>
        <img src={croppedUrl} alt="crop" style={{ width:100, height:70, objectFit:"cover",
          borderRadius:8, border:`2px solid ${C.border}` }} />
      </div>
      <div style={{ background:C.bg, borderRadius:12, padding:"12px 14px", border:`1px solid ${C.border}` }}>
        {stages.map((s,i)=>(
          <div key={i} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:i<stages.length-1?8:0 }}>
            <div style={{ width:18, height:18, borderRadius:"50%", flexShrink:0,
              background:i<progress?C.lime:i===progress?C.green:C.border,
              display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, color:"#fff" }}>
              {i<progress?"✓":i===progress?"…":""}
            </div>
            <span style={{ fontSize:12, color:i<progress?C.green:i===progress?C.slate:C.border,
              fontWeight:i===progress?600:400 }}>{s}</span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ textAlign:"center", marginBottom:14 }}>
        <h2 style={{ margin:"0 0 4px", fontSize:18, fontWeight:700, color:C.green }}>
          Analysis complete ✅
        </h2>
        <p style={{ margin:0, fontSize:11, color:C.slateL }}>
          Compare ⚙️ Rule Score vs 🧠 AI Analysis below
        </p>
      </div>
      <ResultsCard result={result} labelType={labelType}
        onReset={onReset} onLogFood={()=>onLogFood(result)} />
    </div>
  );
}

function ScannerScreen({ profile, onLogFood }) {
  const [step,setStep]=useState(0);
  const [imageUrl,setImageUrl]=useState(null);
  const [croppedUrl,setCroppedUrl]=useState(null);
  const [labelType,setLabelType]=useState("");
  const reset=()=>{ setStep(0); setImageUrl(null); setCroppedUrl(null); setLabelType(""); };
  return (
    <div>
      <StepBar step={step} />
      {step===0&&<UploadStep onImage={url=>{ setImageUrl(url); setStep(1); }} />}
      {step===1&&imageUrl&&<CropStep imageUrl={imageUrl}
        onCrop={(url)=>{ setCroppedUrl(url); setStep(2); }} onBack={()=>setStep(0)} />}
      {step===2&&croppedUrl&&<PreviewStep croppedUrl={croppedUrl} originalUrl={imageUrl}
        onConfirm={type=>{ setLabelType(type); setStep(3); }} onRecrop={()=>setStep(1)} />}
      {step===3&&croppedUrl&&<AnalyseStep croppedUrl={croppedUrl} labelType={labelType}
        profile={profile} onReset={reset} onLogFood={result=>{ onLogFood(result); reset(); }} />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// LOG FOOD MODAL
// ══════════════════════════════════════════════════════════════════════════════
function LogFoodModal({ result, onLog, onClose }) {
  const [serving,setServing]=useState(result.servingInfo?.servingSize?.value||100);
  const [meal,setMeal]=useState("snack");
  const n=result.nutritionPer100g||{};
  const calc=key=>{ const v=n[key]?.value; return v!=null?((Number(v)*Number(serving))/100).toFixed(1):"—"; };
  const meals=[["breakfast","🌅 Breakfast"],["lunch","☀️ Lunch"],["dinner","🌙 Dinner"],["snack","🍎 Snack"]];
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:100,
      display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div style={{ background:C.surface, borderRadius:"20px 20px 0 0", padding:"20px 20px 36px",
        width:"100%", maxWidth:440, boxSizing:"border-box" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
          <h3 style={{ margin:0, fontSize:17, fontWeight:700, color:C.green }}>Log this food</h3>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:20,
            cursor:"pointer", color:C.slateL }}>✕</button>
        </div>
        {result.productName&&<p style={{ margin:"0 0 12px", fontSize:13, fontWeight:600, color:C.slate }}>{result.productName}</p>}
        <div style={{ marginBottom:14 }}>
          <label style={{ fontSize:12, fontWeight:600, color:C.green, display:"block", marginBottom:6 }}>
            Serving size ({result.servingInfo?.servingSize?.unit||"g"})
          </label>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <input type="number" value={serving} onChange={e=>setServing(e.target.value)} min="1"
              style={{ flex:1, padding:"10px 12px", borderRadius:8, border:`1.5px solid ${C.border}`,
                fontSize:15, fontWeight:700, outline:"none", fontFamily:"inherit" }} />
            <div style={{ display:"flex", gap:4 }}>
              {[50,100,150].map(v=>(
                <button key={v} onClick={()=>setServing(v)}
                  style={{ padding:"10px 10px", borderRadius:8, fontSize:12, fontWeight:600,
                    cursor:"pointer", border:`1.5px solid ${Number(serving)===v?C.lime:C.border}`,
                    background:Number(serving)===v?C.mint:"transparent",
                    color:Number(serving)===v?C.green:C.slateL }}>{v}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ background:C.bg, borderRadius:10, padding:"10px 12px", marginBottom:14 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
            {[["🔥",calc("calories"),"kcal"],["💪",calc("protein"),"g prot"],
              ["🌾",calc("totalCarbs"),"g carbs"],["🫙",calc("totalFat"),"g fat"],
              ["🍬",calc("sugars"),"g sugar"],["🌿",calc("dietaryFibre"),"g fibre"]].map(([icon,val,unit])=>(
              <div key={unit} style={{ textAlign:"center" }}>
                <div style={{ fontSize:10, color:C.slateL }}>{icon} {unit}</div>
                <div style={{ fontSize:15, fontWeight:700, color:C.green }}>{val}</div>
              </div>
            ))}
          </div>
        </div>
        <p style={{ fontSize:12, fontWeight:600, color:C.green, marginBottom:8 }}>Meal</p>
        <div style={{ display:"flex", gap:6, marginBottom:16 }}>
          {meals.map(([id,label])=>(
            <button key={id} onClick={()=>setMeal(id)}
              style={{ flex:1, padding:"8px 4px", borderRadius:8, fontSize:10, fontWeight:600,
                cursor:"pointer", border:`1.5px solid ${meal===id?C.lime:C.border}`,
                background:meal===id?C.mint:"transparent", color:meal===id?C.green:C.slateL }}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={()=>onLog({result,serving:Number(serving),meal,date:today()})}
          style={{ ...btn("primary"), width:"100%" }}>Add to Diary ✓</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TRACKER SCREEN
// ══════════════════════════════════════════════════════════════════════════════
function TrackerScreen({ log, profile, onDeleteEntry }) {
  const targets=calcTargets(profile);
  const [viewDate,setViewDate]=useState(today());
  const viewLog=log.filter(e=>e.date===viewDate);
  const isToday=viewDate===today();
  const totals=entries=>entries.reduce((acc,e)=>{
    const n=e.result.nutritionPer100g||{};
    const g=key=>n[key]?.value!=null?(Number(n[key].value)*e.serving/100):0;
    return { calories:acc.calories+g("calories"), protein:acc.protein+g("protein"),
      carbs:acc.carbs+g("totalCarbs"), fat:acc.fat+g("totalFat"),
      fibre:acc.fibre+g("dietaryFibre"), sugar:acc.sugar+g("sugars") };
  },{calories:0,protein:0,carbs:0,fat:0,fibre:0,sugar:0});
  const T=totals(viewLog);
  const dates=[...new Set(log.map(e=>e.date))].sort().reverse();
  const mealSlots=[["breakfast","🌅 Breakfast"],["lunch","☀️ Lunch"],["dinner","🌙 Dinner"],["snack","🍎 Snack"]];

  return (
    <div>
      <div style={{ textAlign:"center", marginBottom:16 }}>
        <h2 style={{ margin:"0 0 2px", fontSize:20, fontWeight:700, color:C.green }}>Daily Diary</h2>
        <p style={{ margin:0, fontSize:12, color:C.slateL }}>Track your nutrition intake</p>
      </div>
      <Card style={{ marginBottom:12 }}>
        <div style={{ display:"flex", alignItems:"center", gap:16 }}>
          <div style={{ position:"relative", width:80, height:80, flexShrink:0 }}>
            <svg width="80" height="80" style={{ transform:"rotate(-90deg)" }}>
              <circle cx="40" cy="40" r="32" fill="none" stroke={C.border} strokeWidth="8"/>
              <circle cx="40" cy="40" r="32" fill="none"
                stroke={T.calories>targets.calories?C.red:C.lime} strokeWidth="8"
                strokeDasharray={`${Math.min(100,T.calories/targets.calories*100)*2.01} 201`}
                strokeLinecap="round"/>
            </svg>
            <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column",
              alignItems:"center", justifyContent:"center" }}>
              <div style={{ fontSize:14, fontWeight:800, color:C.green }}>{Math.round(T.calories)}</div>
              <div style={{ fontSize:8, color:C.slateL }}>kcal</div>
            </div>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:12, color:C.slateL, marginBottom:6 }}>
              {isToday?"Today":fmtDate(viewDate)} · {viewLog.length} item{viewLog.length!==1?"s":""}
            </div>
            <MacroBar label="Protein" current={T.protein} target={targets.protein} color={C.blue} />
            <MacroBar label="Carbs"   current={T.carbs}   target={targets.carbs}   color={C.amber} />
            <MacroBar label="Fat"     current={T.fat}     target={targets.fat}     color={C.purple} />
            <MacroBar label="Fibre"   current={T.fibre}   target={targets.fibre}   color={C.lime} />
          </div>
        </div>
      </Card>

      {dates.length>1&&(
        <div style={{ display:"flex", gap:6, overflowX:"auto", paddingBottom:4, marginBottom:12 }}>
          {dates.map(d=>(
            <button key={d} onClick={()=>setViewDate(d)}
              style={{ flexShrink:0, padding:"5px 12px", borderRadius:20, fontSize:11, fontWeight:600,
                cursor:"pointer", border:`1.5px solid ${viewDate===d?C.lime:C.border}`,
                background:viewDate===d?C.mint:"transparent", color:viewDate===d?C.green:C.slateL }}>
              {d===today()?"Today":fmtDate(d)}
            </button>
          ))}
        </div>
      )}

      {viewLog.length===0?(
        <div style={{ textAlign:"center", padding:"32px 16px", color:C.slateL }}>
          <div style={{ fontSize:32, marginBottom:8 }}>📋</div>
          <p style={{ margin:0, fontSize:13 }}>
            No foods logged {isToday?"today":"for this date"}.<br/>
            Use the Scanner tab to add items.
          </p>
        </div>
      ):(
        mealSlots.map(([mealId,mealLabel])=>{
          const entries=viewLog.filter(e=>e.meal===mealId);
          if(!entries.length) return null;
          const mT=totals(entries);
          return (
            <div key={mealId} style={{ marginBottom:14 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                <span style={{ fontSize:13, fontWeight:700, color:C.green }}>{mealLabel}</span>
                <span style={{ fontSize:11, color:C.slateL }}>{Math.round(mT.calories)} kcal</span>
              </div>
              {entries.map((e,i)=>{
                const n=e.result.nutritionPer100g||{};
                const g=key=>n[key]?.value!=null?(Number(n[key].value)*e.serving/100).toFixed(1):"—";
                const sc=scoreNutrition(n,e.result.additiveCount||0);
                return (
                  <div key={i} style={{ background:C.surface, border:`1px solid ${C.border}`,
                    borderRadius:10, padding:"10px 12px", marginBottom:6,
                    display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ width:32, height:32, borderRadius:8, background:sc.gradeColor,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      fontSize:14, fontWeight:900, color:"#fff", flexShrink:0 }}>{sc.grade}</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:600, color:C.green,
                        whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                        {e.result.productName||"Scanned food"}
                      </div>
                      <div style={{ fontSize:11, color:C.slateL }}>
                        {e.serving}{e.result.servingInfo?.servingSize?.unit||"g"} · {g("calories")} kcal · P {g("protein")}g · C {g("totalCarbs")}g
                      </div>
                    </div>
                    <button onClick={()=>onDeleteEntry(e.id)}
                      style={{ background:"none", border:"none", cursor:"pointer",
                        fontSize:16, color:C.slateL }}>🗑</button>
                  </div>
                );
              })}
            </div>
          );
        })
      )}

      {viewLog.length>0&&(
        <Card style={{ background:C.mint }}>
          <SectionTitle>SUMMARY</SectionTitle>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
            {[["🍬","Sugar",T.sugar.toFixed(1),"g",25],
              ["🌿","Fibre",T.fibre.toFixed(1),"g",targets.fibre]].map(([icon,name,val,unit,lim])=>(
              <div key={name} style={{ background:C.surface, borderRadius:8, padding:"8px 10px", textAlign:"center" }}>
                <div style={{ fontSize:10, color:C.slateL }}>{icon} {name}</div>
                <div style={{ fontSize:15, fontWeight:800, color:Number(val)>lim?C.red:C.green }}>{val}</div>
                <div style={{ fontSize:9, color:C.slateL }}>/{lim}{unit}</div>
              </div>
            ))}
            <div style={{ background:C.surface, borderRadius:8, padding:"8px 10px", textAlign:"center" }}>
              <div style={{ fontSize:10, color:C.slateL }}>🔥 Remain</div>
              <div style={{ fontSize:15, fontWeight:800,
                color:T.calories>targets.calories?C.red:C.green }}>
                {Math.max(0,targets.calories-Math.round(T.calories))}
              </div>
              <div style={{ fontSize:9, color:C.slateL }}>kcal left</div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ROOT APP
// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [profile, setProfile] = useState(()=>lsGet("fl_profile"));
  const [log,     setLog]     = useState(()=>lsGet("fl_log")||[]);
  const [tab,     setTab]     = useState("scan");
  const [logModal,setLogModal]= useState(null);

  const saveProfile = p => { setProfile(p); lsSet("fl_profile",p); setTab("scan"); };
  const addLogEntry = ({ result, serving, meal, date }) => {
    const entry={ id:Date.now().toString(), result, serving, meal, date };
    const newLog=[entry,...log]; setLog(newLog); lsSet("fl_log",newLog);
    setLogModal(null); setTab("tracker");
  };
  const deleteEntry = id => {
    const newLog=log.filter(e=>e.id!==id); setLog(newLog); lsSet("fl_log",newLog);
  };

  const navItems=[
    {id:"scan",    icon:"🔬", label:"Scanner"},
    {id:"tracker", icon:"📋", label:"Diary"},
    {id:"profile", icon:"👤", label:"Profile"},
  ];

  return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column",
      fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,sans-serif" }}>

      {/* Header */}
      <div style={{ background:C.green, padding:"14px 16px 12px", display:"flex",
        alignItems:"center", gap:10, position:"sticky", top:0, zIndex:10 }}>
        <div style={{ width:30, height:30, borderRadius:8, background:C.lime,
          display:"flex", alignItems:"center", justifyContent:"center" }}>
          <span style={{ fontSize:16 }}>🍃</span>
        </div>
        <div>
          <div style={{ fontSize:16, fontWeight:800, color:"#fff", letterSpacing:-0.3 }}>FoodLens</div>
          <div style={{ fontSize:9, color:"rgba(255,255,255,0.5)", letterSpacing:1 }}>NUTRITION SCANNER</div>
        </div>
        {profile?.name&&(
          <div style={{ marginLeft:"auto", fontSize:12, color:"rgba(255,255,255,0.6)" }}>
            👋 {profile.name}
          </div>
        )}
      </div>

      {/* Main content */}
      <div style={{ flex:1, overflowY:"auto", padding:"16px 16px 80px" }}>
        {tab==="profile"?(
          <div style={{ background:C.surface, borderRadius:16, padding:"16px",
            boxShadow:`0 2px 20px ${C.shadow}` }}>
            <ProfileScreen profile={profile} onSave={saveProfile} />
          </div>
        ):tab==="tracker"?(
          <TrackerScreen log={log} profile={profile} onDeleteEntry={deleteEntry} />
        ):(
          <div style={{ background:C.surface, borderRadius:16, padding:"16px",
            boxShadow:`0 2px 20px ${C.shadow}` }}>
            <ScannerScreen profile={profile} onLogFood={result=>setLogModal(result)} />
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div style={{ position:"fixed", bottom:0, left:0, right:0, background:C.surface,
        borderTop:`1px solid ${C.border}`, display:"flex",
        boxShadow:"0 -4px 20px rgba(0,0,0,0.06)", zIndex:10 }}>
        {navItems.map(({id,icon,label})=>(
          <button key={id} onClick={()=>setTab(id)} style={{ flex:1, padding:"10px 0 8px",
            border:"none", cursor:"pointer", background:"transparent", fontFamily:"inherit",
            display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
            <span style={{ fontSize:20, filter:tab===id?"none":"grayscale(0.5) opacity(0.6)" }}>{icon}</span>
            <span style={{ fontSize:10, fontWeight:700, color:tab===id?C.lime:C.slateL }}>{label}</span>
            {tab===id&&<div style={{ width:18, height:2, background:C.lime, borderRadius:2 }} />}
          </button>
        ))}
      </div>

      {logModal&&<LogFoodModal result={logModal} onLog={addLogEntry} onClose={()=>setLogModal(null)} />}

      <style>{`
        *{-webkit-tap-highlight-color:transparent;}
        input:focus{border-color:${C.lime}!important;box-shadow:0 0 0 3px ${C.mint};}
      `}</style>
    </div>
  );
}
