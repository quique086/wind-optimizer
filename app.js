"use strict";
/* ============================== constants ============================== */
const APT={SCEL:[-33.393,-70.786],SCIE:[-36.7727,-73.0631],SCFA:[-23.4445,-70.4451],SCDA:[-20.5352,-70.1813],SCAR:[-18.3485,-70.3387],SCCF:[-22.4982,-68.9036],SCSE:[-29.9162,-71.1995],SCAT:[-27.2612,-70.7792],SCTE:[-41.4389,-73.094],SCCI:[-53.0026,-70.8546],SCQP:[-38.9259,-72.6515],SCVD:[-39.65,-73.0861],SCJO:[-40.6112,-73.061],SCBA:[-45.9161,-71.6895],SCNT:[-51.6715,-72.5284],SCIP:[-27.1648,-109.4219],SCCH:[-36.5825,-72.0314],SCPQ:[-42.3,-73.7158],
SAEZ:[-34.8222,-58.5358],SABE:[-34.5592,-58.4156],SAME:[-32.8317,-68.7929],SACO:[-31.3236,-64.208],SAAR:[-32.9036,-60.785],SAZS:[-41.1512,-71.1575],SAWH:[-54.8433,-68.2958],SANT:[-26.8409,-65.1049],SASA:[-24.856,-65.4862],SAZN:[-38.949,-68.1557],
SPJC:[-12.0219,-77.1143],SPZO:[-13.5357,-71.9388],SPQU:[-16.3411,-71.583],SPTN:[-18.0533,-70.2758],
SBGR:[-23.4356,-46.4731],SBGL:[-22.81,-43.2506],SBFL:[-27.6703,-48.5525],SBPA:[-29.9944,-51.1714],SBFI:[-25.6003,-54.4872],
SUMU:[-34.8384,-56.0308],SGAS:[-25.24,-57.5191],SLLP:[-16.5133,-68.1923],SLVR:[-17.6448,-63.1354],SEQM:[-0.1292,-78.3575],SEGU:[-2.1574,-79.8837],SKBO:[4.7016,-74.1469],SKRG:[6.1645,-75.4231],SKCL:[3.5433,-76.3817],MPTO:[9.0714,-79.3835]};
const LEVELS=[850,700,500,400,350,300,250,200,150];
const MODELS=[["gfs_seamless","GFS"],["ecmwf_ifs025","ECMWF"]];
const META={GFS:"ncep_gfs025",ECMWF:"ecmwf_ifs025"};
/* generic type factors vs A320 CEO: climb dist/time, climb fuel, descent dist/time, descent fuel, typical FF, reference TOW (t) */
const AC={a320ceo:{cd:1,cf:1,dd:1,df:1,ff:2400,w:68},a320neo:{cd:1,cf:0.85,dd:1,df:0.9,ff:2100,w:70},
 a321ceo:{cd:1.15,cf:1.25,dd:1.05,df:1.1,ff:2750,w:82},a321neo:{cd:1.15,cf:1.06,dd:1.05,df:1,ff:2400,w:85}};
/* generic A320 CEO climb from brake release (mid weight, ISA, still air): FL, NM, min, kg */
const CLB=[[50,10,3,350],[100,18,5,500],[200,45,11,850],[250,65,14,1000],[290,85,17,1150],[330,110,21,1350],[350,125,23,1450],[370,145,26,1600],[390,175,31,1800],[410,210,37,2050]];
const $=id=>document.getElementById(id);
const D2R=Math.PI/180,R2D=180/Math.PI,REARTH=3440.065;
$("aptlist").textContent=Object.keys(APT).join(" ");
function store(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
function load(k){try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}}

/* ============================== geometry ============================== */
function dist(a,b){const[f1,l1]=[a[0]*D2R,a[1]*D2R],[f2,l2]=[b[0]*D2R,b[1]*D2R];
 const h=Math.sin((f2-f1)/2)**2+Math.cos(f1)*Math.cos(f2)*Math.sin((l2-l1)/2)**2;return 2*REARTH*Math.asin(Math.min(1,Math.sqrt(h)))}
function brg(a,b){const[f1,l1]=[a[0]*D2R,a[1]*D2R],[f2,l2]=[b[0]*D2R,b[1]*D2R];
 const y=Math.sin(l2-l1)*Math.cos(f2),x=Math.cos(f1)*Math.sin(f2)-Math.sin(f1)*Math.cos(f2)*Math.cos(l2-l1);return(Math.atan2(y,x)*R2D+360)%360}
function gcInterp(a,b,t){const[f1,l1]=[a[0]*D2R,a[1]*D2R],[f2,l2]=[b[0]*D2R,b[1]*D2R];const d=dist(a,b)/REARTH;if(d<1e-9)return a.slice();
 const A=Math.sin((1-t)*d)/Math.sin(d),B=Math.sin(t*d)/Math.sin(d);
 const x=A*Math.cos(f1)*Math.cos(l1)+B*Math.cos(f2)*Math.cos(l2),y=A*Math.cos(f1)*Math.sin(l1)+B*Math.cos(f2)*Math.sin(l2),z=A*Math.sin(f1)+B*Math.sin(f2);
 return[Math.atan2(z,Math.hypot(x,y))*R2D,Math.atan2(y,x)*R2D]}

/* ============================== route ============================== */
function parseCoord(s){let m;
 if(m=s.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/))return[+m[1],+m[2]];
 if(m=s.match(/^([NS])(\d{2})(\d{2}(?:\.\d+)?)?([EW])(\d{3})(\d{2}(?:\.\d+)?)?$/))return[(+m[2]+(m[3]?+m[3]/60:0))*(m[1]=="S"?-1:1),(+m[5]+(m[6]?+m[6]/60:0))*(m[4]=="W"?-1:1)];
 if(m=s.match(/^(\d{2})(\d{2}(?:\.\d+)?)?([NS])\/?(\d{3})(\d{2}(?:\.\d+)?)?([EW])$/))return[(+m[1]+(m[2]?+m[2]/60:0))*(m[3]=="S"?-1:1),(+m[4]+(m[5]?+m[5]/60:0))*(m[6]=="W"?-1:1)];
 return null}
