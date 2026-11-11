/*
 * ============================================================================
 *  OFP READER
 * ============================================================================
 *  Turns an OFP PDF into flight data for the app:
 *    pdfLines()  PDF -> text lines, using pdf.js (pieces of text on the same
 *                height of the page are joined into one line)
 *    parseOFP()  text lines -> { route, ETD, aircraft type, CI, Mach, FF, TOW,
 *                trip fuel/time, off-OPT penalties, planned levels, planned
 *                time and fuel at each fix, wind shear rate at each fix }
 *
 *  Written for the OFP layout of JAT804 (Lido-style navigation log: each fix
 *  takes 3 lines; latitude on line 1, longitude on line 2, Mach on line 3).
 * ============================================================================
 */
/** Reads every page of the PDF and returns its text as lines, top to bottom. */
export async function pdfLines(pdfjs, data){
  const doc = await pdfjs.getDocument({data, isEvalSupported:false}).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++){
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = new Map();
    for (const it of tc.items){
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      let key = null;
      for (const k of rows.keys()) if (Math.abs(k - y) <= 2){ key = k; break; }
      if (key === null){ key = y; rows.set(key, []); }
      rows.get(key).push({x: it.transform[4], s: it.str});
    }
    [...rows.entries()].sort((a,b)=>b[0]-a[0]).forEach(([,r])=>{
      r.sort((a,b)=>a.x-b.x);
      lines.push(r.map(o=>o.s).join(" ").replace(/\s+/g," ").trim());
    });
  }
  return lines;
}

/** Pseudo-points of the navigation log that are not real fixes. */
const SKIP = new Set(["T_O_C","T_O_D","B_O_D","TOC","TOD"]);
/** Extracts the flight data from the OFP text lines (see header). */
export function parseOFP(lines){
  const txt = lines.join("\n");
  const o = {waypoints:[], levels:[]};
  let m;
  if ((m = txt.match(/(\d{2})([A-Z]{3})(\d{4})\s+([A-Z]{4})\/([A-Z]{4})\s+ETD\s?(\d{2})(\d{2})Z/))){
    const mon = {JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11}[m[2]];
    o.etd = new Date(Date.UTC(+m[3], mon, +m[1], +m[6], +m[7]));
    o.orig = m[4]; o.dest = m[5];
  }
  /* aircraft type from the header line, e.g. "A320-232/V2527-A5" or "A320-271N/PW1127G".
     Only the type/engine on that line count: the briefing pages mention NEO/CEO anyway. */
  if ((m = txt.match(/\b(A32[01])-(\d{3}N?)(?:[\/ ]+(\S+))?/))){
    const eng = m[3] || "";
    const neo = /^(PW11|LEAP)/i.test(eng) ? true
              : /^(V25|CFM56)/i.test(eng) ? false
              : /N$/.test(m[2]) || /^2[57]\d/.test(m[2]);
    o.type = m[1].toLowerCase() + (neo ? "neo" : "ceo");
  }
  if ((m = txt.match(/CRZ\s+(?:SYS\s+)?CI\s+(\d+)/)) || (m = txt.match(/\bCI\s+(\d{1,3})\b/))) o.ci = +m[1];
  if ((m = txt.match(/AVG FF KG\/H\s+(\d{3,5})/))) o.ff = +m[1];
  if ((m = txt.match(/\bTOW\s+(\d{5,6})/))) o.tow = +m[1];
  if ((m = txt.match(/\bTRIP\s+[A-Z]{4}\s+(\d{4,6})\s+(\d{4})/))){ o.trip = +m[1]; o.tripTime = m[2]; }
  const imp = re => { const r = txt.match(re); return r ? +r[1] : null; };
  o.dn2 = imp(/FL DN 2000 FT TRIP\s*\+\s*(\d+)/); o.dn4 = imp(/FL DN 4000 FT TRIP\s*\+\s*(\d+)/); o.up2 = imp(/FL UP 2000 FT TRIP\s*\+\s*(\d+)/);
  if ((m = txt.match(/FUEL BIAS\s+([PM])(\d+(?:\.\d+)?)/))) o.bias = (m[1]=="M"?-1:1)*+m[2];
  if ((m = txt.match(/AVG ISA DEV\s+([PM])(\d+)/))) o.isa = (m[1]=="M"?-1:1)*+m[2];

  /* primary navigation log: from the first coordinate line to the destination */
  const latRe = /^[NS]\d{4}\.\d$/, lonRe = /^[EW]\d{5}\.\d$/;
  const machs = [];
  let started = false;
  for (let i = 0; i < lines.length - 1; i++){
    const t = lines[i].split(" ");
    const li = t.findIndex(x => latRe.test(x));
    if (li < 1) continue;
    const lon = lines[i+1].split(" ").find(x => lonRe.test(x));
    if (!lon) continue;
    const name = t[0].split("/")[0];
    if (!/^[A-Z0-9_]{2,8}$/.test(name)) continue;
    if (!started){ if (o.orig && name !== o.orig) continue; started = true; }
    const fl = /^\d{2,3}$/.test(t[1]) && li > 1 ? +t[1] : null;
    if (!SKIP.has(name)) o.waypoints.push({name, lat:t[li], lon});
    /* planned remaining fuel (line 1, last number) and accumulated time hh.mm (line 2, after accumulated distance) */
    if (!SKIP.has(name)){
      const rem = +(t[t.length-1].match(/^\d{3,6}$/) || [NaN])[0];
      const t2 = lines[i+1].split(" "); let at = null;
      for (let k = 0; k < t2.length - 1; k++) if (/^\d{4}$/.test(t2[k]) && /^\d{2}\.\d{2}$/.test(t2[k+1])){ const [h,mm] = t2[k+1].split("."); at = +h + +mm/60; break; }
      if (name === o.orig && at === null) at = 0;
      (o.fix = o.fix || []).push({name, rem: isFinite(rem) ? rem : null, at});
    }
    const wi = t.findIndex(x => /^\d{3}\/\d{3}$/.test(x));
    if (wi > 0 && /^\d{2}$/.test(t[wi+1] || "")) (o.sr = o.sr || {})[name] = +t[wi+1];
    if (fl !== null) o.levels.push({name, fl});
    const t3 = (lines[i+2] || "").split(" ");
    for (let k = 0; k < t3.length - 1; k++) if (/^[+-]\d{2}$/.test(t3[k]) && /^\d{3}$/.test(t3[k+1]) && +t3[k+1] >= 600 && +t3[k+1] < 900) machs.push(+t3[k+1]);
    /* airport elevation: "ELEV 3152FT" on the line under the airport */
    const ev = (lines[i+1] || "").match(/ELEV\s+(-?\d+)\s*FT/);
    if (ev && name === o.orig) o.origElev = +ev[1];
    if (ev && name === o.dest) o.destElev = +ev[1];
    if (o.dest && name === o.dest) break;
  }
  if (machs.length){ const c = {}; machs.forEach(v => c[v] = (c[v]||0) + 1); o.mach = +Object.entries(c).sort((a,b)=>b[1]-a[1])[0][0] / 1000; }
  if (o.trip && o.dn2) o.p2 = Math.round(1000 * o.dn2 / o.trip) / 10;
  if (o.trip && o.dn4) o.p4 = Math.round(1000 * o.dn4 / o.trip) / 10;
  if (o.fix && o.fix.length && o.fix[0].rem) o.tof = o.fix[0].rem;
  o.route = o.waypoints.map(w => `${w.name}/${w.lat}${w.lon}`).join(" ");
  return o;
}