function fmtLL(c){const la=Math.abs(c[0]),lo=Math.abs(c[1]);return(c[0]<0?"S":"N")+String(Math.floor(la)).padStart(2,"0")+((la%1)*60).toFixed(0).padStart(2,"0")+(c[1]<0?"W":"E")+String(Math.floor(lo)).padStart(3,"0")+((lo%1)*60).toFixed(0).padStart(2,"0")}
function parseRoute(txt){const toks=txt.toUpperCase().trim().split(/\s+/).filter(Boolean);const pts=[],bad=[];
 toks.forEach((t,i)=>{let name=t,c=null,apt=false;
  if(t.includes("/")&&/^[A-Z0-9_]{2,8}\//.test(t)&&!parseCoord(t)){const k=t.indexOf("/");name=t.slice(0,k);c=parseCoord(t.slice(k+1));apt=!!APT[name]&&(i==0||i==toks.length-1)}
  else if(APT[t]){c=APT[t];apt=true}else{c=parseCoord(t);if(c)name=t.length>10?fmtLL(c):t}
  if(c&&Math.abs(c[0])<=90&&Math.abs(c[1])<=180)pts.push({name,lat:c[0],lon:c[1],apt});else bad.push(t)});
 return{pts,bad}}
function sampleRoute(pts,step){const out=[];let cum=0;
 for(let i=0;i<pts.length-1;i++){const a=[pts[i].lat,pts[i].lon],b=[pts[i+1].lat,pts[i+1].lon],d=dist(a,b),n=Math.max(1,Math.ceil(d/step));
  for(let k=0;k<n;k++){const t=k/n,p=gcInterp(a,b,t),nx=gcInterp(a,b,Math.min(1,t+0.5/n));
   out.push({lat:p[0],lon:p[1],cum:cum+d*t,trk:brg(p,nx),name:k==0?pts[i].name:null,user:k==0,apt:k==0&&pts[i].apt})}
  cum+=d}
 const L=pts[pts.length-1],P=pts[pts.length-2];
 out.push({lat:L.lat,lon:L.lon,cum,trk:brg([P.lat,P.lon],[L.lat,L.lon]),name:L.name,user:true,apt:L.apt});
 for(let i=0;i<out.length;i++){const a=i>0?(out[i].cum-out[i-1].cum)/2:0,b=i<out.length-1?(out[i+1].cum-out[i].cum)/2:0;out[i].seg=a+b;out[i].a0=out[i].cum-a;out[i].a1=out[i].cum+b}
 return{samples:out,total:cum}}

/* ============================== atmosphere ============================== */
function hpaToFt(p){return p>=226.32?(1-Math.pow(p/1013.25,0.190263))*145366.45:36089.24+20805.8*Math.log(226.3206/p)}
function deltaOf(ft){return ft<=36089?Math.pow(1-ft/145366.45,5.25588):0.22336*Math.exp(-(ft-36089)/20805.8)}
function ftOfDelta(d){return d>=0.22336?145366.45*(1-Math.pow(d,1/5.25588)):36089+20805.8*Math.log(0.22336/d)}
function isaT(ft){return ft<=36089?15-1.98*ft/1000:-56.5}
const LV_FT=LEVELS.map(hpaToFt);
/* OPT / REC MAX follow constant W/delta */
function flAtWeight(fl0,w,c){return ftOfDelta(deltaOf(fl0*100)*w/(c.tow*1000))/100}

/* ============================== forecast ============================== */
function isoH(d){return d.toISOString().slice(0,13)+":00"}
function buildUrl(samples,dep,total){const v=[];for(const L of LEVELS)v.push("wind_speed_"+L+"hPa","wind_direction_"+L+"hPa","temperature_"+L+"hPa");
 const h1=new Date(dep.getTime()-3600e3),h2=new Date(dep.getTime()+(total/400+2)*3600e3);
 return"https://api.open-meteo.com/v1/forecast?latitude="+samples.map(s=>s.lat.toFixed(3)).join(",")+"&longitude="+samples.map(s=>s.lon.toFixed(3)).join(",")+
 "&hourly="+v.join(",")+"&wind_speed_unit=kn&models="+MODELS.map(m=>m[0]).join(",")+"&timezone=GMT&start_hour="+isoH(h1)+"&end_hour="+isoH(h2)}
function attachWx(samples,json,dep){const arr=Array.isArray(json)?json:[json];
 if(arr.length!==samples.length)throw new Error("Data has "+arr.length+" points, route has "+samples.length+". Use the same route that made the link.");
 let maxDt=0;const have={};
 samples.forEach((s,i)=>{const h=arr[i].hourly;if(!h||!h.time)throw new Error("Unexpected data format");
  const eta=dep.getTime()+s.cum/440*3600e3;let bi=0,bd=1e18;
  h.time.forEach((t,j)=>{const dt=Math.abs(Date.parse(t+(t.length<=16?":00Z":""))-eta);if(dt<bd){bd=dt;bi=j}});maxDt=Math.max(maxDt,bd);
  s.pm={};const suffixed=Object.keys(h).some(x=>MODELS.some(m=>x.endsWith("_"+m[0])));
  for(const[mid,mname]of MODELS){const p=[];
   LEVELS.forEach((L,k)=>{const g=n=>suffixed?h[n+"_"+mid]:(mname=="GFS"?h[n]:null);
    const sp=g("wind_speed_"+L+"hPa"),dr=g("wind_direction_"+L+"hPa"),tp=g("temperature_"+L+"hPa");
    if(sp&&dr&&tp&&sp[bi]!=null&&dr[bi]!=null&&tp[bi]!=null){const th=dr[bi]*D2R;p.push({ft:LV_FT[k],u:-sp[bi]*Math.sin(th),v:-sp[bi]*Math.cos(th),T:tp[bi]})}});
   if(p.length>=2){s.pm[mname]=p;have[mname]=1}}
  const ks=Object.keys(s.pm);if(!ks.length)throw new Error("No wind levels in the data at point "+(i+1));
  const avg=[];LEVELS.forEach((L,k)=>{const xs=ks.map(m=>s.pm[m].find(q=>q.ft==LV_FT[k])).filter(Boolean);
   if(xs.length)avg.push({ft:LV_FT[k],u:xs.reduce((a,q)=>a+q.u,0)/xs.length,v:xs.reduce((a,q)=>a+q.v,0)/xs.length,T:xs.reduce((a,q)=>a+q.T,0)/xs.length})});
  s.pm.AVG=avg});
 return{age:maxDt/3600e3,models:Object.keys(have)}}
function useModel(S,m){for(const s of S)s.prof=s.pm[m]||s.pm.AVG}
function interpProf(prof,ft){if(ft<=prof[0].ft)return prof[0];const n=prof.length;if(ft>=prof[n-1].ft)return prof[n-1];
 for(let i=0;i<n-1;i++){const a=prof[i],b=prof[i+1];if(ft<=b.ft){const t=(ft-a.ft)/(b.ft-a.ft);return{u:a.u+t*(b.u-a.u),v:a.v+t*(b.v-a.v),T:a.T+t*(b.T-a.T)}}}}
function fmsProf(prof,lvls){return lvls.map(fl=>{const w=interpProf(prof,fl*100);return{ft:fl*100,u:w.u,v:w.v,T:w.T}})}
function along(w,trk){const t=trk*D2R;return w.u*Math.sin(t)+w.v*Math.cos(t)}

/* ============================== performance model ============================== */
function penaltyFn(p2,p4){const a=(p4-2*p2)/8/100,b=(p2/100-4*a)/2;return dk=>{const d=Math.abs(dk);return Math.max(0,a*d*d+b*d)}}
function acOf(c){return AC[c.ac]||AC.a320ceo}
function climbOf(fl,c){const k=(c.clf||100)/100,A=acOf(c),wk=Math.min(1.25,Math.max(0.85,c.tow/A.w));let i=0;while(i<CLB.length-2&&fl>CLB[i+1][0])i++;
 const a=CLB[i],b=CLB[i+1],t=(fl-a[0])/(b[0]-a[0]),L=j=>a[j]+t*(b[j]-a[j]);return{d:L(1)*k*A.cd*wk,t:L(2)*k*A.cd*wk/60,f:L(3)*k*A.cf*wk}}
function descOf(fl,c){const k=fl/10,A=acOf(c);return{d:(3.2*k+10)*A.dd,t:(0.45*k+6)*A.dd/60,f:(150+5*k)*A.df}}
/* mean along-track wind over a window of the route and a band of altitudes (climb / descent) */
function windBand(S,s0,s1,ft0,ft1,src){let t=0,n=0;for(const s of S){if(s.cum<s0-1||s.cum>s1+1)continue;const p=src(s);
  for(let h=ft0;h<=ft1;h+=2000){t+=along(interpProf(p,h),s.trk);n++}}return n?t/n:0}
/* simulate a trip. path.L0 = first cruise level, path.at(s) = level at route distance s */
function sim(S,c,path,opt={}){const src=opt.src||(s=>s.prof),pen=penaltyFn(c.p2,c.p4),TASstd=c.mach*573.57,cal=opt.cal??c.cal;
 const L0=path.L0,cl=climbOf(L0,c),Lend=path.at(c.total-1),de=descOf(Lend,c);
 const wc=windBand(S,0,cl.d,3000,L0*100,src),wd=windBand(S,c.total-de.d,c.total,3000,Lend*100,src);
 const lo=cl.d+wc*cl.t,hi=c.total-(de.d+wd*de.t);if(hi-lo<15)return{fl:L0,bad:true,why:"short"};
 let w=c.tow*1000-cl.f*cal,time=0,fuel=0,dsum=0,tw=0,isa=0,tasS=0,prev=null,steps=0,over=false;const chk={},wts=[];
 const wmid=c.tow*1000-0.5*c.ff*(c.total/450);
 for(const s of S){const d=Math.max(0,Math.min(s.a1,hi)-Math.max(s.a0,lo));
  if(d>0){const fl=path.at(s.cum);
   if(prev!==null&&fl!==prev){if(fl>prev){const sf=c.stepc*(fl-prev)/10*cal;fuel+=sf;w-=sf}steps++}prev=fl;
   if(fl>flAtWeight(c.recmax,w,c)+0.5)over=true;
   const W=interpProf(src(s),fl*100),t=s.trk*D2R,al=W.u*Math.sin(t)+W.v*Math.cos(t),cr=W.u*Math.cos(t)-W.v*Math.sin(t);
   const tas=c.mach*38.967854*Math.sqrt(W.T+273.15),gs=Math.sqrt(Math.max(tas*tas-cr*cr,1))+al,hrs=d/Math.max(gs,150);
   const ff=c.ff*cal*(w/wmid),f=ff*(1+pen((fl-flAtWeight(c.opt,w,c))/10))*(tas/TASstd)*hrs;
   time+=hrs;fuel+=f;w-=f;dsum+=d;tw+=al*d;isa+=(W.T-isaT(fl*100))*d;tasS+=tas*d}
  wts.push({cum:s.cum,w});
  if(s.user&&s.name)chk[s.name]=s.cum<lo?cl.f*cal*Math.sqrt(Math.max(0,s.cum)/lo):cl.f*cal+fuel+(s.cum>hi?de.f*cal*(s.cum-hi)/Math.max(1,c.total-hi):0)}
 if(!dsum)return{fl:L0,bad:true,why:"short"};
 const xf=(cl.f+de.f)*cal,xt=cl.t+de.t,T=time+xt,F=fuel+xf;
 return{fl:L0,fuel:F,time:T,cost:F+c.ci*T*60,cfuel:fuel,ctime:time,cgs:dsum/time,cdist:dsum,xf,tw:tw/dsum,isa:isa/dsum,tas:tasS/dsum,lo,hi,over,steps,chk,wts,wc,wd,cl,de}}
const constPath=L=>({L0:L,at:()=>L});
/* path from "340 360/ASEPU" style text, using route waypoint distances */
function pathFromSpec(spec,S){const toks=spec.toUpperCase().trim().split(/\s+/).filter(Boolean);if(!toks.length)return null;
 const L0=parseInt(toks[0].replace(/^FL/,""));if(!(L0>=100))return null;const ch=[];
 for(const t of toks.slice(1)){const[fl,fx]=t.replace(/^FL/,"").split("/");const s=S.find(q=>q.name==fx);if(!s||!(+fl>=100))return{err:t};ch.push({at:s.cum,fl:+fl})}
 ch.sort((a,b)=>a.at-b.at);return{L0,at:x=>{let f=L0;for(const q of ch)if(x>=q.at)f=q.fl;return f}}}
/* OFP planned profile -> cruise level changes at fixes (T/C, steady levels, T/D) */
function ofpChanges(levels){const out=[];let cur=null,lastFix=null;
 levels.forEach((it,i)=>{const pseudo=/^T_O_|^B_O_/.test(it.name);
  if(pseudo){if(/^T_O_[CD]/.test(it.name)&&it.fl!=cur){out.push({fix:lastFix,fl:Math.round(it.fl/10)*10});cur=it.fl}return}
  const nx=levels.slice(i+1).find(q=>!/^B_O_/.test(q.name));
  if(cur!==null&&nx&&nx.fl==it.fl&&it.fl>=200&&it.fl!=cur){out.push({fix:lastFix,fl:Math.round(it.fl/10)*10});cur=it.fl}
  lastFix=it.name});
 return out}
function pathFromOFP(levels,S){const ch=ofpChanges(levels||[]);if(!ch.length)return null;
 const pts=ch.map(q=>{const s=S.find(x=>x.name==q.fix);return{at:s?s.cum:0,fl:q.fl}});
 return{L0:pts[0].fl,at:x=>{let f=pts[0].fl;for(const q of pts)if(x>=q.at)f=q.fl;return f}}}

/* ============================== 4 wind levels ============================== */
function pickFmsLevels(cruise,band,wts,must){const cands=[];for(let f=200;f<=410;f+=10)cands.push(f);let best=null;
 const wsum=cruise.reduce((a,s)=>a+s.seg,0)||1;
 const errOf=lv=>{let mx=0,tot=0,ws=0;for(const fl of band){let e=0;for(const s of cruise){if(s.seg<=0)continue;
   const tr=interpProf(s.prof,fl*100),fp=s._c[lv.join()]||(s._c[lv.join()]=fmsProf(s.prof,lv)),fw=interpProf(fp,fl*100);e+=Math.hypot(tr.u-fw.u,tr.v-fw.v)*s.seg}
   e/=wsum;const w=wts[fl]??0.2;mx=Math.max(mx,w*e);tot+=w*e;ws+=w}return mx+0.25*tot/ws};
 cruise.forEach(s=>s._c={});
 for(let i=0;i<cands.length;i++)for(let j=i+1;j<cands.length;j++)for(let k=j+1;k<cands.length;k++)for(let l=k+1;l<cands.length;l++){
  const lv=[cands[i],cands[j],cands[k],cands[l]];if(lv[0]>must||lv[3]<must||lv[3]<band[band.length-1]-40||lv[0]>band[0]+40)continue;
  const e=errOf(lv);if(!best||e<best.e-1e-9)best={lv,e}}
 cruise.forEach(s=>{delete s._c});return best}
function profErr(cruise,band,lv){const wsum=cruise.reduce((a,s)=>a+s.seg,0)||1;let mx=0;
 for(const fl of band){let e=0;for(const s of cruise){if(s.seg<=0)continue;const tr=interpProf(s.prof,fl*100),fw=interpProf(fmsProf(s.prof,lv),fl*100);e+=Math.hypot(tr.u-fw.u,tr.v-fw.v)*s.seg}mx=Math.max(mx,e/wsum)}return mx}

/* ============================== step plan (dynamic programming) ============================== */
function stepPlan(S,c,base,levels){
 const fixes=S.filter(s=>s.user&&s.name&&!s.apt&&s.cum>base.lo+20&&s.cum<base.hi-20);
 let cuts=[base.lo,...fixes.map(s=>s.cum),base.hi],names=["T/C",...fixes.map(s=>s.name)];
 const segs=[];for(let i=0;i<cuts.length-1;i++)segs.push({a:cuts[i],b:cuts[i+1],name:names[i]});
 for(let i=0;i<segs.length;i++){if(segs[i].b-segs[i].a<120&&segs.length>1){const j=i<segs.length-1?i+1:i-1;const lo=Math.min(i,j),hi=Math.max(i,j);
   segs.splice(lo,2,{a:segs[lo].a,b:segs[hi].b,name:segs[lo].name});i=-1}}
 const wAt=x=>{let w=base.wts[0].w;for(const q of base.wts)if(q.cum<=x)w=q.w;return w};
 const pen=penaltyFn(c.p2,c.p4),TASstd=c.mach*573.57,wmid=c.tow*1000-0.5*c.ff*(c.total/450);
 const segCost=(sg,L)=>{let w=wAt(sg.a),F=0,T=0;if(L>flAtWeight(c.recmax,w,c)+0.5)return null;
  for(const s of S){const d=Math.max(0,Math.min(s.a1,sg.b)-Math.max(s.a0,sg.a));if(d<=0)continue;
   const W=interpProf(s.prof,L*100),t=s.trk*D2R,al=W.u*Math.sin(t)+W.v*Math.cos(t),cr=W.u*Math.cos(t)-W.v*Math.sin(t);
   const tas=c.mach*38.967854*Math.sqrt(W.T+273.15),gs=Math.sqrt(Math.max(tas*tas-cr*cr,1))+al,h=d/Math.max(gs,150);
   const f=c.ff*c.cal*(w/wmid)*(1+pen((L-flAtWeight(c.opt,w,c))/10))*(tas/TASstd)*h;F+=f;T+=h;w-=f}
  return F+c.ci*T*60};
 const n=segs.length,cost=segs.map(sg=>levels.map(L=>segCost(sg,L)));
 const ends=L=>{const cl=climbOf(L,c),de=descOf(L,c);return(cl.f+de.f)*c.cal+c.ci*(cl.t+de.t)*60};
 const dp=[],bk=[];
 /* a lower first level ends its climb earlier: charge the extra cruise it flies (same for a shorter descent at the end) */
 const len0=segs[0].b-segs[0].a,lenN=segs[n-1].b-segs[n-1].a,cb=climbOf(base.fl,c),db=descOf(base.fl,c);
 const climbC=(L,j)=>{const cl=climbOf(L,c);return cl.f*c.cal+c.ci*cl.t*60+(cb.d-cl.d)*cost[0][j]/len0};
 const descC=(L,j)=>{const de=descOf(L,c);return de.f*c.cal+c.ci*de.t*60+(db.d-de.d)*cost[n-1][j]/lenN};
 dp[0]=levels.map((L,j)=>cost[0][j]==null?Infinity:cost[0][j]+climbC(L,j));
 for(let k=1;k<n;k++){dp[k]=[];bk[k]=[];levels.forEach((L,j)=>{dp[k][j]=Infinity;if(cost[k][j]==null)return;
   levels.forEach((P,i)=>{if(dp[k-1][i]===Infinity)return;const tr=L>P?c.stepc*(L-P)/10*c.cal:(L<P?5:0);const v=dp[k-1][i]+tr+cost[k][j];if(v<dp[k][j]){dp[k][j]=v;bk[k][j]=i}})})}
 const fin=levels.map((L,j)=>cost[n-1][j]==null?Infinity:dp[n-1][j]+descC(L,j));
 let j=fin.indexOf(Math.min(...fin));if(!isFinite(fin[j]))return null;const pick=[];for(let k=n-1;k>=0;k--){pick[k]=levels[j];if(k>0)j=bk[k][j]}
 const bi=levels.indexOf(base.fl);let constC=null;
 if(bi>=0&&cost.every(r=>r[bi]!=null))constC=cost.reduce((a,r)=>a+r[bi],0)+ends(base.fl);
 const best=Math.min(...fin);
 return{segs,pick,saving:constC!=null?constC-best:null,levels}}

/* ============================== formatting ============================== */
function windStr(w){const s=Math.hypot(w.u,w.v);let d=(Math.atan2(-w.u,-w.v)*R2D+360)%360;d=Math.round(d)%360||360;return String(d).padStart(3,"0")+"/"+String(Math.round(s)).padStart(3,"0")}
function hm(h){const m=Math.round(h*60);return Math.floor(m/60)+":"+String(m%60).padStart(2,"0")}
function sgn(x,dp=0){const v=x.toFixed(dp);return +v==0?(0).toFixed(dp):(x>0?"+":"")+v}
function kgs(x){return(x>=0?"+":"−")+kg(Math.abs(x))}
function kg(x){return Math.round(x).toLocaleString("en-US")}
function vecAvg(S,s0,s1,ft){let u=0,v=0,n=0;for(const s of S){if(s.cum<s0-1||s.cum>s1+1)continue;const w=interpProf(s.prof,ft);u+=w.u;v+=w.v;n++}return n?{u:u/n,v:v/n}:null}

/* ============================== inputs ============================== */
const IDS=["actype","mode","route","dep","tow","mach","ci","opt","recmax","minfl","model","parity","ff","clf","magvar","p2","p4","stepc","minstep","mine","pf_tof","pf_ldf","pf_to","pf_ldg","pf_lv","pf_pts"];
function saveInputs(){const o={};IDS.forEach(i=>o[i]=$(i).value);o.autocal=$("autocal").checked;store("optfl.in",o)}
function calOf(ac){if(!$("autocal").checked)return 1;const h=(load("optfl.hist")||[]).filter(e=>e.ac==ac&&e.ratio>0.7&&e.ratio<1.3).slice(-10).map(e=>e.ratio).sort((a,b)=>a-b);
 if(!h.length)return 1;const m=h.length%2?h[(h.length-1)/2]:(h[h.length/2-1]+h[h.length/2])/2;return Math.min(1.15,Math.max(0.85,m))}
function cfg(){const g=id=>parseFloat($(id).value);const ac=$("actype").value;
 return{ac,mach:g("mach")||0.78,ci:g("ci")||0,tow:g("tow")||AC[ac].w,opt:g("opt"),recmax:g("recmax"),minfl:g("minfl"),ff:g("ff"),clf:g("clf")||100,p2:g("p2"),p4:g("p4"),
  stepc:isFinite(g("stepc"))?g("stepc"):25,minstep:isFinite(g("minstep"))?g("minstep"):40,parity:$("parity").value,mode:$("mode").value,magvar:g("magvar")||0,model:$("model").value,cal:calOf(ac),
  mine:$("mine").value.split(/[\s,]+/).map(Number).filter(x=>x>=100&&x<=450).slice(0,4)}}
function depDate(){const v=$("dep").value;return v?new Date(v+":00Z"):new Date()}

/* ============================== main flow ============================== */
let STATE=null;
function prepare(){const{pts,bad}=parseRoute($("route").value);
 if(bad.length)throw new Error("Unknown: "+bad.join(" ")+"\nUse coordinates (e.g. S3530.0W07130.0) or NAME/coords.");
 if(pts.length<2)throw new Error("Enter at least two points.");
 const{samples,total}=sampleRoute(pts,100);if(samples.length>90)throw new Error("Route too long for one request.");
 return{pts,samples,total,dep:depDate(),route:$("route").value}}
function setMsg(t,cls){$("m1").className="msg "+(cls||"");$("m1").textContent=t}
async function fetchMeta(){const out={};await Promise.all(Object.entries(META).map(async([k,id])=>{try{
  const ctl=new AbortController(),tm=setTimeout(()=>ctl.abort(),5000);const r=await fetch("https://api.open-meteo.com/data/"+id+"/static/meta.json",{signal:ctl.signal});clearTimeout(tm);
  if(r.ok){const j=await r.json();if(j.last_run_initialisation_time)out[k]=j.last_run_initialisation_time*1000}}catch(e){}}));return out}
async function go(){setMsg("Fetching GFS + ECMWF winds…");$("paste").style.display="none";
 let P;try{P=prepare()}catch(e){setMsg(e.message,"err");return}
 const url=buildUrl(P.samples,P.dep,P.total);saveInputs();
 try{const r=await fetch(url);if(!r.ok)throw new Error("HTTP "+r.status+" "+(await r.text()).slice(0,200));const j=await r.json();const runs=await fetchMeta();finish(P,j,{fetched:Date.now(),runs})}
 catch(e){STATE={P,json:null};$("dlink").href=url;$("paste").style.display="block";setMsg("Automatic download blocked ("+(e.message||e)+"). Use the two steps below.","warn")}}
function finish(P,json,meta){try{const info=attachWx(P.samples,json,P.dep);STATE={P,json,meta,info};
  store("optfl.data",{route:P.route,dep:P.dep.toISOString(),json,meta});
  setMsg("Winds loaded for "+P.samples.length+" points ("+info.models.join(" + ")+")"+(info.age>1.5?". Closest forecast hour is "+info.age.toFixed(1)+" h from ETA: check departure time":"")+".","ok");render(P)}
 catch(e){setMsg(e.message,"err");console.error(e)}}

function render(P){const c=cfg(),S=P.samples;c.total=P.total;useModel(S,c.model);
 const overall=brg([P.pts[0].lat,P.pts[0].lon],[P.pts[P.pts.length-1].lat,P.pts[P.pts.length-1].lon]);
 const magTrk=(overall-c.magvar+360)%360,par=c.parity=="auto"?(magTrk<180?"odd":"even"):c.parity;
 const all=[];for(let f=c.minfl;f<=c.recmax;f+=10)all.push(f);
 const isDir=f=>par=="all"||((f/10)%2==1)==(par=="odd");
 const res=all.map(f=>sim(S,c,constPath(f))).filter(r=>!r.bad);
 const shown=res.filter(r=>isDir(r.fl));
 if(!shown.length){$("out").innerHTML='<div class="card err">No level fits: route too short for these levels, or check Lowest FL / REC MAX.</div>';return}
 const key=r=>r.cost,bestF=shown.reduce((a,b)=>key(b)<key(a)?b:a),bestT=shown.reduce((a,b)=>b.time<a.time?b:a);
 let cruise=S.filter(s=>s.cum>=bestF.lo&&s.cum<=bestF.hi);if(!cruise.length)cruise=[S[Math.floor(S.length/2)]];
 const ref=res.find(r=>r.fl==c.opt)||res.reduce((a,b)=>Math.abs(b.fl-c.opt)<Math.abs(a.fl-c.opt)?b:a);
 const tooHigh=all.filter(f=>isDir(f)&&!res.find(r=>r.fl==f));
 const band=all.filter(f=>f>=Math.max(c.minfl,Math.min(bestF.fl,c.opt)-60));const wts={};res.forEach(r=>{wts[r.fl]=1/(1+Math.max(0,key(r)-key(bestF))/150)});
 const pick=pickFmsLevels(cruise,band,wts,bestF.fl);
 /* model agreement */
 let agree="";if(S[0].pm.GFS&&S[0].pm.ECMWF){let d=0,mx=0,n=0;for(const s of cruise)for(const f of band){const a=interpProf(s.pm.GFS,f*100),b=interpProf(s.pm.ECMWF,f*100),e=Math.hypot(a.u-b.u,a.v-b.v);if(f==bestF.fl){d+=e;n++}mx=Math.max(mx,e)}
  d=n?d/n:0;agree=`<p class="${d>20?"warn":"note"}" style="font-size:12px">GFS vs ECMWF at FL${bestF.fl}: ${Math.round(d)} kt average difference (max ${Math.round(mx)} kt in band)${d>20?". The models disagree: treat the result with caution and compare with the OFP winds.":"."}</p>`}
 /* forecast age */
 const M=STATE&&STATE.meta||{};let age="";
 if(M.fetched){const hrs=(Date.now()-M.fetched)/3600e3;const runs=Object.entries(M.runs||{}).map(([k,t])=>`${k} ${new Date(t).toISOString().slice(11,13)}Z run`).join(", ");
  age=`<p class="${hrs>6?"warn":"note"}" style="font-size:12px">Forecast downloaded ${hrs<1?Math.round(hrs*60)+" min":hrs.toFixed(1)+" h"} ago${runs?" · "+runs:""}${hrs>6?". Download again for fresher winds.":"."}</p>`}
 /* compare usual levels */
 let mineHtml="";
 if(c.mine.length>=2){const lv=c.mine.slice().sort((a,b)=>a-b);const src=s=>fmsProf(s.prof,lv);
  const perc=all.filter(isDir).map(f=>sim(S,c,constPath(f),{src})).filter(r=>!r.bad);
  if(perc.length){const pb=perc.reduce((a,b)=>key(b)<key(a)?b:a),trueAt=shown.find(r=>r.fl==pb.fl)||bestF;
   mineHtml=`<p style="font-size:13px">With winds ${c.mode=="datalink"?"uplinked":"entered"} only at <b>${lv.map(f=>"FL"+f).join(" ")}</b>, the FMS sees a best of <b>FL${pb.fl}</b>. Errors reach ${profErr(cruise,band,lv).toFixed(0)} kt in your band.${pb.fl!=bestF.fl?` With the real profile the best is <b>FL${bestF.fl}</b>. Flying FL${pb.fl} means ${kgs(trueAt.fuel-bestF.fuel)} kg and ${sgn((trueAt.time-bestF.time)*60)} min.`:" Same answer as the real profile."}</p>`}}
 /* step plan */
 const wLand=c.tow*1000-bestF.fuel,topFL=Math.min(390,Math.floor(flAtWeight(c.recmax,wLand,c)/10)*10),dirLv=[];
 for(let f=c.minfl;f<=Math.max(topFL,c.recmax);f+=10)if(isDir(f))dirLv.push(f);const sp=stepPlan(S,c,bestF,dirLv);
 let stepHtml="";
 if(sp&&bestF.cdist>=250){const changes=[];sp.pick.forEach((L,k)=>{if(k==0||L!=sp.pick[k-1])changes.push({k,L})});
  const worth=sp.saving!=null&&sp.saving>=c.minstep&&changes.length>1;
  stepHtml=`<div class="card"><h2>Step plan</h2>${worth?`<div class="scroll"><table><tr><th>WHERE</th><th>LEVEL</th><th>UNTIL</th></tr>
${changes.map((q,i)=>{const nx=changes[i+1];return`<tr class="${i>0?"best":""}"><td>${i==0?"Initial":"At "+sp.segs[q.k].name}</td><td>FL${q.L}</td><td>${nx?sp.segs[nx.k].name:"T/D"}</td></tr>`}).join("")}</table></div>
<p style="font-size:13px">Saves ≈<b>${kg(sp.saving)} kg</b>${c.ci?" (cost units)":""} against FL${bestF.fl} all the way, after ${c.stepc} kg per 1000 ft of step climb.</p>`
  :`<p style="font-size:13px">No step worth requesting: <b>FL${bestF.fl}</b> all the way${changes.length>1&&sp.saving!=null&&sp.saving>0?` (best step plan saves only ${kg(sp.saving)} kg)`:""}.</p>`}
<p class="note">Steps can only happen at route fixes. OPT and REC MAX rise as fuel burns (constant weight/pressure ratio). The minimum saving is in More settings.</p></div>`}
 /* OFP comparison */
 let ofpHtml="";const OF=load("optfl.ofp");
 if(OF&&OF.route==P.route&&OF.levels){const op=pathFromOFP(OF.levels,S);if(op){const r=sim(S,c,op);if(!r.bad){const d=r.fuel-bestF.fuel;
  ofpHtml=`<p style="font-size:13px">OFP profile (${OF.levelsTxt||""}) with these winds: ${kg(r.fuel)} kg, ${hm(r.time)} · ${d>=0?"+":"−"}${kg(Math.abs(d))} kg vs FL${bestF.fl}${OF.trip?` · OFP trip ${kg(OF.trip)} kg`:""}.</p>`}}}
 /* climb & descent winds */
 const clL=[50,100,180,250],cw=bestF.cl.d+bestF.wc*bestF.cl.t,dw=c.total-(bestF.de.d+bestF.wd*bestF.de.t);
 const cdRows=(s0,s1)=>clL.concat([bestF.fl]).map(f=>{const w=vecAvg(S,s0,s1,f*100);return w?`<td>${windStr(w)}</td>`:"<td>—</td>"}).join("");
 const cdHtml=`<div class="card"><h2>Climb &amp; descent winds</h2><div class="scroll"><table><tr><th></th>${clL.concat([bestF.fl]).map(f=>`<th>FL${String(f).padStart(3,"0")}</th>`).join("")}</tr>
<tr><td>CLB</td>${cdRows(0,Math.max(cw,60))}</tr><tr><td>DES</td>${cdRows(Math.min(dw,c.total-60),c.total)}</tr></table></div>
<p class="note">For the FMS CLB/DES WIND pages, averaged over the climb (first ${Math.round(cw)} NM) and descent (last ${Math.round(c.total-dw)} NM). Average climb wind ${sgn(bestF.wc)} kt, descent ${sgn(bestF.wd)} kt along track, already included in the trip figures.</p></div>`;
 /* manual / datalink */
 const lv=pick.lv,wps=cruise.filter(s=>s.user&&!s.apt&&s.name);
 let wpRows;if(wps.length)wpRows=wps.map(s=>`<tr><td>${s.name}</td>${lv.map(f=>`<td>${windStr(interpProf(s.prof,f*100))}</td>`).join("")}</tr>`).join("");
 else{const avg=lv.map(f=>vecAvg(cruise,0,1e9,f*100));wpRows=`<tr><td>Route avg</td>${avg.map(x=>`<td>${windStr(x)}</td>`).join("")}</tr>`}
 const ranked=shown.slice().sort((a,b)=>key(a)-key(b)),top=ranked.slice(0,4);
 const levelsCard=c.mode=="datalink"?`<div class="card"><h2>3 · Request wind uplink at</h2>
<div>${lv.map(f=>`<span class="pill" style="font-size:20px;padding:6px 14px">FL${f}</span>`).join("")}</div>
<p style="font-size:13px">With winds at these 4 levels at every waypoint, the FMS matches the forecast profile within ≈${profErr(cruise,band,lv).toFixed(0)} kt from FL${band[0]} to FL${band[band.length-1]}. The set brackets the best level (FL${bestF.fl}), so the OPT the FMS computes after the uplink can be trusted.</p>
${mineHtml||`<p class="note">Type the 4 levels you usually request above to see what they would do to the FMS OPT.</p>`}</div>
<div class="card"><details><summary style="font-size:14px;color:var(--am);font-weight:700">ALSO: FL TO REQUEST FROM ATC</summary>
<div class="scroll"><table><tr><th>#</th><th>FL</th><th>FUEL</th><th>TIME</th><th>WIND</th></tr>
${top.map((a,i)=>`<tr class="${i==0?"best":""}"><td>${i+1}</td><td>FL${a.fl}</td><td>${i==0?"best":(a.fuel>=bestF.fuel?"+":"−")+kg(Math.abs(a.fuel-bestF.fuel))+" kg"}</td><td>${i==0?hm(a.time):sgn((a.time-bestF.time)*60)+" min"}</td><td>${sgn(a.tw)} kt</td></tr>`).join("")}</table></div>
${bestT.fl!=bestF.fl?`<p style="font-size:13px">If you're late, <b>FL${bestT.fl}</b> is fastest: ${Math.round((bestF.time-bestT.time)*60)} min saved for ${kgs(bestT.fuel-bestF.fuel)} kg.</p>`:""}</details></div>`
 :`<div class="card"><h2>3 · Enter these winds in the FMS</h2><div>${lv.map(f=>`<span class="pill">FL${f}</span>`).join("")}</div>
<p class="note">These 4 levels let the FMS's interpolation match the forecast profile from FL${band[0]} to FL${band[band.length-1]} within ≈${pick.e.toFixed(0)} kt.</p>
<div class="scroll"><table><tr><th>WPT</th>${lv.map(f=>`<th>FL${f}</th>`).join("")}</tr>${wpRows}</table></div>
${wps.length?"":`<p class="note">No en-route fixes in the cruise portion: enter these averages at your first cruise waypoint and let them propagate.</p>`}${mineHtml}</div>`;
 const save=ref.fuel-bestF.fuel,tsave=(ref.time-bestF.time)*60;
 $("out").innerHTML=`
<div class="card"><h2>2 · Result</h2>
<div class="row" style="justify-content:space-between"><div><div class="note">Best level${c.ci?" (CI "+c.ci+")":" (fuel)"}</div><div class="big">FL${bestF.fl}</div></div>
<div><div class="note">Fastest</div><div class="big" style="color:var(--cy)">FL${bestT.fl}</div></div>
<div><div class="note">vs FL${ref.fl} (no-wind OPT)</div><div class="big" style="color:${save>0?"var(--acc)":"var(--mut)"}">${save>0.5?"−"+kg(save)+" kg":"—"}</div><div class="note">${Math.abs(tsave)<0.5?"same time":(tsave>0?Math.round(tsave)+" min faster":Math.round(-tsave)+" min slower")}</div></div></div>
<p class="note">Trip ${kg(P.total)} NM · cruise at FL${bestF.fl} ≈${kg(bestF.cdist)} NM · ${c.model=="AVG"?(STATE.info&&STATE.info.models.length>1?"GFS+ECMWF average":(STATE.info?STATE.info.models.join(""):"")):c.model} · best from <b>${par}</b> levels (mag track ${String(Math.round(magTrk)).padStart(3,"0")}°). Grey rows are the other direction${tooHigh.length?" · too short for "+tooHigh.map(f=>"FL"+f).join(", "):""}${c.cal!=1?` · fuel calibrated ×${c.cal.toFixed(3)}`:""}</p>
${agree}${age}
<div class="scroll"><table><tr><th>FL</th><th>WIND</th><th>HAVE</th><th>NEED</th>${c.ci?"":"<th>ISA</th>"}<th>GS</th><th>TIME</th><th>TRIP kg</th>${c.ci?"<th>COST</th>":""}<th>Δ</th></tr>
${res.slice().reverse().map(r=>{const d=key(r)-key(bestF),isRef=r===ref,have=r.tw-ref.tw,rem=ref.fuel-r.xf,need=rem>0?r.tw+(r.cfuel*r.cgs/rem-r.cgs)-ref.tw:NaN;
 return`<tr class="${r===bestF?"best":""} ${r.fl==c.opt?"opt":""} ${isDir(r.fl)?"":"dim"}"><td>FL${r.fl}${r.over?"*":""}</td>
<td style="color:${r.tw>=0?"var(--acc)":"var(--rd)"}">${sgn(r.tw)}</td><td>${isRef?"ref":sgn(have)}</td><td style="color:${isRef?"inherit":have>=need?"var(--acc)":"var(--mut)"}">${isRef?"—":isFinite(need)?sgn(need):"n/a"}</td>
${c.ci?"":`<td>${sgn(r.isa)}</td>`}<td>${Math.round(r.cgs)}</td><td>${hm(r.time)}</td><td>${kg(r.fuel)}</td>${c.ci?`<td>${kg(r.cost)}</td>`:""}<td>${r===bestF?"best":d<0?"−"+kg(-d):"+"+kg(d)}</td></tr>`}).join("")}
</table></div>
<div class="note">WIND = average tail(+)/head(−) over the cruise. HAVE = wind gain vs your OPT; NEED = gain required to pay for leaving OPT (green when HAVE ≥ NEED). TRIP = climb + cruise + descent, with weight-based OPT.${c.ci?" COST = fuel + CI × minutes (kg).":""} * = above REC MAX at the start of cruise.</div>
${ofpHtml}</div>
${levelsCard}
${stepHtml}
${cdHtml}
<div class="card"><h2>Wind profile (cruise average)</h2>${profileSvg(cruise,lv,c.mine)}</div>`;
 STATE.last={c,bestF,pick:lv,S,P};}

function profileSvg(cruise,lv,mine){const fls=[];for(let f=200;f<=410;f+=10)fls.push(f);const wsum=cruise.reduce((a,s)=>a+s.seg,0)||1;
 const comp=src=>fls.map(fl=>{let t=0;for(const s of cruise)t+=along(interpProf(src(s),fl*100),s.trk)*s.seg;return t/wsum});
 const real=comp(s=>s.prof),fms=comp(s=>fmsProf(s.prof,lv)),mn=mine.length>=2?comp(s=>fmsProf(s.prof,mine.slice().sort((a,b)=>a-b))):null;
 const vals=real.concat(fms,mn||[]),lo=Math.min(0,...vals)-5,hi=Math.max(0,...vals)+5,W=340,H=260,x=v=>30+(v-lo)/(hi-lo)*(W-40),y=f=>H-20-(f-200)/210*(H-30);
 const path=a=>a.map((v,i)=>(i?"L":"M")+x(v).toFixed(1)+","+y(fls[i]).toFixed(1)).join("");
 let g="";for(let f=200;f<=400;f+=40)g+=`<line x1="30" x2="${W-10}" y1="${y(f)}" y2="${y(f)}" stroke="#30363d"/><text x="2" y="${y(f)+4}" fill="#8b949e" font-size="10">${f}</text>`;
 g+=`<line x1="${x(0)}" x2="${x(0)}" y1="10" y2="${H-20}" stroke="#8b949e" stroke-dasharray="3 3"/><text x="${x(lo)}" y="${H-5}" fill="#8b949e" font-size="10">${Math.round(lo)} kt</text><text x="${x(hi)-30}" y="${H-5}" fill="#8b949e" font-size="10">+${Math.round(hi)} kt</text>`;
 return`<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:520px">${g}<path d="${path(real)}" fill="none" stroke="#3fb950" stroke-width="2.5"/><path d="${path(fms)}" fill="none" stroke="#39c5cf" stroke-width="1.5" stroke-dasharray="5 3"/>${mn?`<path d="${path(mn)}" fill="none" stroke="#f85149" stroke-width="1.5" stroke-dasharray="2 3"/>`:""}</svg>
<div class="note"><span style="color:#3fb950">━</span> forecast tail(+)/head(−) wind · <span style="color:#39c5cf">╌</span> what FMS sees with recommended levels${mn?` · <span style="color:#f85149">┈</span> with your levels`:""}</div>`}

/* ============================== OFP import ============================== */
async function importOFP(file){const m=$("ofpmsg");m.className="msg";m.textContent="Reading OFP…";
 try{const [pdfjs,mod]=await Promise.all([import("./pdf.min.mjs"),import("./ofp.js")]);pdfjs.GlobalWorkerOptions.workerSrc=new URL("./pdf.worker.min.mjs",location.href).href;
  const lines=await mod.pdfLines(pdfjs,new Uint8Array(await file.arrayBuffer()));const o=mod.parseOFP(lines);
  if(o.waypoints.length<2)throw new Error("No navigation log found in this PDF.");
  $("route").value=o.route;
  if(o.etd)$("dep").value=o.etd.toISOString().slice(0,16);
  if(o.type){$("actype").value=o.type}
  if(o.tow)$("tow").value=(o.tow/1000).toFixed(1);
  if(o.mach)$("mach").value=o.mach.toFixed(2);
  if(o.ci!=null)$("ci").value=o.ci;
  if(o.ff)$("ff").value=o.ff;
  if(o.p2)$("p2").value=o.p2;if(o.p4)$("p4").value=o.p4;
  const lvTxt=ofpChanges(o.levels).map((q,i)=>"FL"+q.fl+(i&&q.fix?" ("+q.fix+")":"")).join(" → ");
  store("optfl.ofp",{route:o.route,levels:o.levels,trip:o.trip,levelsTxt:lvTxt});saveInputs();
  m.className="msg ok";m.textContent=`OFP ${o.orig||""}→${o.dest||""}: ${o.waypoints.length} fixes, ETD ${o.etd?o.etd.toISOString().slice(11,16)+"Z":"?"}, ${(o.type||"").toUpperCase()}, TOW ${o.tow?(o.tow/1000).toFixed(1)+" t":"?"}, CI ${o.ci??"?"}, M${o.mach||"?"}, FF ${o.ff||"?"} kg/h, penalties ${o.p2||"?"}% / ${o.p4||"?"}%, trip ${o.trip?kg(o.trip)+" kg":"?"}.\nOFP levels: ${lvTxt}.\nStill needed: OPT and REC MAX at TOW from the FMS (no winds).`;
 }catch(e){m.className="msg err";m.textContent="Couldn't read the OFP: "+(e.message||e)+". You can still paste the route.";console.error(e)}}

/* ============================== post-flight & history ============================== */
function tParse(s){const m=(s||"").match(/(\d{1,2})[:.]?(\d{2})/);return m?+m[1]+ +m[2]/60:null}
function fuelKg(v){const x=parseFloat(v);return!isFinite(x)?null:x<200?x*1000:x}
function postflight(){const o=$("pfout");if(!STATE||!STATE.last){o.className="msg warn";o.textContent="Run a calculation for this flight first.";return null}
 const{S,P}=STATE.last,c=cfg();c.total=P.total;useModel(S,c.model);
 const p=pathFromSpec($("pf_lv").value,S);if(!p||p.err){o.className="msg err";o.textContent=p&&p.err?"Fix not on the route: "+p.err:"Enter the levels flown, e.g. 340 360/ASEPU";return null}
 const r=sim(S,c,p,{cal:1});if(r.bad){o.className="msg err";o.textContent="Route too short for that level.";return null}
 const tof=fuelKg($("pf_tof").value),ldf=fuelKg($("pf_ldf").value),t1=tParse($("pf_to").value),t2=tParse($("pf_ldg").value);
 if(tof==null||ldf==null){o.className="msg warn";o.textContent=`Model with cal 1.000: trip ${kg(r.fuel)} kg, ${hm(r.time)}. Add takeoff and landing fuel to compare.`;return null}
 const act=tof-ldf,tAct=t1!=null&&t2!=null?((t2-t1+24)%24):null,ratio=act/r.fuel;
 let rows="";(($("pf_pts").value||"").toUpperCase().split(/\n+/)).forEach(l=>{const m=l.trim().match(/^([A-Z0-9]+)\s+([\d.]+)/);if(!m)return;const pr=r.chk[m[1]];const a=tof-fuelKg(m[2]);
  if(pr!=null)rows+=`<tr><td>${m[1]}</td><td>${kg(pr)}</td><td>${kg(a)}</td><td>${sgn(a-pr)}</td></tr>`});
 o.className="msg";o.innerHTML=`<div class="scroll"><table><tr><th></th><th>MODEL</th><th>ACTUAL</th><th>Δ</th></tr>
<tr><td>Trip fuel</td><td>${kg(r.fuel)}</td><td>${kg(act)}</td><td>${sgn((ratio-1)*100,1)}%</td></tr>
${tAct!=null?`<tr><td>Flight time</td><td>${hm(r.time)}</td><td>${hm(tAct)}</td><td>${sgn((tAct-r.time)*60)} min</td></tr>`:""}</table></div>
${rows?`<label>Fuel burnt since takeoff (kg)</label><div class="scroll"><table><tr><th>FIX</th><th>MODEL</th><th>ACTUAL</th><th>Δ</th></tr>${rows}</table></div>`:""}
<p class="note">Fuel ratio ${ratio.toFixed(3)} (actual ÷ model, uncalibrated). Save it to build the calibration.</p>`;
 return{date:P.dep.toISOString().slice(0,10),route:P.pts[0].name+"-"+P.pts[P.pts.length-1].name,ac:c.ac,tow:c.tow,rec:STATE.last.bestF.fl,uplink:STATE.last.pick.join("/"),flown:$("pf_lv").value.toUpperCase(),model:Math.round(r.fuel),actual:Math.round(act),ratio:+ratio.toFixed(4),tModel:+r.time.toFixed(3),tAct}}
function renderHist(){const h=load("optfl.hist")||[],o=$("hout");if(!h.length){o.innerHTML='<span class="note">No flights saved yet.</span>';return}
 const by={};h.forEach(e=>{(by[e.ac]=by[e.ac]||[]).push(e.ratio)});
 o.innerHTML=`<div class="scroll"><table><tr><th>DATE</th><th>ROUTE</th><th>TYPE</th><th>REC</th><th>FLOWN</th><th>MODEL</th><th>ACT</th><th>Δ%</th></tr>
${h.slice().reverse().map(e=>`<tr><td>${e.date}</td><td>${e.route}</td><td>${e.ac.toUpperCase()}</td><td>FL${e.rec}</td><td>${e.flown}</td><td>${kg(e.model)}</td><td>${kg(e.actual)}</td><td>${sgn((e.ratio-1)*100,1)}</td></tr>`).join("")}</table></div>
<p class="note">${Object.entries(by).map(([k,v])=>`${k.toUpperCase()}: ${v.length} flight${v.length>1?"s":""}, calibration ×${calOfList(v).toFixed(3)}`).join(" · ")}. Turn on auto-calibrate in More settings to apply it.</p>`}
function calOfList(v){const s=v.filter(x=>x>0.7&&x<1.3).slice(-10).sort((a,b)=>a-b);if(!s.length)return 1;const m=s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2;return Math.min(1.15,Math.max(0.85,m))}

/* ============================== wiring ============================== */
function setMode(m){$("mode").value=m;document.querySelectorAll(".segb").forEach(b=>b.classList.toggle("on",b.dataset.m==m));
 $("mineLbl").textContent=m=="datalink"?"Levels you usually request in the uplink (to compare)":"Levels you normally enter (to compare)";
 if(STATE&&STATE.json)try{render(STATE.P)}catch(e){console.error(e)}saveInputs()}
document.querySelectorAll(".segb").forEach(b=>b.onclick=()=>setMode(b.dataset.m));
(function init(){const o=load("optfl.in");if(o){IDS.forEach(i=>{if(o[i]!=null&&o[i]!=="")$(i).value=o[i]});$("autocal").checked=!!o.autocal}
 if(!$("dep").value){const d=new Date(Date.now()+3600e3);d.setUTCMinutes(0,0,0);$("dep").value=d.toISOString().slice(0,16)}})();
$("actype").addEventListener("change",()=>{const A=AC[$("actype").value];$("ff").value=A.ff;$("tow").value=A.w;saveInputs();rerender()});
["model","ci","autocal","stepc","minstep"].forEach(id=>$(id).addEventListener("change",()=>{saveInputs();rerender()}));
function rerender(){if(STATE&&STATE.json)try{render(STATE.P)}catch(e){console.error(e)}}
$("ofpfile").addEventListener("change",e=>{const f=e.target.files[0];if(f)importOFP(f);e.target.value=""});
$("go").onclick=go;
$("usepaste").onclick=()=>{if(!STATE)return;let j;try{j=JSON.parse($("pj").value.trim())}catch(e){setMsg("That doesn't look like the forecast data. Copy the whole page.","err");return}
 $("paste").style.display="none";finish(STATE.P,j,{fetched:Date.now()})};
$("reuse").onclick=()=>{saveInputs();let P;try{P=prepare()}catch(e){setMsg(e.message,"err");return}
 const s=load("optfl.data");const json=STATE&&STATE.json&&STATE.P.route==P.route?STATE.json:(s&&s.route==P.route?s.json:null);
 if(!json){setMsg("No wind data for this route yet. Tap Get winds.","warn");return}finish(P,json,(STATE&&STATE.meta)||(s&&s.meta)||{})};
$("pfrun").onclick=()=>{saveInputs();postflight()};
$("pfsave").onclick=()=>{saveInputs();const e=postflight();if(!e)return;const h=load("optfl.hist")||[];h.push(e);store("optfl.hist",h);renderHist();$("hcard").open=true};
$("hcopy").onclick=async()=>{try{await navigator.clipboard.writeText(JSON.stringify(load("optfl.hist")||[],null,1));$("hcopy").textContent="Copied"}catch(e){$("hcopy").textContent="Copy failed"}setTimeout(()=>$("hcopy").textContent="Copy history",2000)};
let clr=0;$("hclear").onclick=()=>{if(!clr){clr=1;$("hclear").textContent="Tap again to clear";setTimeout(()=>{clr=0;$("hclear").textContent="Clear history"},3000);return}
 store("optfl.hist",[]);clr=0;$("hclear").textContent="Clear history";renderHist()};
setMode($("mode").value||"manual");renderHist();
(function(){const s=load("optfl.data");if(s&&s.route==$("route").value&&s.json){try{const P=prepare();finish(P,s.json,s.meta||{})}catch(e){}}})();
try{if("serviceWorker" in navigator&&location.protocol==="https:"&&!/claude\.ai|claudeusercontent/.test(location.hostname))navigator.serviceWorker.register("sw.js").catch(()=>{})}catch(e){}
