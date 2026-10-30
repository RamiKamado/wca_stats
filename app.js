"use strict";
/* アプリのバージョン（更新したらここだけ変える。例: v01.17.00 → v01.17.01）
   大きな作り直し・機能追加・修正 の順に2桁ずつ。Service Worker のキャッシュもこの値で切り替わる。 */
const APP_VERSION = "v01.17.03";
const DATA_SRC = "https://raw.githubusercontent.com/robiningelbrecht/wca-rest-api/v1/";
const WCA_API = "https://www.worldcubeassociation.org/api/v0/";

/* ---------- event & format helpers ---------- */
const EVENTS = [
  ["333","3x3x3","time"],["222","2x2x2","time"],["444","4x4x4","time"],["555","5x5x5","time"],
  ["666","6x6x6","time"],["777","7x7x7","time"],["333bf","3x3x3 目隠し","time"],["333fm","3x3x3 最少手数","fm"],
  ["333oh","3x3x3 片手","time"],["clock","クロック","time"],["minx","メガミンクス","time"],["pyram","ピラミンクス","time"],
  ["skewb","スキューブ","time"],["sq1","スクエア1","time"],["444bf","4x4x4 目隠し","time"],["555bf","5x5x5 目隠し","time"],
  ["333mbf","3x3x3 複数目隠し","mbf"],["333ft","3x3x3 足（廃止）","time"],["magic","マジック（廃止）","time"],
  ["mmagic","マスターマジック（廃止）","time"],["333mbo","複数目隠し旧式（廃止）","mbf"]
];
const EVM = {}; EVENTS.forEach(([id,name,kind],i)=>EVM[id]={id,name,kind,order:i});
const ev = id => EVM[id] || {id,name:id,kind:"time",order:99};
const RO = {"Qualification round":0,"First round":1,"Second round":2,"B Final":2.5,"Semi Final":3,"Final":4};
const RJ = {"Qualification round":"予選","First round":"1回戦","Second round":"2回戦","B Final":"B決勝","Semi Final":"準決勝","Final":"決勝"};
const FJ = {"Average of 5":"Ao5","Mean of 3":"Mo3","Best of 1":"Bo1","Best of 2":"Bo2","Best of 3":"Bo3","Best of 5":"Bo5"};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
/* ---------- 外部データ・入力の検査（想定外の値や紛れ込んだHTMLを取り除く） ---------- */
const ID_RE = /^\d{4}[A-Z]{4}\d{2}$/;            // WCA ID
const TOKEN_RE = /^[A-Za-z0-9_-]{1,64}$/;          // 大会ID・種目ID
const ISO2_RE = /^[A-Z][A-Z0-9]$/;                 // 国コード（XA などの複数国も含む）
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REC_RE = /^(WR|NR|AsR|ER|NAR|SAR|AfR|OcR|CR)$/;
const num = v => { const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v) ? +v : NaN; return Number.isFinite(n) ? Math.trunc(n) : 0; };
const numOrNull = v => v == null ? null : num(v);
const str = (v, max = 200) => typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, "").slice(0, max) : "";
const iso2 = v => typeof v === "string" && ISO2_RE.test(v) ? v : "";
const isoDate = v => typeof v === "string" && DATE_RE.test(v) ? v : null;
const recCode = v => typeof v === "string" && REC_RE.test(v) ? v : null;
const obj = v => v && typeof v === "object" && !Array.isArray(v) ? v : {};
function cleanPerson(raw){
  raw = obj(raw);
  const id = str(raw.id, 10).toUpperCase();
  if (!ID_RE.test(id)) throw Object.assign(new Error("invalid data"), {status:0});
  const results = {};
  for (const [cid, evs] of Object.entries(obj(raw.results))) {
    if (!TOKEN_RE.test(cid)) continue;
    const o = {};
    for (const [eid, rs] of Object.entries(obj(evs))) {
      if (!TOKEN_RE.test(eid) || !Array.isArray(rs)) continue;
      o[eid] = rs.filter(r => r && typeof r === "object").slice(0, 20).map(r => ({
        round:str(r.round, 40), position:numOrNull(r.position), best:num(r.best), average:num(r.average),
        format:str(r.format, 40), solves:Array.isArray(r.solves) ? r.solves.slice(0, 10).map(num) : []
      }));
    }
    results[cid] = o;
  }
  const ranks = list => (Array.isArray(list) ? list : []).filter(x => x && TOKEN_RE.test(x.eventId)).map(x => ({
    eventId:x.eventId, best:num(x.best),
    rank:{world:numOrNull(x.rank?.world), continent:numOrNull(x.rank?.continent), country:numOrNull(x.rank?.country)}
  }));
  const recs = r => { const o = {}; for (const [k, v] of Object.entries(obj(r))) if (/^[A-Za-z]{2,4}$/.test(k)) o[k] = num(v); return o; };
  const md = obj(raw.medals);
  return {
    id, name:str(raw.name, 120), country:iso2(raw.country),
    numberOfCompetitions:numOrNull(raw.numberOfCompetitions), numberOfChampionships:numOrNull(raw.numberOfChampionships),
    championshipIds:(Array.isArray(raw.championshipIds) ? raw.championshipIds : []).filter(x => typeof x === "string" && TOKEN_RE.test(x)),
    results, rank:{singles:ranks(raw.rank?.singles), averages:ranks(raw.rank?.averages)},
    medals:{gold:num(md.gold), silver:num(md.silver), bronze:num(md.bronze)},
    records:{single:recs(raw.records?.single), average:recs(raw.records?.average)}
  };
}
function cleanCompMeta(m){
  m = obj(m);
  return {name:str(m.name, 120), city:str(m.city, 120), country:iso2(m.country), date:isoDate(m.date), end:isoDate(m.end), ...(m.live === true ? {live:true} : {})};
}
/* 検索欄の入力：全角英数を半角にし、制御文字やHTML・スクリプトに使われる記号を受け付けない */
function cleanQuery(q){
  q = str(String(q || "").normalize("NFKC"), 60).replace(/\s+/g, " ").trim();
  if (/[<>"`{}\[\]\\;:\/=&|$%^*~#@!?]/.test(q)) return {q, bad:true};
  return {q, bad:false};
}

const unitOf = id => ({fm:"手",mbf:"点"})[ev(id).kind] || "秒";

function fmtCs(cs){
  cs = Math.round(cs);
  const h = Math.floor(cs/360000), m = Math.floor(cs%360000/6000), s = (cs%6000)/100;
  if (h) return `${h}:${String(m).padStart(2,"0")}:${s.toFixed(2).padStart(5,"0")}`;
  if (m) return `${m}:${s.toFixed(2).padStart(5,"0")}`;
  return s.toFixed(2);
}
function fmtSec(sec){ const h=Math.floor(sec/3600), m=Math.floor(sec%3600/60), s=sec%60;
  return h ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${m}:${String(s).padStart(2,"0")}`; }
function decMbf(v){
  const s = String(v);
  if (s.length === 10 && s[0] === "1") { // old multi-blind format 1SSAATTTTT
    const solved = 99 - +s.slice(1,3), att = +s.slice(3,5), time = +s.slice(5);
    return {solved, attempted:att, missed:att-solved, points:solved-(att-solved), time};
  }
  const p = s.padStart(10,"0"); // 0DDTTTTTMM
  const points = 99 - +p.slice(1,3), time = +p.slice(3,8), missed = +p.slice(8,10);
  return {solved:points+missed, attempted:points+2*missed, missed, points, time};
}
function fmtVal(id, v, isAvg){
  if (v === -1) return "DNF"; if (v === -2) return "DNS"; if (!v || v < 0) return "";
  const k = ev(id).kind;
  if (k === "fm") return isAvg ? (v/100).toFixed(2) : String(v);
  if (k === "mbf") { const d = decMbf(v); return `${d.solved}/${d.attempted} ${d.time>=99999?"?":fmtSec(d.time)}`; }
  return fmtCs(v);
}
function key(id, v){ // lower is better
  if (!(v > 0)) return Infinity;
  if (ev(id).kind === "mbf") { const d = decMbf(v); return (99-d.points)*1e8 + Math.min(d.time,99999)*100 + d.missed; }
  return v;
}
function plotY(id, v, isAvg){
  const k = ev(id).kind;
  if (k === "mbf") return decMbf(v).points;
  if (k === "fm") return isAvg ? v/100 : v;
  return v/100;
}
function fmtPlot(id, y){ // value in plot units -> display
  const k = ev(id).kind;
  if (k === "mbf") return `${Math.round(y*10)/10}点`;
  if (k === "fm") return `${Math.round(y*100)/100}手`;
  return fmtCs(y*100);
}
function tickLabel(id, y){
  const k = ev(id).kind;
  if (k === "mbf" || k === "fm") return String(+y.toFixed(2));
  if (y >= 60) { const m = Math.floor(y/60), s = Math.round(y%60); return `${m}:${String(s).padStart(2,"0")}`; }
  return String(+y.toFixed(2));
}
const pct = (a,b) => b ? (100*a/b) : 0;
const fmtNum = n => n.toLocaleString("ja-JP");
const regionName = (() => {
  let dn = null; try { dn = new Intl.DisplayNames(["ja"],{type:"region"}); } catch(e){}
  const multi = {XA:"アジア（複数会場）",XE:"ヨーロッパ（複数会場）",XF:"アフリカ（複数会場）",XM:"アメリカ大陸（複数会場）",XN:"北米（複数会場）",XO:"オセアニア（複数会場）",XS:"南米（複数会場）",XW:"世界（複数会場）"};
  return c => multi[c] || (dn && c ? (()=>{ try { return dn.of(c); } catch(e){ return c; } })() : (c||"不明"));
})();
const isMulti = c => /^X[A-Z]$/.test(c||"");
function fallbackDate(cid){ const m = cid.match(/(\d{4})$/); return m ? `${m[1]}-07-01` : "1900-01-01"; }

/* ---------- data loading ---------- */
const compCache = {};
function cacheGet(id){ if (compCache[id]) return compCache[id]; try { const s = localStorage.getItem("wca-comp-v1:"+id); if (s) return compCache[id] = cleanCompMeta(JSON.parse(s)); } catch(e){} return null; }
function cachePut(id, m){ compCache[id] = m; try { localStorage.setItem("wca-comp-v1:"+id, JSON.stringify(m)); } catch(e){} }

async function fetchJSON(url){
  const res = await fetch(url, {cache:"no-cache"});
  if (!res.ok) { const err = new Error("HTTP "+res.status); err.status = res.status; throw err; }
  return res.json();
}
async function loadComps(ids, onProgress){
  const out = {}; const todo = [];
  ids.forEach(id => { const c = cacheGet(id); if (c) out[id] = c; else todo.push(id); });
  let done = ids.length - todo.length; onProgress(done, ids.length);
  let i = 0;
  async function worker(){
    while (i < todo.length) {
      const id = todo[i++];
      try {
        const j = await fetchJSON(DATA_SRC + "competitions/" + encodeURIComponent(id) + ".json");
        const m = cleanCompMeta({name:j?.name, city:j?.city, country:j?.country, date:j?.date?.from, end:j?.date?.till});
        cachePut(id, m); out[id] = m;
      } catch(e) { out[id] = null; }
      onProgress(++done, ids.length);
    }
  }
  await Promise.all(Array.from({length:Math.min(10, todo.length)}, worker));
  return out;
}

function setStatus(html, isErr){ const s = $("#status"); s.innerHTML = html; s.classList.toggle("err", !!isErr); }

let loadToken = 0;
/* ミラーの元になったWCA公式データの日付（順位がいつ時点のものかを表示する） */
let MIRROR_DATE = null, MIRROR_DATE_P = null;
function loadMirrorDate(){
  if (!MIRROR_DATE_P) MIRROR_DATE_P = fetchJSON(DATA_SRC + "version.json")
    .then(j => { MIRROR_DATE = (j.export_date || "").slice(0, 10) || null; if (STATE) { renderPB(); rhRender(); } })
    .catch(() => { MIRROR_DATE_P = null; });
  return MIRROR_DATE_P;
}

async function loadId(id){
  id = str(String(id || ""), 10).toUpperCase();
  if (!ID_RE.test(id)) { setStatus("WCA ID の形式が正しくありません（数字4桁＋英字4文字＋数字2桁の10文字）。", true); return; }
  const my = ++loadToken;
  LIVE = {id:null, state:"idle", comps:[]}; updateLiveNote();
  LIVE_OTHERS.clear();
  $("#cands").innerHTML = "";
  setStatus(`<span>${esc(id)} の成績を取得中…</span>`);
  let person;
  try { person = cleanPerson(await fetchJSON(DATA_SRC + "persons/" + encodeURIComponent(id) + ".json")); }
  catch(e) {
    if (my !== loadToken) return;
    if (e.status === 404) setStatus(`WCA ID「${esc(id)}」は見つかりませんでした。IDの綴りを確認するか、氏名で検索してください（登録直後の選手はデータ反映まで1日ほどかかることがあります）。`, true);
    else setStatus(`データを取得できませんでした（${esc(e.message)}）。インターネット接続を確認して、もう一度お試しください。`, true);
    return;
  }
  if (my !== loadToken) return;
  const recP = loadRecords(person.id);
  loadMirrorDate();
  POSTED = [];
  const ids = Object.keys(person.results || {});
  const comps = await loadComps(ids, (d,n) => {
    if (my !== loadToken) return;
    setStatus(`<span>${esc(person.name)} の大会情報を取得中</span><span class="bar"><span style="width:${pct(d,n)}%"></span></span><span class="mono">${d}/${n}</span>`);
  });
  if (my !== loadToken) return;
  const missing = ids.filter(i => !comps[i]).length;
  render(person, comps);
  const showStatus = () => setStatus(`<span>${esc(person.name)}（${esc(person.id)}）を表示中</span>` + (missing ? `<span>※ ${missing}大会の開催日を取得できず、年のみで並べています</span>` : "")
    + (POSTED.length ? `<span>WCA公式サイトに反映済みの最新 ${POSTED.length}大会を、WCA公式APIから公式記録として取り込みました</span>` : "")
    + `<button type="button" class="btn ghost" id="refreshBtn" data-id="${esc(person.id)}">再読み込み</button>`);
  showStatus();
  try { localStorage.setItem("wca-last-id", person.id); } catch(e){}
  try { history.replaceState(null, "", location.pathname + "?id=" + encodeURIComponent(person.id)); } catch(e){}
  showHomeHint(person);
  // WCA公式サイトに反映済みの大会を確認してから、残りの大会だけを WCA Live で探す
  let base = {person, comps};
  const api = await recP;
  if (my !== loadToken) return;
  if (api) {
    const posted = mergePosted(person, api);
    if (posted.added.length) {
      const more = await loadPostedComps(posted.added);
      if (my !== loadToken) return;
      base = {person:posted.person, comps:{...comps, ...more}};
      POSTED = posted.added;
      render(base.person, base.comps);
      showStatus(); showHomeHint(person);
    }
  }
  loadLive(base.person, base.comps, my);
}

async function onSearch(input){
  const {q, bad} = cleanQuery(input);
  if (!q) return;
  if (bad) { setStatus("使えない記号が含まれています。氏名（ローマ字や漢字など）か WCA ID を入力してください。", true); return; }
  if (/^\d{4}[a-z]{4}\d{2}$/i.test(q)) return loadId(q.toUpperCase());
  const my = ++loadToken;
  $("#cands").innerHTML = "";
  setStatus(`「${esc(q)}」を検索中…`);
  let list = [];
  try {
    const j = await fetchJSON(WCA_API + "search/users?persons_table=true&q=" + encodeURIComponent(q));
    const arr = Array.isArray(j) ? j : (j.result || []);
    const seen = new Set();
    for (const x0 of arr) {
      const x = x0.person || x0;
      const id = x.wca_id || x.id;
      if (typeof id !== "string" || !/^\d{4}[A-Z]{4}\d{2}$/.test(id) || seen.has(id)) continue;
      seen.add(id); list.push({id, name:str(x.name, 120), country:iso2(x.country_iso2 || x.country?.iso2)});
    }
  } catch(e) {
    if (my !== loadToken) return;
    setStatus("名前検索（WCA公式API）に接続できませんでした。WCA ID（数字4桁＋英字4文字＋数字2桁の10文字）を直接入力してください。", true);
    return;
  }
  if (my !== loadToken) return;
  if (!list.length) { setStatus(`「${esc(q)}」に一致する選手は見つかりませんでした。ローマ字表記やWCA IDでもお試しください。`, true); return; }
  if (list.length === 1) return loadId(list[0].id);
  setStatus(`「${esc(q)}」の候補 ${list.length}件。選手を選んでください。`);
  $("#cands").innerHTML = list.slice(0,30).map(p => `<button type="button" data-id="${esc(p.id)}">${esc(p.name)}<small>${esc(p.id)} · ${esc(regionName(p.country))}</small></button>`).join("");
}

/* ---------- WCA Live: 公式記録に未反映の大会（開催中・終了直後）の速報 ---------- */
const LIVE_API = "https://live.worldcubeassociation.org/api";
const LIVE_DAYS = 35;   // 開始日がこの日数以内の大会を確認する（公式記録への反映には通常数日〜1週間ほどかかる）
const LIVE_FORMATS = {"1":"Best of 1","2":"Best of 2","3":"Best of 3","5":"Best of 5","m":"Mean of 3","a":"Average of 5"};
const LIVE_CR = {"Asia":"AsR","Europe":"ER","North America":"NAR","South America":"SAR","Africa":"AfR","Oceania":"OcR"};
let LIVE = {id:null, state:"idle", comps:[]};

async function gql(query){
  const res = await fetch(LIVE_API, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({query})});
  if (!res.ok) throw new Error("HTTP " + res.status);
  const j = await res.json();
  if (!j.data) throw new Error(j.errors?.[0]?.message || "no data");
  return j.data;
}
function liveRoundName(number, total){
  if (number === total) return "Final";
  if (number === 1) return "First round";
  if (number === 3 && total === 4) return "Semi Final";
  return "Second round";
}
function liveTag(tag, continent){
  if (tag === "WR" || tag === "NR") return tag;
  if (tag === "CR") return LIVE_CR[continent] || "CR";
  return null; // PR（自己ベスト）はこのページで計算するので使わない
}
async function loadLive(person, comps, token){
  const id = person.id;
  LIVE = {id, state:"loading", comps:[]}; updateLiveNote();
  try {
    const now = Date.now();
    const from = new Date(now - LIVE_DAYS*day).toISOString().slice(0,10);
    const until = new Date(now + day).toISOString().slice(0,10);
    const list = (await gql(`{ competitions(from: "${from}") { id wcaId name startDate endDate venues { country { iso2 } } } }`)).competitions || [];
    const known = new Set(Object.keys(person.results || {}));
    const cands = list.filter(c => c.startDate <= until && !known.has(c.wcaId));
    // 参加者一覧からこの選手を探す（まとめて問い合わせる）
    const chunks = [];
    for (let i = 0; i < cands.length; i += 40) chunks.push(cands.slice(i, i + 40));
    const found = [];
    await Promise.all(chunks.map(async ch => {
      const q = "{" + ch.map((c,k) => `c${k}: competition(id: ${JSON.stringify(String(c.id))}) { competitors { id wcaId } }`).join(" ") + "}";
      const d = await gql(q);
      ch.forEach((c,k) => { const p = d[`c${k}`]?.competitors?.find(x => x.wcaId === id); if (p) found.push({comp:c, pid:p.id}); });
    }));
    if (token !== loadToken) return;
    let live = [];
    if (found.length) {
      const q = "{" + found.map((f,k) => `p${k}: person(id: ${JSON.stringify(String(f.pid))}) { country { continentName } results { ranking best average singleRecordTag averageRecordTag attempts { result } round { number finished format { id } competitionEvent { event { id } rounds { id } } } } }`).join(" ") + "}";
      const d = await gql(q);
      live = found.map((f,k) => ({comp:f.comp, p:d[`p${k}`]}));
    }
    if (token !== loadToken) return;
    const merged = mergeLive(person, comps, live);
    LIVE = {id, state:"ok", comps:merged.added, list:list.filter(c => c.startDate <= until)};
    if (merged.added.length) { render(merged.person, merged.comps); computeLiveRanks(); }
  } catch(e) {
    if (token !== loadToken) return;
    LIVE = {id, state:"error", comps:[]};
  }
  updateLiveNote();
}
function mergeLive(person, comps, live){
  const P = {...person, results:{...(person.results || {})}}, C = {...comps}, added = [];
  for (const {comp, p} of live) {
    if (!p || !TOKEN_RE.test(comp.wcaId || "")) continue;
    const cont = str(p.country?.continentName, 40), evs = {};
    if (cont) P.liveContinent = cont;
    let open = false;
    for (const x of Array.isArray(p.results) ? p.results : []) {
      const att = (Array.isArray(x?.attempts) ? x.attempts : []).slice(0, 10).map(a => num(a?.result));
      if (!att.some(v => v !== 0)) continue;           // まだ競技していないラウンド
      const rd = x.round || {}, eid = rd.competitionEvent?.event?.id;
      if (!TOKEN_RE.test(eid || "")) continue;
      if (!rd.finished) open = true;
      (evs[eid] ??= []).push({
        round: liveRoundName(num(rd.number), (rd.competitionEvent.rounds || []).length),
        position: numOrNull(x.ranking), best: num(x.best), average: num(x.average),
        format: LIVE_FORMATS[rd.format?.id] || str(rd.format?.id, 20), solves: att,
        live: true, finished: !!rd.finished,
        liveRecS: liveTag(x.singleRecordTag, cont), liveRecA: liveTag(x.averageRecordTag, cont)
      });
    }
    if (!Object.keys(evs).length) continue;
    P.results[comp.wcaId] = evs;
    C[comp.wcaId] = cleanCompMeta({name:comp.name, city:"", country:comp.venues?.[0]?.country?.iso2, date:comp.startDate, end:comp.endDate, live:true});
    added.push({id:comp.wcaId, name:str(comp.name, 120), open});
  }
  P.numberOfCompetitions = (person.numberOfCompetitions ?? Object.keys(person.results || {}).length) + added.length;
  return {person:P, comps:C, added};
}
function updateLiveNote(){
  const n = $("#liveNote"); if (!n) return;
  n.classList.toggle("err", LIVE.state === "error");
  if (LIVE.state === "loading") n.innerHTML = `<span>WCA Liveで公式記録に未反映の大会を確認中…</span>`;
  else if (LIVE.state === "error") n.innerHTML = `<span>WCA Liveに接続できなかったため、公式記録に未反映の大会の速報は表示していません。</span>`;
  else if (LIVE.state === "ok" && LIVE.comps.length) n.innerHTML = `<b>WCA Live 速報</b><span>${LIVE.comps.map(c => esc(c.name) + (c.open ? "（競技中）" : "")).join("・")} の結果を追加しました。公式記録に反映されるまでは暫定の結果です。</span>`;
  else if (LIVE.state === "ok") n.innerHTML = `<span>WCA Live: 公式記録に未反映の大会はありません（直近${LIVE_DAYS}日）</span>`;
  else n.innerHTML = "";
}
const liveTagHTML = c => c?.live ? ` <span class="tag live" title="WCA Liveの速報。公式記録への反映前の暫定結果です">速報</span>` : "";
const provHTML = r => r.live && !r.finished ? `<span class="prov" title="このラウンドはまだ終わっていません">暫定</span>` : "";

/* ---------- regional record markers (WCA official API) ---------- */
let RECS = {id:null, state:"idle", map:null};
const recKey = (cid, eid, best, avg) => `${cid}|${eid}|${best}|${avg}`;
function recClass(code){ return code === "WR" ? "wr" : code === "NR" ? "nr" : "cr"; }
function badge(code){ return code ? `<span class="rec rec-${recClass(code)}" title="${code === "WR" ? "世界記録" : code === "NR" ? "国内記録" : "大陸記録"}">${esc(code)}</span>` : ""; }
async function loadRecords(id){
  RECS = {id, state:"loading", map:null}; updateRecNote();
  let raw = null;
  try {
    const arr = await fetchJSON(WCA_API + "persons/" + encodeURIComponent(id) + "/results");
    if (RECS.id !== id) return null;
    raw = Array.isArray(arr) ? arr : null;
    const map = new Map();
    for (const x of (Array.isArray(arr) ? arr : [])) {
      if (!x.regional_single_record && !x.regional_average_record) continue;
      map.set(recKey(str(x.competition_id, 64), str(x.event_id, 16), num(x.best), num(x.average)), {s:recCode(x.regional_single_record), a:recCode(x.regional_average_record)});
    }
    RECS = {id, state:"ok", map};
  } catch(e) {
    if (RECS.id !== id) return null;
    RECS = {id, state:"error", map:null};
  }
  if (STATE && STATE.person.id === id) { applyRecs(); renderRecordViews(); }
  updateRecNote();
  return raw;
}

/* ---------- WCA公式サイトに反映済みだが、ミラー（1日1回更新）にまだ入っていない大会 ----------
   WCA公式API（すぐに反映される）の結果に含まれていてミラーに無い大会は、公式記録として取り込む。
   こうした大会は WCA Live の速報としては扱わない。 */
const RT_NAME = {"0":"Qualification round","h":"Qualification round","1":"First round","d":"First round","2":"Second round","e":"Second round",
  "3":"Semi Final","g":"Semi Final","b":"B Final","c":"Final","f":"Final"};
const API_FORMATS = {"1":"Best of 1","2":"Best of 2","3":"Best of 3","5":"Best of 5","m":"Mean of 3","a":"Average of 5"};
let POSTED = [];
function mergePosted(person, arr){
  const have = new Set(Object.keys(person.results || {})), add = {};
  for (const x of arr) {
    if (!x || typeof x !== "object") continue;
    const cid = str(x.competition_id, 64), eid = str(x.event_id, 16);
    if (!TOKEN_RE.test(cid) || !TOKEN_RE.test(eid) || have.has(cid)) continue;
    if (x.wca_id != null && str(x.wca_id, 10).toUpperCase() !== person.id) continue;
    const solves = (Array.isArray(x.attempts) ? x.attempts : []).slice(0, 10)
      .map(a => num(a && typeof a === "object" ? (a.value ?? a.result) : a));
    ((add[cid] ??= {})[eid] ??= []).push({
      round:RT_NAME[str(x.round_type_id, 2)] || "First round", position:numOrNull(x.pos), best:num(x.best), average:num(x.average),
      format:API_FORMATS[str(x.format_id, 2)] || str(x.format_id, 20), solves
    });
  }
  const ids = Object.keys(add);
  if (!ids.length) return {person, added:[]};
  return {person:{...person, results:{...person.results, ...add}, numberOfCompetitions:(person.numberOfCompetitions ?? have.size) + ids.length}, added:ids};
}
async function loadPostedComps(ids){
  // まずミラーの大会情報（大会は告知時点でミラーに入っている）、無ければ WCA公式API から取得する
  const out = await loadComps(ids, () => {});
  await Promise.all(ids.filter(id => !out[id]).map(async id => {
    try {
      const j = await fetchJSON(WCA_API + "competitions/" + encodeURIComponent(id));
      const m = cleanCompMeta({name:j?.name, city:j?.city, country:j?.country_iso2, date:j?.start_date, end:j?.end_date});
      if (m.date) { cachePut(id, m); out[id] = m; }
    } catch(e) {}
  }));
  return out;
}
function applyRecs(){
  if (!STATE) return;
  const ok = RECS.state === "ok" && RECS.id === STATE.person.id;
  for (const r of STATE.rounds) {
    if (r.live) { r.recS = r.liveRecS; r.recA = r.liveRecA; continue; }
    const m = ok ? RECS.map.get(recKey(r.cid, r.eid, r.best, r.average)) : null;
    r.recS = m?.s || null; r.recA = m?.a || null;
  }
}
function updateRecNote(){
  const n = $("#recNote"); if (!n) return;
  n.classList.toggle("err", RECS.state === "error");
  if (RECS.state === "loading") n.textContent = "記録バッジをWCA公式APIから取得中…";
  else if (RECS.state === "error") n.textContent = "WCA公式APIに接続できなかったため、NR・CR・WRバッジは表示されていません。";
  else if (RECS.state === "ok" && STATE) { const c = STATE.rounds.reduce((a,r) => a + (r.recS?1:0) + (r.recA?1:0), 0); n.textContent = `記録バッジ: ${c}件（WCA公式APIより取得）`; }
  else n.textContent = "";
}
function renderRecordViews(){ renderRanking(); renderHistory(); renderLog(); }

/* ---------- analysis ---------- */
function analyze(person, comps){
  const rounds = [];
  for (const [cid, evs] of Object.entries(person.results || {})) {
    const m = comps[cid] || null;
    const date = m?.date || fallbackDate(cid);
    for (const [eid, rs] of Object.entries(evs)) for (const r of rs)
      rounds.push({cid, m, date, eid, round:r.round, ro:RO[r.round] ?? 2, position:r.position, best:r.best, average:r.average, format:r.format, solves:r.solves || [],
        live:!!r.live, finished:r.finished !== false, liveRecS:r.liveRecS || null, liveRecA:r.liveRecA || null});
  }
  rounds.sort((a,b) => a.date.localeCompare(b.date) || a.cid.localeCompare(b.cid) || ev(a.eid).order - ev(b.eid).order || a.ro - b.ro);
  const E = {}; const pbRound = new Map();
  // 表彰台（入賞）は WCA公式と同じ数え方: 終了した決勝で1〜3位、かつ成功した試技がある（best > 0）。
  // 決勝が2つのラウンドに分かれている（リンクされたラウンド）場合も、1大会・1種目につき1回だけ数える。
  const finalSeen = new Set(), podBest = new Map();
  let valid = 0, dnf = 0, dns = 0, timeSum = 0;
  for (const r of rounds) {
    const e = E[r.eid] ??= {eid:r.eid, rounds:[], solves:[], dnf:0, dns:0, finals:0, pod:[0,0,0], pbS:[], pbA:[], comps:new Set(), years:{}};
    e.rounds.push(r); e.comps.add(r.cid);
    if (r.round === "Final") {
      const k = r.cid + "|" + r.eid;
      if (!finalSeen.has(k)) { finalSeen.add(k); e.finals++; }
      if (r.finished && r.best > 0 && r.position >= 1 && r.position <= 3 && (!podBest.has(k) || r.position < podBest.get(k).position)) podBest.set(k, r);
    }
    const y = r.date.slice(0,4);
    const Y = e.years[y] ??= {rounds:0, valid:0, att:0, sum:0, bestS:null, bestA:null, rbSum:0, rbN:0, raSum:0, raN:0, raDnf:0};
    Y.rounds++;
    // ラウンドごとの単発ベスト・平均（DNFのラウンドは平均の計算から除く）
    if (r.best > 0) { Y.rbSum += plotY(r.eid, r.best, false); Y.rbN++; }
    if (r.average > 0) { Y.raSum += plotY(r.eid, r.average, true); Y.raN++; }
    else if (r.average === -1) Y.raDnf++;
    for (const [i, s] of r.solves.entries()) {
      if (s > 0) { e.solves.push({v:s, r, i}); valid++; Y.valid++; Y.att++; Y.sum += plotY(r.eid, s, false); if (ev(r.eid).kind === "time") timeSum += s; }
      else if (s === -1) { e.dnf++; dnf++; Y.att++; }
      else if (s === -2) { e.dns++; dns++; }
    }
    if (r.best > 0) {
      const last = e.pbS.at(-1);
      if (!last || key(r.eid, r.best) < key(r.eid, last.v)) { e.pbS.push({v:r.best, r}); pbRound.set(r, (pbRound.get(r)||"") + "S"); }
      if (Y.bestS === null || key(r.eid, r.best) < key(r.eid, Y.bestS)) Y.bestS = r.best;
    }
    if (r.average > 0) {
      const last = e.pbA.at(-1);
      if (!last || key(r.eid, r.average) < key(r.eid, last.v)) { e.pbA.push({v:r.average, r}); pbRound.set(r, (pbRound.get(r)||"") + "A"); }
      if (Y.bestA === null || key(r.eid, r.average) < key(r.eid, Y.bestA)) Y.bestA = r.average;
    }
  }
  // 入賞の集計（種目ごと・公式記録のみのメダル数）
  const medals = [0, 0, 0];
  for (const r of podBest.values()) { E[r.eid].pod[r.position - 1]++; if (!r.live) medals[r.position - 1]++; }
  // competitions
  const compList = Object.keys(person.results || {}).map(cid => {
    const m = comps[cid];
    const rs = rounds.filter(r => r.cid === cid);
    return {cid, m, date:m?.date || fallbackDate(cid), name:m?.name || cid, city:m?.city || "", country:m?.country || "", rounds:rs};
  }).sort((a,b) => b.date.localeCompare(a.date));
  return {rounds, E, pbRound, compList, medals, totals:{valid, dnf, dns, timeSum}};
}

/* ---------- rendering ---------- */
let STATE = null;
function render(person, comps){
  const A = analyze(person, comps);
  const evIds = Object.keys(A.E).sort((a,b) => ev(a).order - ev(b).order);
  const prevEid = STATE && STATE.person.id === person.id ? STATE.eid : null;
  STATE = {person, comps, ...A, evIds, eid: prevEid && A.E[prevEid] ? prevEid : (A.E["333"] ? "333" : evIds[0]), range:0, logShown:20, rankType: STATE?.rankType || "s", rankDir: STATE?.rankDir || "top"};
  $("#main").hidden = false;
  $("#intro").hidden = true;
  document.title = `${person.name.replace(/\s*\(.*\)$/,"")} — WCA 個人成績ビューア`;
  // ホーム画面に追加したときのアイコン名：現地表記の名前（あれば）か氏名
  const local = (person.name.match(/\(([^)]+)\)\s*$/) || [])[1];
  $("#appTitle").setAttribute("content", local || person.name);
  applyRecs();
  initRankPeriod(!!prevEid);
  renderProfile(); renderTiles(); renderPB(); renderChips(); renderEvent(); renderActivity(); initHistFilters(); renderHistory(); initLogFilters(!!prevEid); renderLog(); updateRecNote();
  rhInit();
}

function renderProfile(){
  const {person, compList} = STATE;
  const first = compList.at(-1), last = compList[0];
  $("#pEyebrow").textContent = regionName(person.country);
  $("#pName").textContent = person.name;
  $("#pMeta").innerHTML = `<a class="idpill" href="https://www.worldcubeassociation.org/persons/${esc(person.id)}" target="_blank" rel="noopener">${esc(person.id)}</a>`
    + (first ? `<span>${esc(first.date.slice(0,7).replace("-","年"))}月 初出場</span><span>最新 ${esc(last.date)}</span>` : "");
  // メダル数は成績から WCA公式と同じ数え方で数える（WCA Live の速報は含めない）
  const md = {gold:STATE.medals[0], silver:STATE.medals[1], bronze:STATE.medals[2]}, rc = person.records || {};
  const recSum = t => ((rc.single||{})[t]||0) + ((rc.average||{})[t]||0);
  const recDetail = t => `単発${(rc.single||{})[t]||0}・平均${(rc.average||{})[t]||0}`;
  let h = [["gold","金"],["silver","銀"],["bronze","銅"]].map(([c,l]) =>
    `<div class="honor"><span class="disc d-${c}">${md[c]||0}</span><small>${l}メダル</small></div>`).join("");
  for (const t of ["WR","CR","NR"]) if (recSum(t)) h += `<div class="honor" title="${recDetail(t)}"><span class="disc d-rec">${recSum(t)}</span><small>${t}</small></div>`;
  $("#pHonors").innerHTML = h;
}

function renderTiles(){
  const {person, compList, totals, evIds} = STATE;
  const countries = new Set(compList.map(c => c.country).filter(c => c && !isMulti(c)));
  const hours = totals.timeSum/100/3600;
  const tiles = [
    ["参加大会", fmtNum(person.numberOfCompetitions ?? compList.length), `選手権 ${person.numberOfChampionships ?? 0}`],
    ["出場種目", evIds.length, `${fmtNum(STATE.rounds.length)} ラウンド`],
    ["有効ソルブ", fmtNum(totals.valid), `DNF ${fmtNum(totals.dnf)}`],
    ["成功率", pct(totals.valid, totals.valid + totals.dnf).toFixed(1) + "%", "DNSを除く"],
    ["競技タイム合計", hours >= 1 ? hours.toFixed(1) + "h" : Math.round(hours*60) + "分", "成功ソルブの合計"],
    ["国・地域", countries.size, `${new Set(compList.map(c=>c.city).filter(Boolean)).size} 都市`]
  ];
  $("#tiles").innerHTML = tiles.map(([k,v,s]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join("");
}

function rankCells(r, ch){
  const c = n => n == null ? `<span class="zero">–</span>` : (n <= 10 ? `<span class="nr">${n}</span>` : fmtNum(n));
  if (!ch) {
    if (!r) return `<td class="num bl"></td><td class="num"></td><td class="num"></td>`;
    return `<td class="num rk">${c(r.world)}</td><td class="num rk">${c(r.continent)}</td><td class="num rk">${c(r.country)}</td>`;
  }
  // 速報で自己ベストを更新した記録：公式の順位→速報の記録での順位
  return ["world", "continent", "country"].map(k => {
    const old = r?.[k] ?? null, x = ch[k];
    let nu;
    if (!x) nu = `<span class="zero" title="計算中">…</span>`;
    else if (x.state === "ok") {
      const why = x.extra == null ? "他の選手の速報は含んでいません"
        : `公式ランキングでの順位 ${fmtNum(x.base)}位＋他の選手の速報で上回った人 ${x.extra}人`;
      if (x.rank === old) return `<td class="num rk" title="${why}">${c(old)}</td>`;
      nu = `<span class="rknew" title="${why}">${fmtNum(x.rank)}</span>`;
    }
    else if (x.state === "beyond") nu = `<span class="zero" title="公式ランキング上位${x.n}人のデータで計算しているため、${x.n}位より下の順位は計算できません">?</span>`;
    else nu = `<span class="zero" title="順位のデータを取得できませんでした">?</span>`;
    return `<td class="num rk"><span class="rkold">${old == null ? "–" : fmtNum(old)}</span><span class="rkarrow">→</span>${nu}</td>`;
  }).join("");
}
/* 速報で公式の自己ベストを上回った記録の一覧 */
function livePBList(){
  const {person, E} = STATE, out = [];
  const rS = {}, rA = {};
  (person.rank?.singles || []).forEach(x => rS[x.eventId] = x);
  (person.rank?.averages || []).forEach(x => rA[x.eventId] = x);
  for (const [id, e] of Object.entries(E)) {
    for (const [type, list, off] of [["single", e.pbS, rS[id]], ["average", e.pbA, rA[id]]]) {
      const last = list.at(-1);
      if (last?.r.live && (!off || key(id, last.v) < key(id, off.best))) out.push({eid:id, type, v:last.v, off:off || null});
    }
  }
  return out;
}
const LIVE_CONT_ID = {"Asia":"asia","Europe":"europe","North America":"north-america","South America":"south-america","Africa":"africa","Oceania":"oceania"};
/* 他の選手の速報：直近の WCA Live の大会から、指定した種目の各選手のベストを集める */
const LIVE_OTHERS = new Map();          // 種目ID -> Promise<Map(選手 -> {wcaId, iso2, cont, single, average})>
let LIVE_OTHERS_STAT = null;            // {comps, rounds}
async function pool(tasks, n){
  let i = 0;
  await Promise.all(Array.from({length:Math.min(n, tasks.length)}, async () => { while (i < tasks.length) await tasks[i++](); }));
}
function liveOthers(eids, comps){
  const need = eids.filter(e => !LIVE_OTHERS.has(e));
  if (need.length) {
    const job = (async () => {
      // 1) 各大会の種目とラウンド
      const rounds = [];
      const cch = []; for (let i = 0; i < comps.length; i += 40) cch.push(comps.slice(i, i + 40));
      await pool(cch.map(ch => async () => {
        const d = await gql("{" + ch.map((c,k) => `c${k}: competition(id: ${JSON.stringify(String(c.id))}) { competitionEvents { event { id } rounds { id } } }`).join(" ") + "}");
        ch.forEach((c,k) => (d[`c${k}`]?.competitionEvents || []).forEach(ce => {
          if (need.includes(ce.event.id)) ce.rounds.forEach(r => rounds.push({rid:r.id, eid:ce.event.id, cid:c.id}));
        }));
      }), 4);
      // 2) 各ラウンドの結果から、選手ごとのベスト（単発・平均）を集める
      const maps = Object.fromEntries(need.map(e => [e, new Map()]));
      const rch = []; for (let i = 0; i < rounds.length; i += 8) rch.push(rounds.slice(i, i + 8));
      await pool(rch.map(ch => async () => {
        const d = await gql("{" + ch.map((r,k) => `r${k}: round(id: ${JSON.stringify(String(r.rid))}) { results { best average person { id wcaId country { iso2 continentName } } } }`).join(" ") + "}");
        ch.forEach((r,k) => (d[`r${k}`]?.results || []).forEach(x => {
          const pp = x.person || {}, pk = pp.wcaId || `${r.cid}:${pp.id}`, m = maps[r.eid];
          const o = m.get(pk) || {wcaId:typeof pp.wcaId === "string" ? pp.wcaId : null, iso2:iso2(pp.country?.iso2) || null, cont:str(pp.country?.continentName, 40) || null, single:0, average:0};
          const xb = num(x.best), xa = num(x.average);
          if (xb > 0 && (!o.single || key(r.eid, xb) < key(r.eid, o.single))) o.single = xb;
          if (xa > 0 && (!o.average || key(r.eid, xa) < key(r.eid, o.average))) o.average = xa;
          m.set(pk, o);
        }));
      }), 4);
      LIVE_OTHERS_STAT = {comps:comps.length, rounds:rounds.length};
      return maps;
    })();
    need.forEach(e => LIVE_OTHERS.set(e, job.then(m => m[e])));
    job.catch(() => need.forEach(e => LIVE_OTHERS.delete(e)));
  }
  return Promise.all(eids.map(e => LIVE_OTHERS.get(e)));
}

/* 速報の記録が何位になるかを計算する
   公式ランキング（ミラーの各地域上位1000人）で上にいる人数 ＋ 他の選手の速報で新たに上回った人数 */
async function computeLiveRanks(){
  const st = STATE; if (!st) return;
  const list = livePBList(); if (!list.length) return;
  st.liveRanks = {}; st.othersState = "loading"; updateOthersNote(st);
  const me = st.person.id, myCont = st.person.liveContinent || null, myCtry = st.person.country || null;
  const regions = {world:"world", continent:LIVE_CONT_ID[myCont] || null, country:myCtry};
  const eids = [...new Set(list.map(x => x.eid))];
  const othersP = liveOthers(eids, LIVE.list || []).then(arr => Object.fromEntries(eids.map((e,i) => [e, arr[i]]))).catch(() => null);

  const official = await Promise.all(list.map(async x => {
    const res = {}, target = key(x.eid, x.v);
    await Promise.all(Object.entries(regions).map(async ([k, reg]) => {
      if (!reg) { res[k] = {state:"err"}; return; }
      try {
        const j = await fetchJSON(DATA_SRC + `rank/${encodeURIComponent(reg)}/${x.type}/${encodeURIComponent(x.eid)}.json`);
        const items = j.items || [], total = j.total ?? items.length;
        // 記録順に並べ、同じ選手の重複や順位が前後するデータを除く
        const arr = items.map((it, n) => ({b:key(x.eid, it.best), r:it.rank?.[k], p:it.personId, n}))
          .filter(o => o.r != null).sort((a, b) => a.b - b.b || a.r - b.r || a.n - b.n);
        const clean = [], seen = new Set();
        for (const o of arr) {
          const last = clean.at(-1);
          if (seen.has(o.p) || (last && o.r < last.r)) continue;
          seen.add(o.p); clean.push(o);
        }
        const better = new Set(clean.filter(o => o.b < target).map(o => o.p));   // 公式ですでに上にいる選手
        // 速報の記録以上（同記録を含む）で最も良い人の順位が、公式だけで見た順位になる
        const f = clean.find(o => o.b >= target);
        if (f) res[k] = {state:"ok", rank:f.r, better};
        else if (items.length >= total) res[k] = {state:"ok", rank:clean.length + 1, better};
        else res[k] = {state:"beyond", n:items.length};
      } catch(e) { res[k] = {state:"err"}; }
    }));
    return {x, res, target};
  }));

  const others = await othersP;
  for (const {x, res, target} of official) {
    for (const k of Object.keys(res)) {
      const o = res[k]; if (o.state !== "ok") continue;
      o.base = o.rank;
      if (!others) continue;
      let extra = 0;
      for (const p of (others[x.eid]?.values() || [])) {
        if (p.wcaId === me) continue;
        if (k === "continent" && p.cont !== myCont) continue;
        if (k === "country" && p.iso2 !== myCtry) continue;
        const v = x.type === "single" ? p.single : p.average;
        if (!(v > 0) || key(x.eid, v) >= target) continue;
        if (p.wcaId && o.better.has(p.wcaId)) continue;   // 公式ですでに数えている
        extra++;
      }
      o.extra = extra; o.rank = o.base + extra;
    }
    (st.liveRanks[x.eid] ??= {})[x.type] = res;
  }
  st.othersState = others ? "ok" : "error";
  if (STATE === st) { renderPB(); updateOthersNote(st); }
}
function updateOthersNote(st){
  const n = $("#pbOthersNote"); if (!n || STATE !== st) return;
  n.classList.toggle("err", st.othersState === "error");
  n.textContent = st.othersState === "loading" ? "他の選手の速報を確認中…"
    : st.othersState === "error" ? "他の選手の速報を取得できなかったため、公式ランキングだけで計算しています。"
    : st.othersState === "ok" && LIVE_OTHERS_STAT ? `他の選手の速報: ${LIVE_OTHERS_STAT.comps}大会・${LIVE_OTHERS_STAT.rounds}ラウンドを確認しました。` : "";
}
function podHTML(p){
  const cls = ["gold","silver","bronze"];
  return `<span class="pods">${p.map((n,i) => `<span class="${n?"":"zero"}"><i class="d-${cls[i]}" aria-hidden="true"></i><span>${n}</span></span>`).join("")}</span>`;
}
function renderPB(){
  const {person, E, evIds} = STATE;
  const rS = {}, rA = {};
  (person.rank?.singles || []).forEach(x => rS[x.eventId] = x);
  (person.rank?.averages || []).forEach(x => rA[x.eventId] = x);
  const ids = [...new Set([...evIds, ...Object.keys(rS)])].sort((a,b) => ev(a).order - ev(b).order);
  let h = `<thead><tr><th class="l" rowspan="2">種目</th><th class="grp" colspan="4">単発</th><th class="grp" colspan="4">平均</th><th class="bl" rowspan="2">大会</th><th rowspan="2">表彰台<br>金・銀・銅</th></tr>
  <tr><th class="bl">記録</th><th>世界</th><th>大陸</th><th>国内</th><th class="bl">記録</th><th>世界</th><th>大陸</th><th>国内</th></tr></thead><tbody>`;
  for (const id of ids) {
    const e = E[id]; const s = rS[id], a = rA[id];
    const lastS = e?.pbS.at(-1), lastA = e?.pbA.at(-1);
    const liveS = lastS?.r.live && (!s || key(id, lastS.v) < key(id, s.best)), liveA = lastA?.r.live && (!a || key(id, lastA.v) < key(id, a.best));
    const bestS = liveS ? lastS.v : (s?.best ?? lastS?.v), bestA = liveA ? lastA.v : (a?.best ?? lastA?.v);
    const liveMark = (on, off) => on ? ` <span class="tag live" title="WCA Liveの速報で自己ベストを更新。${off ? "公式記録は " + off + "。" : ""}">速報</span>` : "";
    h += `<tr data-eid="${esc(id)}" class="${id===STATE.eid?"sel":""}" tabindex="0"><td class="l"><span class="evname">${esc(ev(id).name)}</span></td>
      <td class="num bl"><b>${bestS ? fmtVal(id, bestS, false) : ""}</b>${liveMark(liveS, s ? fmtVal(id, s.best, false) : "")}</td>${liveS ? rankCells(s?.rank, STATE.liveRanks?.[id]?.single || {}) : s ? rankCells(s.rank) : '<td></td><td></td><td></td>'}
      <td class="num bl"><b>${bestA ? fmtVal(id, bestA, true) : ""}</b>${liveMark(liveA, a ? fmtVal(id, a.best, true) : "")}</td>${liveA ? rankCells(a?.rank, STATE.liveRanks?.[id]?.average || {}) : a ? rankCells(a.rank) : '<td></td><td></td><td></td>'}
      <td class="num bl">${e ? e.comps.size : ""}</td><td>${e ? podHTML(e.pod) : ""}</td></tr>`;
  }
  $("#pbTable").innerHTML = h + "</tbody>";
  $("#pbLiveNote").hidden = !livePBList().length;
  $("#pbDataDate").textContent = MIRROR_DATE ? `・${MIRROR_DATE} 時点` : "";
}

function renderChips(){
  $("#evChips").innerHTML = STATE.evIds.map(id => `<button type="button" class="chip" data-eid="${esc(id)}" aria-pressed="${id===STATE.eid}">${esc(ev(id).name)}</button>`).join("");
}
function selectEvent(id, scroll){
  if (!STATE.E[id]) return;
  STATE.eid = id;
  document.querySelectorAll("#evChips .chip").forEach(b => b.setAttribute("aria-pressed", b.dataset.eid === id));
  document.querySelectorAll("#pbTable tbody tr").forEach(tr => tr.classList.toggle("sel", tr.dataset.eid === id));
  renderEvent();
  if (scroll && $("#secEvent").classList.contains("collapsed")) setFold($("#secEvent"), false);
  if (scroll) $("#secEvent").scrollIntoView({behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block:"start"});
}

function median(arr){ if (!arr.length) return null; const a = [...arr].sort((x,y)=>x-y); const m = a.length>>1; return a.length%2 ? a[m] : (a[m-1]+a[m])/2; }
function compLabel(r){ return r.m?.name || r.cid; }

function renderEvent(){
  const {E, eid} = STATE; const e = E[eid]; const name = ev(eid).name; const kind = ev(eid).kind;
  const vals = e.solves.map(s => plotY(eid, s.v, false));
  const mean = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
  const med = median(vals);
  const firstA = e.pbA[0], pbA = e.pbA.at(-1);
  const improve = firstA && pbA && firstA !== pbA ? (() => {
    const a = plotY(eid, firstA.v, true), b = plotY(eid, pbA.v, true);
    return kind === "mbf" ? `${fmtPlot(eid,a)} → ${fmtPlot(eid,b)}` : `${fmtVal(eid,firstA.v,true)} → ${fmtVal(eid,pbA.v,true)}（−${(100*(a-b)/a).toFixed(1)}%）`;
  })() : "–";
  const lastR = e.rounds.at(-1);
  const rows = [
    ["出場大会 / ラウンド", `${e.comps.size} / ${e.rounds.length}`],
    ["決勝進出", `${e.finals} 回`],
    ["表彰台（金・銀・銅）", `${e.pod.join("・")}`],
    ["有効ソルブ", fmtNum(vals.length)],
    ["DNF / DNS", `${e.dnf} / ${e.dns}`],
    ["成功率", `${pct(vals.length, vals.length + e.dnf).toFixed(1)}%`],
    [kind === "mbf" ? "成功時の平均ポイント" : "全成功ソルブの平均", mean == null ? "–" : fmtPlot(eid, mean)],
    ["中央値", med == null ? "–" : fmtPlot(eid, med)],
    ["PB更新回数（単発 / 平均）", `${e.pbS.length} / ${e.pbA.length}`],
    ["初の平均 → 平均PB", improve],
    ["最終出場", lastR ? lastR.date : "–"]
  ];
  $("#evStats").innerHTML = rows.map(([k,v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");

  renderRanking();

  renderYearTable();
  drawProg(); drawHist();
}

/* ランキングの期間 */
function initRankPeriod(keep){
  const sel = $("#rankPeriod"), prev = keep ? sel.value : "all";
  const ys = [...new Set(STATE.rounds.map(r => r.date.slice(0,4)))].sort().reverse();
  sel.innerHTML = `<option value="all">全期間</option><option value="r1">直近1年</option><option value="r3">直近3年</option>`
    + `<optgroup label="年">${ys.map(y => `<option value="y${y}">${y}年</option>`).join("")}</optgroup>`
    + `<option value="custom">期間を指定…</option>`;
  sel.value = [...sel.options].some(o => o.value === prev) ? prev : "all";
  const first = STATE.rounds[0]?.date, last = STATE.rounds.at(-1)?.date;
  for (const id of ["#rankFrom", "#rankTo"]) { const el = $(id); el.min = first || ""; el.max = last || ""; }
  if (!keep || !$("#rankFrom").value) $("#rankFrom").value = first || "";
  if (!keep || !$("#rankTo").value) $("#rankTo").value = last || "";
  $("#rankCustom").hidden = sel.value !== "custom";
}
function rankRange(){
  const v = $("#rankPeriod").value;
  if (!v || v === "all" || !STATE.rounds.length) return null;
  if (v === "r1" || v === "r3") {
    // 直近N年は、この選手の最新の大会日を基準にする（推移グラフと同じ）
    const last = STATE.rounds.at(-1).date; const d = new Date(toT(last)); d.setUTCFullYear(d.getUTCFullYear() - (v === "r1" ? 1 : 3));
    const from = d.toISOString().slice(0,10);
    return {from, to:null, label:`直近${v === "r1" ? 1 : 3}年（${from}〜）`};
  }
  if (v[0] === "y") { const y = v.slice(1); return {from:`${y}-01-01`, to:`${y}-12-31`, label:`${y}年`}; }
  let from = $("#rankFrom").value || null, to = $("#rankTo").value || null;
  if (from && to && from > to) [from, to] = [to, from];
  return {from, to, label:`${from || "最初"}〜${to || "最新"}`};
}

function renderRanking(){
  const {E, eid} = STATE; const e = E[eid];
  const avgRounds = e.rounds.filter(r => r.average > 0);
  const btnA = document.querySelector('#rankSeg button[data-t="a"]');
  btnA.disabled = !avgRounds.length;
  btnA.textContent = avgRounds.length && avgRounds.every(r => r.format === "Mean of 3") ? "平均 Mean" : "平均 Average";
  btnA.title = avgRounds.length ? "" : "この種目には平均記録がありません";
  const t = avgRounds.length ? STATE.rankType : "s";
  document.querySelectorAll("#rankSeg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.t === t));
  const pbS = new Map(e.pbS.map(p => [p.r, p.v])), pbA = new Map(e.pbA.map(p => [p.r, p.v]));
  let items;
  if (t === "s") items = e.solves.map(s => ({v:s.v, r:s.r, i:s.i, pb: pbS.get(s.r) === s.v && s.r.best === s.v}));
  else items = avgRounds.map(r => ({v:r.average, r, pb: pbA.has(r)}));
  // the earliest equal solve within a round is the one that set the PB
  if (t === "s") {
    const seen = new Set(); items.forEach(x => { if (x.pb) { if (seen.has(x.r)) x.pb = false; else seen.add(x.r); } });
    const firstBest = new Set(); items.forEach(x => { if (x.v === x.r.best && !firstBest.has(x.r)) { firstBest.add(x.r); x.first = true; } });
  }
  const R = rankRange();
  if (R) items = items.filter(x => (!R.from || x.r.date >= R.from) && (!R.to || x.r.date <= R.to));
  const worst = STATE.rankDir === "worst";
  const dir = worst ? -1 : 1;
  items.sort((a,b) => dir * (key(eid,a.v) - key(eid,b.v)) || a.r.date.localeCompare(b.r.date) || a.r.ro - b.r.ro || (a.i ?? 0) - (b.i ?? 0));
  let prevK = null, rank = 0;
  items.forEach((x, n) => { const k = key(eid, x.v); if (k !== prevK) { rank = n + 1; prevK = k; } x.rank = rank; });
  const top = items.slice(0, 100);
  const unit = t === "s" ? "ソルブ" : "回";
  document.querySelectorAll("#rankDir button").forEach(b => b.setAttribute("aria-pressed", (b.dataset.d === "worst") === worst));
  $("#rankTitle").textContent = worst ? "記録ランキング ワースト 100" : "記録ランキング Top 100";
  const span = R ? `${R.label}の` : "全期間の";
  $("#rankNoteLead").textContent = worst
    ? `この選手の${span}公式記録を悪い順に並べています（DNF・DNSは含みません）。`
    : `この選手の${span}公式記録を良い順に並べています。`;
  $("#rankCount").textContent = items.length ? `${R ? R.label + "・" : ""}全${fmtNum(items.length)}${unit}中 ${worst ? "下位" : "上位"}${top.length}件` : "";
  const isAvg = t === "a";
  let h = `<thead><tr><th class="l">${worst ? "ワースト" : "順位"}</th><th>${isAvg ? "平均" : "単発"}</th><th class="l">日付</th><th class="l">大会</th><th class="l">ラウンド</th><th class="l">${isAvg ? "内訳" : "試技"}</th></tr></thead><tbody>`;
  h += top.map(x => {
    const r = x.r;
    const detail = isAvg ? `<td class="solves">${solvesHTML(r)}</td>` : `<td class="l num">${(x.i ?? 0) + 1}本目 <span class="zero">/ ${r.solves.filter(v => v !== 0).length}</span></td>`;
    return `<tr class="${x.rank <= 3 && !worst ? "top3" : ""}"><td class="pos l">${x.rank}</td><td class="val">${esc(fmtVal(eid, x.v, isAvg))}${badge(isAvg ? r.recA : (x.first ? r.recS : null))}${x.pb ? ' <span class="tag pb">PB</span>' : ""}</td>
      <td class="l num">${esc(r.date)}</td><td class="l cmp" title="${esc(compLabel(r))}">${esc(compLabel(r))}${liveTagHTML(r.m)}</td>
      <td class="l">${esc(RJ[r.round] || r.round)} <span class="zero">${esc(FJ[r.format] || "")}</span>${provHTML(r)}</td>${detail}</tr>`;
  }).join("");
  if (!top.length) h += `<tr><td class="l" colspan="6"><span class="zero">${R ? "この期間の記録はありません" : "記録なし"}</span></td></tr>`;
  $("#rankTable").innerHTML = h + "</tbody>";
  document.querySelector(".rankwrap").scrollTop = 0;
}

function renderYearTable(){
  const {E, eid} = STATE; const e = E[eid];
  const ys = Object.keys(e.years).sort().reverse();
  const mbf = ev(eid).kind === "mbf";
  const hasAvg = e.rounds.some(r => r.average !== 0);
  let h = `<thead><tr><th class="l">年</th><th>ラウンド</th><th>有効ソルブ</th><th>成功率</th><th>${mbf?"平均ポイント":"ソルブ平均"}</th>
    <th class="bl">ラウンド単発ベストの平均</th>${hasAvg ? `<th>ラウンド平均の平均</th>` : ""}<th class="bl">年間ベスト単発</th>${hasAvg ? `<th>年間ベスト平均</th>` : ""}</tr></thead><tbody>`;
  for (const y of ys) {
    const Y = e.years[y];
    const rb = Y.rbN ? `<span title="単発ベストのあるラウンド ${Y.rbN}回の平均">${esc(fmtPlot(eid, Y.rbSum/Y.rbN))}</span>` : "–";
    const ra = Y.raN ? `<span title="平均が出たラウンド ${Y.raN}回の平均${Y.raDnf ? `（DNF ${Y.raDnf}回は除外）` : ""}">${esc(fmtPlot(eid, Y.raSum/Y.raN))}</span><span class="ast"${Y.raDnf ? "" : ' aria-hidden="true" style="visibility:hidden"'}>*</span>` : `–<span class="ast" aria-hidden="true" style="visibility:hidden">*</span>`;
    h += `<tr><td class="l num">${y}</td><td class="num">${Y.rounds}</td><td class="num">${Y.valid}</td><td class="num">${Y.att ? pct(Y.valid,Y.att).toFixed(0)+"%" : "–"}</td>
      <td class="num">${Y.valid ? esc(fmtPlot(eid, Y.sum/Y.valid)) : "–"}</td>
      <td class="num bl">${rb}</td>${hasAvg ? `<td class="num">${ra}</td>` : ""}
      <td class="num bl">${Y.bestS ? esc(fmtVal(eid,Y.bestS,false)) : "–"}</td>${hasAvg ? `<td class="num">${Y.bestA ? esc(fmtVal(eid,Y.bestA,true)) : "–"}</td>` : ""}</tr>`;
  }
  const cap = `ラウンド単発ベストの平均：各ラウンドで一番良かった単発をその年のラウンド数で平均。`
    + (hasAvg ? `ラウンド平均の平均：各ラウンドの平均（Ao5・Mo3）をその年で平均。平均がDNFのラウンドは除外し、除外があった年に * を付けています。` : "");
  $("#yearTable").innerHTML = `<caption class="ycap">${cap}</caption>` + h + "</tbody>";
}

/* ---------- charts (hand-built SVG) ---------- */
function niceStep(raw){ const mag = 10 ** Math.floor(Math.log10(raw)); const f = raw/mag; return (f >= 7.5 ? 10 : f >= 3.5 ? 5 : f >= 2.25 ? 2.5 : f >= 1.5 ? 2 : 1) * mag; }
function niceTicks(lo, hi, n){
  if (lo === hi) { lo -= 1; hi += 1; }
  const step = niceStep((hi-lo)/n);
  const a = Math.floor(lo/step)*step, b = Math.ceil(hi/step)*step; const t = [];
  for (let v = a; v <= b + step/2; v += step) t.push(+v.toFixed(10));
  return {lo:a, hi:b, ticks:t};
}
const day = 864e5;
const toT = d => Date.parse(d + "T00:00:00Z");
function rangeStart(){
  if (!STATE.range) return null;
  const last = STATE.rounds.at(-1).date; const d = new Date(toT(last)); d.setUTCFullYear(d.getUTCFullYear() - STATE.range);
  return d.toISOString().slice(0,10);
}
function tipAt(wrap, html, x, y){
  let t = wrap.querySelector(".tip"); if (!t) { t = document.createElement("div"); t.className = "tip"; wrap.appendChild(t); }
  t.innerHTML = html; t.hidden = false;
  const W = wrap.clientWidth; const tw = t.offsetWidth, th = t.offsetHeight;
  let left = x + 14; if (left + tw > W - 4) left = x - tw - 14; if (left < 4) left = 4;
  let top = y - th - 10; if (top < 0) top = y + 14;
  t.style.left = left + "px"; t.style.top = top + "px";
}
function hideTip(wrap){ const t = wrap.querySelector(".tip"); if (t) t.hidden = true; }

function drawProg(){
  const {E, eid} = STATE; const e = E[eid]; const el = $("#progChart"); const wrap = el.parentElement;
  const hasAvg = e.pbA.length > 0;
  $("#progLegend").innerHTML = `<span><i style="background:var(--accent)"></i>単発PB</span>` + (hasAvg ? `<span><i style="background:var(--avg)"></i>平均PB</span>` : "")
    + `<span><i class="dot" style="background:var(--accent)"></i>各ラウンドの単発</span>` + (hasAvg ? `<span><i class="dot" style="background:var(--avg)"></i>各ラウンドの平均</span>` : "");
  $("#progTitle").textContent = `記録の推移（${unitOf(eid)}${ev(eid).kind==="mbf" ? "・上ほど良い" : "・下ほど速い"}）`;
  const from = rangeStart();
  const rs = e.rounds.filter(r => !from || r.date >= from);
  if (!rs.length) { el.innerHTML = `<p class="note">この期間に出場記録はありません。</p>`; return; }
  const W = Math.max(280, el.clientWidth), H = W < 520 ? 230 : 290;
  const M = {l:46, r:50, t:10, b:24};
  const pts = [];
  for (const r of rs) {
    if (r.best > 0) pts.push({t:toT(r.date), y:plotY(eid, r.best, false), k:"s", r});
    if (r.average > 0) pts.push({t:toT(r.date), y:plotY(eid, r.average, true), k:"a", r});
  }
  const lastT = toT(STATE.rounds.at(-1).date);
  function seq(list, isAvg){
    const out = []; let prior = null;
    for (const p of list) { if (from && p.r.date < from) { prior = p; continue; } out.push(p); }
    const s = []; if (prior) s.push({t:toT(from), y:plotY(eid, prior.v, isAvg), p:prior, carry:true});
    out.forEach(p => s.push({t:toT(p.r.date), y:plotY(eid, p.v, isAvg), p}));
    return s;
  }
  const sS = seq(e.pbS, false), sA = seq(e.pbA, true);
  let t0 = from ? toT(from) : Math.min(...pts.map(p=>p.t)), t1 = lastT;
  if (t1 - t0 < 60*day) { t0 -= 30*day; t1 += 30*day; }
  const ys = [...pts.map(p=>p.y), ...sS.map(p=>p.y), ...sA.map(p=>p.y)];
  const yt = niceTicks(Math.min(...ys), Math.max(...ys), 5);
  const X = t => M.l + (t - t0) / (t1 - t0) * (W - M.l - M.r);
  const Y = y => M.t + (1 - (y - yt.lo) / (yt.hi - yt.lo)) * (H - M.t - M.b);
  // x ticks
  const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear();
  let xt = [];
  if (y1 - y0 >= 2) { const every = Math.ceil((y1 - y0 + 1) / Math.max(2, Math.floor((W-60)/56))); for (let y = y0; y <= y1; y++) { const t = Date.UTC(y,0,1); if (t >= t0 && t <= t1 && (y - y0) % every === 0) xt.push([t, String(y)]); } if (!xt.length) xt.push([t0, String(y0)]); }
  else { const d = new Date(t0); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth()+1); const step = W < 520 ? 3 : 2; while (d.getTime() <= t1) { if (d.getUTCMonth() % step === 0) xt.push([d.getTime(), `${d.getUTCFullYear()}/${d.getUTCMonth()+1}`]); d.setUTCMonth(d.getUTCMonth()+1); } }
  const stepPath = s => { if (!s.length) return ""; let d = `M${X(s[0].t).toFixed(1)},${Y(s[0].y).toFixed(1)}`; for (let i = 1; i < s.length; i++) d += `H${X(s[i].t).toFixed(1)}V${Y(s[i].y).toFixed(1)}`; return d + `H${X(t1).toFixed(1)}`; };
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(ev(eid).name)}の記録推移">`;
  svg += `<g class="grid">${yt.ticks.map(v => `<line x1="${M.l}" x2="${W-M.r}" y1="${Y(v)}" y2="${Y(v)}"/>`).join("")}</g>`;
  svg += `<g class="axis">${yt.ticks.map(v => `<text x="${M.l-6}" y="${Y(v)+4}" text-anchor="end">${tickLabel(eid, v)}</text>`).join("")}`;
  svg += xt.map(([t,l]) => `<text x="${X(t)}" y="${H-6}" text-anchor="middle">${l}</text>`).join("") + `</g>`;
  svg += pts.map(p => `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="2.6" fill="${p.k==="s"?"var(--accent)":"var(--avg)"}" fill-opacity=".32"/>`).join("");
  if (sA.length) svg += `<path d="${stepPath(sA)}" fill="none" stroke="var(--avg)" stroke-width="2" stroke-linejoin="round"/>`;
  svg += `<path d="${stepPath(sS)}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>`;
  for (const [s,c] of [[sA,"var(--avg)"],[sS,"var(--accent)"]]) svg += s.filter(p=>!p.carry).map(p => `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="4" fill="${c}" stroke="var(--surface)" stroke-width="2"/>`).join("");
  // endpoint labels for current PBs, placed in the right margin and kept apart
  const labs = [];
  if (sS.length) labs.push({y:Y(sS.at(-1).y), txt:fmtVal(eid, sS.at(-1).p.v, false), c:"var(--accent)"});
  if (sA.length) labs.push({y:Y(sA.at(-1).y), txt:fmtVal(eid, sA.at(-1).p.v, true), c:"var(--avg)"});
  labs.sort((a,b) => a.y - b.y);
  if (labs.length === 2 && labs[1].y - labs[0].y < 14) { const mid = (labs[0].y + labs[1].y)/2; labs[0].y = mid - 7; labs[1].y = mid + 7; }
  svg += labs.map(l => `<text x="${X(t1)+6}" y="${l.y+4}" style="fill:var(--ink);font:600 11px var(--f-mono)">${esc(l.txt)}</text>`).join("");
  svg += `<circle id="progHi" r="6" fill="none" stroke="var(--ink)" stroke-width="2" visibility="hidden"/>`;
  svg += `<rect x="${M.l}" y="0" width="${W-M.l-M.r}" height="${H-M.b}" fill="transparent" id="progHit"/></svg>`;
  el.innerHTML = svg;
  const hit = el.querySelector("#progHit"), hi = el.querySelector("#progHi");
  const P = pts.map(p => ({...p, px:X(p.t), py:Y(p.y)}));
  hit.addEventListener("pointermove", ev2 => {
    const box = el.querySelector("svg").getBoundingClientRect(); const sx = W / box.width;
    const mx = (ev2.clientX - box.left) * sx, my = (ev2.clientY - box.top) * sx;
    let best = null, bd = Infinity;
    for (const p of P) { const d = (p.px-mx)**2 + ((p.py-my)*0.6)**2; if (d < bd) { bd = d; best = p; } }
    if (!best || bd > 50*50) { hi.setAttribute("visibility","hidden"); hideTip(wrap); return; }
    hi.setAttribute("cx", best.px); hi.setAttribute("cy", best.py); hi.setAttribute("visibility","visible");
    const r = best.r; const tag = STATE.pbRound.get(r) || "";
    const wr = wrap.getBoundingClientRect();
    tipAt(wrap, `<div class="t">${esc(r.date)} · ${esc(RJ[r.round]||r.round)}</div><div>${esc(compLabel(r))}</div>
      <div>単発 <b>${esc(fmtVal(eid,r.best,false))}</b>${tag.includes("S")?" ★PB":""}${r.average>0?` / 平均 <b>${esc(fmtVal(eid,r.average,true))}</b>${tag.includes("A")?" ★PB":""}`:""}</div>
      <div class="t">${r.position}位</div>`, ev2.clientX - wr.left, ev2.clientY - wr.top);
  });
  hit.addEventListener("pointerleave", () => { hi.setAttribute("visibility","hidden"); hideTip(wrap); });
}

function drawHist(){
  const {E, eid} = STATE; const e = E[eid]; const el = $("#histChart"); const wrap = el.parentElement;
  const kind = ev(eid).kind;
  $("#histTitle").textContent = kind === "mbf" ? "ポイント分布（成功試技）" : `ソルブ分布（成功ソルブ・${unitOf(eid)}）`;
  const from = rangeStart();
  const vals = e.solves.filter(s => !from || s.r.date >= from).map(s => plotY(eid, s.v, false)).sort((a,b)=>a-b);
  if (vals.length < 3) { el.innerHTML = `<p class="note">分布を描くにはソルブ数が足りません（${vals.length}件）。</p>`; return; }
  const W = Math.max(260, el.clientWidth), H = W < 520 ? 230 : 290;
  const M = {l:34, r:10, t:10, b:24};
  const lo0 = vals[0], hiQ = vals[Math.floor(0.97*(vals.length-1))];
  let w = (kind === "mbf" || kind === "fm") ? Math.max(1, niceStep(Math.max(1,(hiQ-lo0))/16)) : niceStep(Math.max(0.01,(hiQ-lo0))/16);
  if (kind === "mbf" || kind === "fm") w = Math.max(1, Math.round(w));
  const start = Math.floor(lo0 / w) * w; let nb = Math.max(1, Math.ceil((hiQ - start) / w + 1e-9));
  if (kind === "mbf" || kind === "fm") nb = Math.max(1, Math.floor((hiQ - start) / w) + 1);
  const bins = Array.from({length:nb}, (_,i) => ({a:start+i*w, b:start+(i+1)*w, n:0, over:false}));
  let over = 0;
  for (const v of vals) { const i = Math.floor((v - start) / w + 1e-9); if (i >= nb) over++; else bins[Math.max(0,i)].n++; }
  if (over) bins.push({a:start+nb*w, b:Infinity, n:over, over:true});
  const maxN = Math.max(...bins.map(b=>b.n));
  const yt = niceTicks(0, maxN, 4);
  const bw = (W - M.l - M.r) / bins.length;
  const Y = n => M.t + (1 - n / yt.hi) * (H - M.t - M.b);
  const discrete = kind === "mbf" || kind === "fm";
  const lab = v => discrete ? String(+v.toFixed(2)) : tickLabel(eid, v);
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="ソルブ分布">`;
  svg += `<g class="grid">${yt.ticks.map(v => `<line x1="${M.l}" x2="${W-M.r}" y1="${Y(v)}" y2="${Y(v)}"/>`).join("")}</g><g class="axis">`;
  svg += yt.ticks.map(v => `<text x="${M.l-6}" y="${Y(v)+4}" text-anchor="end">${v}</text>`).join("");
  const every = Math.ceil(bins.length / Math.max(2, Math.floor((W - M.l) / 52)));
  bins.forEach((b,i) => { if (i % every === 0) svg += `<text x="${M.l + i*bw + (discrete ? bw/2 : 0)}" y="${H-6}" text-anchor="${discrete?"middle":"start"}">${b.over ? "超" : lab(b.a)}</text>`; });
  svg += `</g>`;
  bins.forEach((b,i) => {
    if (!b.n) return;
    const x = M.l + i*bw + 1, wdt = Math.max(1, bw - 2), y = Y(b.n), h = H - M.b - y;
    const r = Math.min(3, wdt/2, h);
    svg += `<path d="M${x},${H-M.b}V${y+r}Q${x},${y} ${x+r},${y}H${x+wdt-r}Q${x+wdt},${y} ${x+wdt},${y+r}V${H-M.b}Z" fill="${b.over?"var(--faint)":"var(--accent)"}" data-i="${i}"/>`;
  });
  svg += `<rect x="${M.l}" y="0" width="${W-M.l-M.r}" height="${H-M.b}" fill="transparent" id="histHit"/></svg>`;
  el.innerHTML = svg;
  const hit = el.querySelector("#histHit");
  const u = unitOf(eid);
  hit.addEventListener("pointermove", ev2 => {
    const box = el.querySelector("svg").getBoundingClientRect(); const sx = W / box.width;
    const i = Math.floor(((ev2.clientX - box.left) * sx - M.l) / bw);
    const b = bins[i]; if (!b) { hideTip(wrap); return; }
    el.querySelectorAll("path[data-i]").forEach(p => p.setAttribute("fill-opacity", +p.dataset.i === i ? "1" : ".55"));
    const range = b.over ? `${lab(b.a)}${u === "秒" ? "" : u} 以上` : discrete ? (w === 1 ? `${b.a}${u}` : `${b.a}〜${b.b-1}${u}`) : `${lab(b.a)}〜${lab(b.b)}`;
    const wr = wrap.getBoundingClientRect();
    tipAt(wrap, `<div class="t">${esc(range)}</div><div><b>${b.n}</b> 回（${pct(b.n, vals.length).toFixed(1)}%）</div>`, ev2.clientX - wr.left, ev2.clientY - wr.top);
  });
  hit.addEventListener("pointerleave", () => { el.querySelectorAll("path[data-i]").forEach(p => p.removeAttribute("fill-opacity")); hideTip(wrap); });
}

function drawYears(){
  const {compList} = STATE; const el = $("#yearChart"); const wrap = el.parentElement;
  const by = {}; compList.forEach(c => { const y = c.date.slice(0,4); (by[y] ??= []).push(c); });
  const yrs = Object.keys(by).map(Number); if (!yrs.length) { el.innerHTML = ""; return; }
  const all = []; for (let y = Math.min(...yrs); y <= Math.max(...yrs); y++) all.push({y, list:by[y] || []});
  const W = Math.max(260, el.clientWidth), H = 220, M = {l:30, r:8, t:18, b:24};
  const maxN = Math.max(...all.map(a => a.list.length)); const yt = niceTicks(0, maxN, 4);
  const bw = (W - M.l - M.r) / all.length; const Y = n => M.t + (1 - n/yt.hi) * (H - M.t - M.b);
  const every = Math.ceil(all.length / Math.max(2, Math.floor((W - M.l) / 40)));
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="年別の参加大会数">`;
  svg += `<g class="grid">${yt.ticks.map(v => `<line x1="${M.l}" x2="${W-M.r}" y1="${Y(v)}" y2="${Y(v)}"/>`).join("")}</g><g class="axis">`;
  svg += yt.ticks.map(v => `<text x="${M.l-6}" y="${Y(v)+4}" text-anchor="end">${v}</text>`).join("");
  all.forEach((a,i) => { if (i % every === 0) svg += `<text x="${M.l + i*bw + bw/2}" y="${H-6}" text-anchor="middle">${W < 480 ? "'" + String(a.y).slice(2) : a.y}</text>`; });
  svg += `</g>`;
  const maxI = all.findIndex(a => a.list.length === maxN);
  all.forEach((a,i) => {
    const n = a.list.length; if (!n) return;
    const pad = Math.min(8, bw*0.18), x = M.l + i*bw + pad, wdt = Math.max(2, bw - 2*pad), y = Y(n), h = H - M.b - y, r = Math.min(4, wdt/2, h);
    svg += `<path d="M${x},${H-M.b}V${y+r}Q${x},${y} ${x+r},${y}H${x+wdt-r}Q${x+wdt},${y} ${x+wdt},${y+r}V${H-M.b}Z" fill="var(--accent)" data-i="${i}"/>`;
    if (i === maxI) svg += `<text x="${x+wdt/2}" y="${y-5}" text-anchor="middle" style="fill:var(--ink);font:600 11.5px var(--f-mono)">${n}</text>`;
  });
  svg += `<rect x="${M.l}" y="0" width="${W-M.l-M.r}" height="${H-M.b}" fill="transparent" id="yearHit"/></svg>`;
  el.innerHTML = svg;
  el.querySelector("#yearHit").addEventListener("pointermove", ev2 => {
    const box = el.querySelector("svg").getBoundingClientRect(); const sx = W / box.width;
    const i = Math.floor(((ev2.clientX - box.left) * sx - M.l) / bw); const a = all[i]; if (!a) { hideTip(wrap); return; }
    el.querySelectorAll("path[data-i]").forEach(p => p.setAttribute("fill-opacity", +p.dataset.i === i ? "1" : ".55"));
    const ctry = {}; a.list.forEach(c => { const k = regionName(c.country); ctry[k] = (ctry[k]||0) + 1; });
    const wr = wrap.getBoundingClientRect();
    tipAt(wrap, `<div class="t">${a.y}年</div><div><b>${a.list.length}</b> 大会</div><div class="t">${esc(Object.entries(ctry).map(([k,n])=>`${k} ${n}`).join(" / ") || "参加なし")}</div>`, ev2.clientX - wr.left, ev2.clientY - wr.top);
  });
  el.querySelector("#yearHit").addEventListener("pointerleave", () => { el.querySelectorAll("path[data-i]").forEach(p => p.removeAttribute("fill-opacity")); hideTip(wrap); });
}

function renderActivity(){
  const {compList, E, evIds, person} = STATE;
  drawYears();
  const first = compList.at(-1), last = compList[0];
  const items = [];
  if (first) items.push(["初出場", `${first.name}`, first.date]);
  if (last) items.push(["最新の大会", `${last.name}`, last.date]);
  if (first && last) { const d = Math.round((toT(last.date) - toT(first.date)) / day); items.push(["活動期間", `${Math.floor(d/365.25)}年${Math.floor((d%365.25)/30.44)}か月`, `${fmtNum(d)}日`]); }
  const byY = {}; compList.forEach(c => { const y = c.date.slice(0,4); byY[y] = (byY[y]||0) + 1; });
  const topY = Object.entries(byY).sort((a,b) => b[1]-a[1] || b[0].localeCompare(a[0]))[0];
  if (topY) items.push(["最多参加の年", `${topY[0]}年`, `${topY[1]}大会`]);
  const mostEv = evIds.map(id => [id, E[id].rounds.length]).sort((a,b) => b[1]-a[1])[0];
  if (mostEv) items.push(["最多出場種目", ev(mostEv[0]).name, `${E[mostEv[0]].comps.size}大会・${mostEv[1]}ラウンド`]);
  const imp = evIds.filter(id => ev(id).kind !== "mbf" && E[id].pbA.length >= 2).map(id => { const a = plotY(id, E[id].pbA[0].v, true), b = plotY(id, E[id].pbA.at(-1).v, true); return [id, (a-b)/a, E[id]]; }).sort((x,y) => y[1]-x[1])[0];
  if (imp) items.push(["最も伸びた平均", ev(imp[0]).name, `${fmtVal(imp[0], imp[2].pbA[0].v, true)} → ${fmtVal(imp[0], imp[2].pbA.at(-1).v, true)}（−${(imp[1]*100).toFixed(1)}%）`]);
  const sr = evIds.map(id => { const v = E[id].solves.length, d = E[id].dnf; return [id, v/(v+d), v+d]; }).filter(x => x[2] >= 20 && /bf$/.test(x[0]));
  if (sr.length) { const b = sr.sort((a,b) => b[1]-a[1])[0]; items.push(["目隠し成功率", ev(b[0]).name, `${(b[1]*100).toFixed(1)}%（${b[2]}試技）`]); }
  const city = {}; compList.forEach(c => { if (c.city && !/multiple/i.test(c.city)) city[c.city] = (city[c.city]||0) + 1; });
  const topC = Object.entries(city).sort((a,b) => b[1]-a[1])[0];
  if (topC) items.push(["よく行く都市", topC[0], `${topC[1]}大会`]);
  if (person.championshipIds?.length) items.push(["選手権", `${person.championshipIds.length}大会に出場`, person.championshipIds.filter(x => /^WC\d{4}$/.test(x)).map(x => "世界大会" + x.slice(2)).join("・") || ""]);
  $("#highlights").innerHTML = items.map(([k,v,s]) => `<li><span class="k">${k}</span><span class="v">${esc(v)}${s ? `<small>${esc(s)}</small>` : ""}</span></li>`).join("");
  const ct = {}; compList.forEach(c => { const k = c.country || "?"; ct[k] = (ct[k]||0) + 1; });
  const rows = Object.entries(ct).sort((a,b) => b[1]-a[1]); const mx = rows[0]?.[1] || 1;
  $("#countries").innerHTML = rows.map(([c,n]) => `<div><span>${esc(regionName(c))}</span><span class="track"><span style="width:${(100*n/mx).toFixed(1)}%"></span></span><span class="c">${n}</span></div>`).join("");
}

/* ---------- results history (WCA-style) ---------- */
function initHistFilters(){
  const {evIds} = STATE;
  const prev = $("#histEvent").value;
  $("#histEvent").innerHTML = `<option value="">すべての種目</option>` + evIds.map(id => `<option value="${esc(id)}">${esc(ev(id).name)}</option>`).join("");
  if (prev && evIds.includes(prev)) $("#histEvent").value = prev;
}
function renderHistory(){
  if (!STATE) return;
  const {E, evIds, pbRound} = STATE;
  const fe = $("#histEvent").value, mode = $("#histShow").value;
  const keep = r => mode === "all" || (mode === "rec" && (r.recS || r.recA)) || (mode === "pb" && pbRound.has(r)) || (mode === "final" && r.round === "Final") || (mode === "podium" && isPodium(r));
  let total = 0, html = "";
  for (const id of (fe ? [fe] : evIds)) {
    const e = E[id]; if (!e) continue;
    const rs = e.rounds.filter(keep).sort((a,b) => b.date.localeCompare(a.date) || b.cid.localeCompare(a.cid) || b.ro - a.ro);
    if (!rs.length) continue;
    total += rs.length;
    const nRec = rs.reduce((a,r) => a + (r.recS?1:0) + (r.recA?1:0), 0);
    let rows = "", prevC = null;
    for (const r of rs) {
      const t = pbRound.get(r) || "";
      const first = r.cid !== prevC; prevC = r.cid;
      rows += `<tr class="${first ? "newcomp" : ""} ${r.recS || r.recA ? "hasrec" : ""}">
        <td class="l comp" title="${esc(compLabel(r))}">${first ? `${esc(compLabel(r))}${liveTagHTML(r.m)}<small>${esc(r.date)}</small>` : ""}</td>
        <td class="l">${esc(RJ[r.round] || r.round)}${provHTML(r)}</td><td class="num">${isPodium(r) ? `<i class="pdot d-${["gold","silver","bronze"][r.position-1]}" title="${r.position}位入賞" aria-hidden="true"></i>` : ""}${r.position ?? ""}</td>
        <td class="val"><b>${esc(fmtVal(id, r.best, false))}</b>${badge(r.recS)}${t.includes("S") ? ' <span class="tag pb">PB</span>' : ""}</td>
        <td class="val"><b>${esc(fmtVal(id, r.average, true))}</b>${badge(r.recA)}${t.includes("A") ? ' <span class="tag pb">PB</span>' : ""}</td>
        <td class="solves">${solvesHTML(r)}</td></tr>`;
    }
    html += `<div class="panel hist-ev"><h3>${esc(ev(id).name)} <small>${rs.length}ラウンド${nRec ? `・記録 ${nRec}件` : ""}</small></h3>
      <div class="scroll"><table><thead><tr><th class="l">大会</th><th class="l">ラウンド</th><th>順位</th><th>単発</th><th>平均</th><th class="l">記録</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }
  $("#histCount").textContent = `${fmtNum(total)} ラウンド`;
  $("#histList").innerHTML = html || `<div class="panel"><p class="note" style="padding:16px">${mode === "rec" && RECS.state !== "ok" ? "記録バッジのデータを取得できていないため表示できません。" : "条件に一致する記録はありません。"}</p></div>`;
}

/* ---------- competition log ---------- */
function initLogFilters(keep){
  const {evIds, compList} = STATE;
  const prevE = $("#logEvent").value, prevY = $("#logYear").value;
  if (!keep) { $("#logFilter").value = ""; $("#logPodium").value = ""; }
  $("#logEvent").innerHTML = `<option value="">すべての種目</option>` + evIds.map(id => `<option value="${esc(id)}">${esc(ev(id).name)}</option>`).join("");
  const ys = [...new Set(compList.map(c => c.date.slice(0,4)))].sort().reverse();
  $("#logYear").innerHTML = `<option value="">すべての年</option>` + ys.map(y => `<option value="${y}">${y}年</option>`).join("");
  if (keep) {
    if (evIds.includes(prevE)) $("#logEvent").value = prevE;
    if (ys.includes(prevY)) $("#logYear").value = prevY;
  }
}
// 入賞：終了した決勝で1〜3位（記録あり）
const isPodium = r => r.round === "Final" && r.finished && r.best > 0 && r.position >= 1 && r.position <= 3;
function solvesHTML(r){
  const id = r.eid; const s = r.solves.filter(v => v !== 0);
  let trim = new Set();
  if (r.format === "Average of 5" && s.length === 5) {
    const keys = s.map(v => v > 0 ? key(id, v) : Infinity);
    const minI = keys.indexOf(Math.min(...keys)); let maxI = 0; keys.forEach((k,i) => { if (k >= keys[maxI] && i !== minI) maxI = i; });
    trim = new Set([minI, maxI]);
  }
  return s.map((v,i) => trim.has(i) ? `<span class="tr">(${esc(fmtVal(id, v, false))})</span>` : esc(fmtVal(id, v, false))).join("&nbsp; ");
}
function renderLog(){
  const {compList, pbRound, person} = STATE;
  const q = $("#logFilter").value.trim().toLowerCase(), fe = $("#logEvent").value, fy = $("#logYear").value, fp = $("#logPodium").value;
  const champ = new Set(person.championshipIds || []);
  const list = compList.filter(c => (!q || (c.name + " " + c.city + " " + c.cid).toLowerCase().includes(q)) && (!fe || c.rounds.some(r => r.eid === fe)) && (!fy || c.date.startsWith(fy))
    && (!fp || c.rounds.some(r => isPodium(r) && (!fe || r.eid === fe))));
  $("#logCount").textContent = `${list.length} / ${compList.length} 大会`;
  const shown = list.slice(0, STATE.logShown);
  $("#compLog").innerHTML = shown.length ? shown.map(c => {
    const rs = c.rounds.filter(r => !fe || r.eid === fe).sort((a,b) => ev(a.eid).order - ev(b.eid).order || b.ro - a.ro);
    const pods = c.rounds.filter(isPodium).filter((r, i, a) => a.findIndex(x => x.eid === r.eid) === i);
    const pbs = c.rounds.filter(r => pbRound.has(r)).length;
    const evCount = new Set(c.rounds.map(r => r.eid)).size;
    const cls = ["gold","silver","bronze"];
    return `<details class="comp"><summary><span class="cdate">${esc(c.date)}</span>
      <span class="cname">${esc(c.name)}${liveTagHTML(c.m)}<small>${esc(c.city)}${c.city ? " · " : ""}${esc(regionName(c.country))}</small></span>
      <span class="cright">${champ.has(c.cid) ? `<span class="tag champ">選手権</span>` : ""}${c.rounds.flatMap(r => [r.recS, r.recA]).filter(Boolean).map(badge).join("")}${pbs ? `<span class="tag pb">PB ${pbs}</span>` : ""}
        ${pods.length ? `<span class="pods">${pods.map(r => `<span title="${esc(ev(r.eid).name)} ${r.position}位"><i class="d-${cls[r.position-1]}"></i>${esc(ev(r.eid).name.replace(/（.*）/,""))}</span>`).join("")}</span>` : ""}
        <span>${evCount}種目</span></span></summary>
      <div class="inner"><table><thead><tr><th class="l">種目</th><th class="l">ラウンド</th><th>順位</th><th>単発</th><th>平均</th><th class="l">記録</th></tr></thead><tbody>
      ${rs.map(r => { const t = pbRound.get(r) || ""; return `<tr><td class="l">${esc(ev(r.eid).name)}</td><td class="l">${esc(RJ[r.round] || r.round)} <span class="zero">${esc(FJ[r.format] || "")}</span>${provHTML(r)}</td>
        <td class="num">${r.position ?? ""}</td><td class="num">${esc(fmtVal(r.eid, r.best, false))}${badge(r.recS)}${t.includes("S") ? ' <span class="tag pb">PB</span>' : ""}</td>
        <td class="num">${esc(fmtVal(r.eid, r.average, true))}${badge(r.recA)}${t.includes("A") ? ' <span class="tag pb">PB</span>' : ""}</td><td class="solves">${solvesHTML(r)}</td></tr>`; }).join("")}
      </tbody></table></div></details>`;
  }).join("") : `<p class="note" style="padding:16px">条件に一致する大会はありません。</p>`;
  $("#moreBtn").hidden = list.length <= STATE.logShown;
  $("#moreBtn").textContent = `さらに表示（残り ${list.length - STATE.logShown}）`;
}

/* ---------- ランキングの推移（WCA公式の結果エクスポートから GitHub Actions で作ったデータ） ---------- */
const RH_BASE = "data/rankhist/";
const RH_REG = [
  {k:"world", code:"WR", name:"世界", color:"var(--accent)"},
  {k:"continent", code:"CR", name:"大陸", color:"var(--avg)"},
  {k:"country", code:"NR", name:"国内", color:"var(--s3)"}
];
const RH_STEPS = {12:"1年", 6:"半年", 3:"3ヶ月", 1:"1ヶ月"};
const RH = {meta:undefined, metaP:null, personsP:null, files:new Map(), series:new Map(), loading:new Set(), errors:new Map(),
  pid:null, sel:new Set(), type:"single", region:"all", metric:"rank", step:3};
try {
  const o = JSON.parse(localStorage.getItem("wca-rh") || "{}");
  if (["single","average"].includes(o.type)) RH.type = o.type;
  if (["all","world","continent","country"].includes(o.region)) RH.region = o.region;
  if (["rank","pct"].includes(o.metric)) RH.metric = o.metric;
  if ([1,3,6,12].includes(o.step)) RH.step = o.step;
} catch(e){}
function rhSave(){ try { localStorage.setItem("wca-rh", JSON.stringify({type:RH.type, region:RH.region, metric:RH.metric, step:RH.step})); } catch(e){} }
const ymIdx = d => (+d.slice(0,4) - 1982) * 12 + (+d.slice(5,7) - 1);
const ymLabel = m => `${1982 + Math.floor(m / 12)}/${String(m % 12 + 1).padStart(2, "0")}`;

async function rhGunzip(res){
  if (typeof DecompressionStream === "undefined") throw new Error("nodecomp");
  return new Uint8Array(await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
}
function rhMeta(){
  if (!RH.metaP) RH.metaP = fetch(RH_BASE + "meta.json", {cache:"no-cache"})
    .then(r => r.ok ? r.json() : null).catch(() => null)
    .then(m => (RH.meta = (m && m.files) ? m : null));
  return RH.metaP;
}
function rhFile(eid, type){
  const k = eid + "|" + type;
  if (!RH.files.has(k)) {
    const f = RH.meta.files?.[eid]?.[type];
    const p = (async () => {
      if (!f) return null;
      const res = await fetch(RH_BASE + f.file + "?v=" + encodeURIComponent(RH.meta.builtAt));
      if (!res.ok) throw new Error("HTTP " + res.status);
      const b = await rhGunzip(res);
      if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== "WRH2") throw new Error("format");
      let i = 4;
      const rd = () => { let v = 0, mul = 1, x; do { x = b[i++]; v += (x & 127) * mul; mul *= 128; } while (x & 128); return v; };
      const nM = rd(), counts = new Uint32Array(nM); let n = 0;
      for (let m = 0; m < nM; m++) { counts[m] = rd(); n += counts[m]; }
      const pers = new Uint32Array(n), vals = new Uint32Array(n), ctry = new Uint16Array(n);
      let maxP = 0;
      for (let m = 0, j = 0; m < nM; m++) { let p = 0; for (let c = 0; c < counts[m]; c++, j++) { p += rd(); pers[j] = p; vals[j] = rd(); ctry[j] = rd(); if (p > maxP) maxP = p; } }
      return {nM, counts, pers, vals, ctry, nP:maxP + 1};
    })();
    RH.files.set(k, p);
    p.catch(() => RH.files.delete(k));
  }
  return RH.files.get(k);
}

/* 月ごとに全選手の自己ベストを更新しながら、その月末のこの選手の順位と人数を数える。
   WCA公式ランキングと同じく、大陸・国内は「その記録を出したときに代表していた国」で数える。 */
function rhCompute(eid, type, data){
  const meta = RH.meta;
  const mine = [];
  for (const r of STATE.rounds) {
    if (r.live || r.eid !== eid) continue;
    const v = type === "single" ? r.best : r.average;
    if (v > 0) mine.push([ymIdx(r.date), v]);
  }
  if (!mine.length) return null;
  mine.sort((a, b) => a[0] - b[0]);
  const ci = meta.countries.findIndex(c => c.iso2 === STATE.person.country);
  const myCont = ci >= 0 ? meta.countries[ci].cont : null;
  const sameCont = new Uint8Array(meta.countries.length + 1);
  meta.countries.forEach((c, i) => { sameCont[i] = myCont && c.cont === myCont ? 1 : 0; });
  // 記録の値を小さい順の番号に置き換える（同じ値は同じ番号）
  const U = Uint32Array.from(data.vals).sort(); let u = 0;
  for (let i = 0; i < U.length; i++) if (i === 0 || U[i] !== U[i - 1]) U[u++] = U[i];
  const lb = v => { let lo = 0, hi = u; while (lo < hi) { const mid = (lo + hi) >> 1; if (U[mid] < v) lo = mid + 1; else hi = mid; } return lo; };
  const T = [new Int32Array(u + 1), new Int32Array(u + 1), new Int32Array(u + 1)], tot = [0, 0, 0];
  const add = (t, i, d) => { for (i++; i <= u; i += i & -i) t[i] += d; };
  const sum = (t, i) => { let s = 0; for (; i > 0; i -= i & -i) s += t[i]; return s; };
  const cur = [new Int32Array(data.nP).fill(-1), new Int32Array(data.nP).fill(-1), new Int32Array(data.nP).fill(-1)];
  // 未来の月は表示しない（データの期間と、見ている人の今日の月の早いほうまで）
  const now = new Date(), nowM = (now.getFullYear() - 1982) * 12 + now.getMonth();
  const first = mine[0][0], last = Math.min(data.nM - 1, nowM);
  if (first > last) return null;
  const n = last - first + 1;
  const out = {first, last, rank:[new Int32Array(n), new Int32Array(n), new Int32Array(n)], total:[new Int32Array(n), new Int32Array(n), new Int32Array(n)], pb:new Float64Array(n),
    has:[true, !!myCont, ci >= 0]};
  let j = 0, k = 0, my = Infinity;
  for (let m = 0; m <= last; m++) {
    for (let c = 0; c < data.counts[m]; c++, j++) {
      const p = data.pers[j], vi = lb(data.vals[j]), cc = data.ctry[j];
      const inR = [true, cc < sameCont.length && sameCont[cc] === 1, ci >= 0 && cc === ci];
      for (let r = 0; r < 3; r++) {
        if (!inR[r]) continue;
        const old = cur[r][p];
        if (old >= 0 && vi >= old) continue;          // その地域での自己ベストは更新していない
        if (old >= 0) add(T[r], old, -1); else tot[r]++;
        add(T[r], vi, 1); cur[r][p] = vi;
      }
    }
    while (k < mine.length && mine[k][0] <= m) { if (mine[k][1] < my) my = mine[k][1]; k++; }
    if (m >= first) {
      const q = lb(my), i = m - first;
      for (let r = 0; r < 3; r++) { out.rank[r][i] = sum(T[r], q) + 1; out.total[r][i] = tot[r]; }
      out.pb[i] = my;
    }
  }
  return out;
}

async function rhLoad(eid, type){
  const key2 = eid + "|" + type, pid = RH.pid;
  if (RH.series.has(key2) || RH.loading.has(key2)) return;
  RH.loading.add(key2); RH.errors.delete(key2);
  try {
    const data = await rhFile(eid, type);
    await new Promise(r => setTimeout(r, 0));
    if (RH.pid !== pid || !STATE) return;
    RH.series.set(key2, data ? rhCompute(eid, type, data) : null);
  } catch(e) {
    RH.errors.set(key2, e.message === "nodecomp" ? "nodecomp" : e.message === "format" ? "format" : "load");
  } finally {
    RH.loading.delete(key2);
    if (RH.pid === pid) rhRender();
  }
}

async function rhInit(){
  const st = STATE;
  if (RH.pid !== st.person.id) { RH.pid = st.person.id; RH.sel = new Set(); RH.series.clear(); RH.errors.clear(); }
  const meta = await rhMeta();
  if (STATE !== st) return;
  if (meta && !RH.sel.size) {
    const evs = rhEvents();
    const top = evs.slice().sort((a, b) => st.E[b].rounds.length - st.E[a].rounds.length)[0];
    if (top) RH.sel.add(top);
  }
  rhRender();
}
function rhEvents(){ return STATE.evIds.filter(e => RH.meta?.files?.[e] && STATE.E[e].rounds.some(r => !r.live)); }
function rhSampleIdx(s){
  const idx = [];
  for (let m = s.first; m <= s.last; m++) if ((m % 12 + 1) % RH.step === 0) idx.push(m - s.first);
  if (!idx.length || idx.at(-1) !== s.last - s.first) idx.push(s.last - s.first);
  return idx;
}
function rhRegs(s){ return RH_REG.map((g, r) => ({...g, r})).filter(g => (RH.region === "all" || RH.region === g.k) && (!s || s.has[g.r])); }
const rhVal = (s, r, i) => RH.metric === "pct" ? s.rank[r][i] / s.total[r][i] * 100 : s.rank[r][i];
const rhFmtPct = p => (p < 1 ? p.toFixed(2) : p < 10 ? p.toFixed(1) : p.toFixed(0)) + "%";
const rhFmt = (s, r, i) => RH.metric === "pct" ? rhFmtPct(rhVal(s, r, i)) : fmtNum(s.rank[r][i]);
function rhContName(){
  const c = RH.meta?.countries?.find(x => x.iso2 === STATE.person.country);
  return c && RH.meta.continents?.[c.cont] ? RH.meta.continents[c.cont].record || "CR" : "CR";
}

function rhRender(){
  if (!STATE) return;
  const meta = RH.meta;
  const segSet = (id, val) => document.querySelectorAll(`#${id} button`).forEach(b => b.setAttribute("aria-pressed", b.dataset.v === String(val)));
  segSet("rhType", RH.type); segSet("rhRegion", RH.region); segSet("rhMetric", RH.metric); segSet("rhStep", RH.step);
  const crBtn = document.querySelector('#rhRegion button[data-v="continent"]');
  if (crBtn) crBtn.textContent = `${rhContName()} 大陸`;
  const status = $("#rhStatus");
  if (meta === undefined) { status.textContent = "データを確認中…"; return; }
  if (!meta) {
    $("#rhBody").hidden = true;
    status.classList.add("err");
    status.textContent = "ランキングの推移のデータがありません。GitHub で公開したページでは、GitHub Actions がWCA公式の結果エクスポートからデータを作ると表示されます（README の手順を参照）。";
    return;
  }
  $("#rhBody").hidden = false; status.classList.remove("err");
  const evs = rhEvents();
  $("#rhEvents").innerHTML = evs.map(e => {
    const f = meta.files[e]?.[RH.type];
    return `<button type="button" class="chip" data-eid="${esc(e)}" aria-pressed="${RH.sel.has(e)}" ${f ? "" : `title="${RH.type === "single" ? "単発" : "平均"}のデータがありません"`}>${esc(ev(e).name)}</button>`;
  }).join("");
  const sel = evs.filter(e => RH.sel.has(e));
  // 読み込みに失敗した種目は自動で再試行しない（ページを再読み込みするとやり直す）
  for (const e of sel) if (meta.files[e]?.[RH.type] && !RH.errors.has(e + "|" + RH.type)) rhLoad(e, RH.type);
  const loadingN = sel.filter(e => RH.loading.has(e + "|" + RH.type));
  const bytes = loadingN.reduce((a, e) => a + (meta.files[e]?.[RH.type]?.bytes || 0), 0);
  const rhDate = (meta.exportDate || meta.builtAt || "").slice(0, 10);
  status.textContent = `データ: WCA公式の結果エクスポート（${rhDate} 時点）`
    + (MIRROR_DATE && rhDate && MIRROR_DATE !== rhDate ? `。自己ベストとランキングの欄は ${MIRROR_DATE} 時点のデータのため、その間に反映された大会の分だけ最新の順位が違うことがあります` : "")
    + (loadingN.length ? `・${loadingN.map(e => ev(e).name).join("・")} を読み込み中（約${(bytes / 1048576).toFixed(1)}MB）…` : "");
  // 凡例
  const regs = rhRegs(null);
  $("#rhLegend").innerHTML = regs.map(g => `<span><i style="background:${g.color}"></i>${g.code === "CR" ? esc(rhContName()) : g.code}（${g.name}）</span>`).join("");
  // グラフ
  const charts = $("#rhCharts");
  if (!sel.length) { charts.innerHTML = `<p class="note">上のボタンで種目を選んでください。</p>`; $("#rhTable").innerHTML = ""; return; }
  charts.innerHTML = sel.map(e => `<div class="panel chart rhchart" data-eid="${esc(e)}"><h3>${esc(ev(e).name)}</h3><div class="rhplot"></div></div>`).join("");
  for (const e of sel) {
    const el = charts.querySelector(`.rhchart[data-eid="${CSS.escape(e)}"] .rhplot`);
    const k = e + "|" + RH.type, s = RH.series.get(k);
    if (!meta.files[e]?.[RH.type]) el.innerHTML = `<p class="note">${RH.type === "single" ? "単発" : "平均"}の記録がない種目です。</p>`;
    else if (RH.errors.has(k)) el.innerHTML = `<p class="note err">${RH.errors.get(k) === "nodecomp" ? "このブラウザでは読み込めません。iOS 16.4 以降の Safari か、最新の Chrome・Edge・Firefox で開いてください。" : RH.errors.get(k) === "format" ? "データの形式が古いため表示できません。GitHub の Actions タブで「Build and deploy」を実行し直すと表示されます。" : "データを読み込めませんでした。通信状況を確認して、ページを再読み込みしてください。"}</p>`;
    else if (!RH.series.has(k)) el.innerHTML = `<p class="note">読み込み中…</p>`;
    else if (!s) el.innerHTML = `<p class="note">この選手の${RH.type === "single" ? "単発" : "平均"}の記録がありません。</p>`;
    else rhDraw(el, s);
  }
  rhTable(sel);
}

function rhLogTicks(lo, hi, pct){
  const out = [];
  for (let e = Math.floor(Math.log10(lo)) - 1; e <= Math.ceil(Math.log10(hi)) + 1; e++)
    for (const f of [1, 2, 5]) { const v = f * 10 ** e; if (v >= lo && v <= hi && (pct || v >= 1)) out.push(+v.toPrecision(3)); }
  if (out.length <= 9) return out;
  const pow = out.filter(v => /^1(0*)$|^0\.0*1$/.test(String(v)));          // 1・10・100…
  const mid = out.filter(v => /^(1|5)(0*)$|^0\.0*(1|5)$/.test(String(v)));  // 1・5・10・50…
  return mid.length <= 9 ? mid : pow;
}
function rhDraw(el, s){
  const idx = rhSampleIdx(s), regs = rhRegs(s);
  if (!regs.length) { el.innerHTML = `<p class="note">この地域の順位は計算できません。</p>`; return; }
  const pct = RH.metric === "pct";
  const W = Math.max(280, el.clientWidth), H = W < 520 ? 220 : 250, M = {l:pct ? 50 : 52, r:72, t:10, b:24};
  let lo = Infinity, hi = 0;
  for (const g of regs) for (const i of idx) { const v = rhVal(s, g.r, i); if (v > 0) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
  if (!(hi > 0)) { el.innerHTML = `<p class="note">表示できる値がありません。</p>`; return; }
  lo = pct ? lo / 1.25 : Math.max(1, lo / 1.25); hi = hi * 1.25; if (hi / lo < 4) { lo = pct ? lo / 2 : Math.max(1, lo / 2); hi *= 2; }
  // 軸の上下を 1・2・5 の区切りにそろえる
  const nice = (v, up) => { const e = Math.floor(Math.log10(v)), c = [1, 2, 5, 10].map(f => f * 10 ** e); return up ? c.find(x => x >= v * 0.9999) : c.reverse().find(x => x <= v * 1.0001); };
  lo = nice(lo, false); hi = nice(hi, true); if (!pct) lo = Math.max(1, lo);
  const L = v => Math.log10(v);
  const Y = v => M.t + (L(v) - L(lo)) / (L(hi) - L(lo)) * (H - M.t - M.b);          // 小さい（良い）ほど上
  const x0 = s.first + idx[0], x1 = s.first + idx.at(-1);
  const X = m => x1 === x0 ? (M.l + W - M.r) / 2 : M.l + (m - x0) / (x1 - x0) * (W - M.l - M.r);
  const ticks = rhLogTicks(lo, hi, pct);
  const yr0 = Math.floor(x0 / 12), yr1 = Math.floor(x1 / 12), every = Math.max(1, Math.ceil((yr1 - yr0 + 1) / Math.max(2, Math.floor((W - M.l - M.r) / 52))));
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="ランキングの推移">`;
  svg += `<g class="grid">${ticks.map(v => `<line x1="${M.l}" x2="${W - M.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/>`).join("")}</g><g class="axis">`;
  svg += ticks.map(v => `<text x="${M.l - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${pct ? (v < 1 ? v : fmtNum(v)) + "%" : fmtNum(v)}</text>`).join("");
  for (let y = yr0 + 1; y <= yr1; y++) if ((y - yr0) % every === 0 || yr1 - yr0 < 2) svg += `<text x="${X(y * 12).toFixed(1)}" y="${H - 6}" text-anchor="middle">${1982 + y}</text>`;
  if (yr1 - yr0 < 1) svg += `<text x="${X(x0).toFixed(1)}" y="${H - 6}" text-anchor="start">${ymLabel(x0)}</text>`;
  svg += `</g>`;
  const labels = [];
  for (const g of regs) {
    const pts = idx.map(i => [X(s.first + i), Y(rhVal(s, g.r, i))]);
    svg += `<path d="${pts.map((p, n) => (n ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join("")}" fill="none" stroke="${g.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (idx.length <= 40) svg += pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="${g.color}" stroke="var(--surface)" stroke-width="1.5"/>`).join("");
    else svg += `<circle cx="${pts.at(-1)[0].toFixed(1)}" cy="${pts.at(-1)[1].toFixed(1)}" r="4" fill="${g.color}" stroke="var(--surface)" stroke-width="2"/>`;
    labels.push({y:pts.at(-1)[1], t:rhFmt(s, g.r, idx.at(-1)), c:g.color});
  }
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
  svg += labels.map(l => `<text x="${(W - M.r + 8).toFixed(1)}" y="${(l.y + 4).toFixed(1)}" style="fill:var(--ink);font:600 11.5px var(--f-mono)">${esc(l.t)}</text>`).join("");
  svg += `<line class="rhcross" x1="0" x2="0" y1="${M.t}" y2="${H - M.b}" stroke="var(--faint)" stroke-width="1" visibility="hidden"/>`;
  svg += `<rect x="${M.l}" y="0" width="${W - M.l - M.r}" height="${H - M.b}" fill="transparent" class="rhhit"/></svg>`;
  el.innerHTML = svg;
  const wrap = el.parentElement, cross = el.querySelector(".rhcross"), hit = el.querySelector(".rhhit");
  hit.addEventListener("pointermove", e2 => {
    const box = el.querySelector("svg").getBoundingClientRect(), sx = W / box.width, mx = (e2.clientX - box.left) * sx;
    let bi = idx[0], bd = Infinity;
    for (const i of idx) { const d = Math.abs(X(s.first + i) - mx); if (d < bd) { bd = d; bi = i; } }
    const cx = X(s.first + bi); cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
    const wr = wrap.getBoundingClientRect();
    tipAt(wrap, `<div class="t">${ymLabel(s.first + bi)} 末・自己ベスト ${esc(fmtVal(wrap.dataset.eid, s.pb[bi], RH.type === "average"))}</div>`
      + regs.map(g => `<div>${g.code === "CR" ? esc(rhContName()) : g.code} <b>${fmtNum(s.rank[g.r][bi])}位</b> / ${fmtNum(s.total[g.r][bi])}人（上位 ${rhFmtPct(s.rank[g.r][bi] / s.total[g.r][bi] * 100)}）</div>`).join(""),
      e2.clientX - wr.left, e2.clientY - wr.top);
  });
  hit.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); hideTip(wrap); });
}

function rhTable(sel){
  const cols = [];
  for (const e of sel) {
    const s = RH.series.get(e + "|" + RH.type);
    if (s) for (const g of rhRegs(s)) cols.push({e, s, g});
  }
  if (!cols.length) { $("#rhTable").innerHTML = ""; return; }
  const months = new Set();
  for (const c of cols) for (const i of rhSampleIdx(c.s)) months.add(c.s.first + i);
  const rows = [...months].sort((a, b) => b - a);
  const groups = [];
  for (const c of cols) { const last = groups.at(-1); if (last && last.e === c.e) last.n++; else groups.push({e:c.e, n:1}); }
  let h = `<thead><tr><th class="l" rowspan="2">時点</th>${groups.map(g => `<th class="grp" colspan="${g.n}">${esc(ev(g.e).name)}</th>`).join("")}</tr>`
    + `<tr>${cols.map((c, n) => `<th class="${n === 0 || cols[n - 1].e !== c.e ? "bl" : ""}">${c.g.code === "CR" ? esc(rhContName()) : c.g.code}</th>`).join("")}</tr></thead><tbody>`;
  const lastM = Math.max(...cols.map(c => c.s.last));
  for (const m of rows) {
    h += `<tr><td class="l num">${ymLabel(m)}${m === lastM ? ' <span class="zero">最新</span>' : ""}</td>` + cols.map((c, n) => {
      const i = m - c.s.first, cls = `num${n === 0 || cols[n - 1].e !== c.e ? " bl" : ""}`;
      if (i < 0 || i > c.s.last - c.s.first) return `<td class="${cls}"><span class="zero">–</span></td>`;
      return `<td class="${cls}" title="${fmtNum(c.s.rank[c.g.r][i])}位 / ${fmtNum(c.s.total[c.g.r][i])}人">${rhFmt(c.s, c.g.r, i)}</td>`;
    }).join("") + `</tr>`;
  }
  $("#rhTable").innerHTML = h + "</tbody>";
}

/* ---------- events ---------- */
$("#searchForm").addEventListener("submit", e => { e.preventDefault(); onSearch($("#q").value); });
$("#cands").addEventListener("click", e => { const b = e.target.closest("button[data-id]"); if (b) { $("#q").value = b.dataset.id; loadId(b.dataset.id); } });
$("#pbTable").addEventListener("click", e => { const tr = e.target.closest("tr[data-eid]"); if (tr) selectEvent(tr.dataset.eid, true); });
$("#pbTable").addEventListener("keydown", e => { if (e.key !== "Enter") return; const tr = e.target.closest("tr[data-eid]"); if (tr) selectEvent(tr.dataset.eid, true); });
$("#evChips").addEventListener("click", e => { const b = e.target.closest("button[data-eid]"); if (b) selectEvent(b.dataset.eid, false); });
for (const [id, k, num] of [["rhType","type"],["rhRegion","region"],["rhMetric","metric"],["rhStep","step",true]])
  $("#" + id).addEventListener("click", e => { const b = e.target.closest("button[data-v]"); if (!b) return; RH[k] = num ? +b.dataset.v : b.dataset.v; rhSave(); rhRender(); });
$("#rhEvents").addEventListener("click", e => { const b = e.target.closest("button[data-eid]"); if (!b) return; const id = b.dataset.eid; RH.sel.has(id) ? RH.sel.delete(id) : RH.sel.add(id); rhRender(); });
$("#rhAll").addEventListener("click", () => { rhEvents().forEach(e => RH.sel.add(e)); rhRender(); });
$("#rhNone").addEventListener("click", () => { RH.sel.clear(); rhRender(); });
$("#rankPeriod").addEventListener("change", () => { $("#rankCustom").hidden = $("#rankPeriod").value !== "custom"; renderRanking(); });
["#rankFrom", "#rankTo"].forEach(id => $(id).addEventListener("change", renderRanking));
$("#rankDir").addEventListener("click", e => { const b = e.target.closest("button[data-d]"); if (!b) return; STATE.rankDir = b.dataset.d; renderRanking(); });
$("#rankSeg").addEventListener("click", e => { const b = e.target.closest("button[data-t]"); if (!b || b.disabled) return; STATE.rankType = b.dataset.t; renderRanking(); });
$("#rangeSeg").addEventListener("click", e => { const b = e.target.closest("button[data-r]"); if (!b) return; STATE.range = +b.dataset.r;
  document.querySelectorAll("#rangeSeg button").forEach(x => x.setAttribute("aria-pressed", x === b)); drawProg(); drawHist(); });
["input","change"].forEach(t => { $("#logFilter").addEventListener(t, () => { STATE.logShown = 20; renderLog(); }); });
$("#logEvent").addEventListener("change", () => { STATE.logShown = 20; renderLog(); });
$("#logYear").addEventListener("change", () => { STATE.logShown = 20; renderLog(); });
$("#logPodium").addEventListener("change", () => { STATE.logShown = 20; renderLog(); });
$("#histEvent").addEventListener("change", renderHistory);
$("#histShow").addEventListener("change", renderHistory);
$("#moreBtn").addEventListener("click", () => { STATE.logShown += 20; renderLog(); });
let rT = null; let lastW = innerWidth;
addEventListener("resize", () => { if (innerWidth === lastW) return; lastW = innerWidth; clearTimeout(rT); rT = setTimeout(() => { if (STATE) { drawProg(); drawHist(); drawYears(); rhRender(); } }, 150); });
document.addEventListener("click", e => { if (e.target.id === "refreshBtn") loadId(e.target.dataset.id); });

/* ---------- バージョン表示 ---------- */
$("#appVer").textContent = APP_VERSION;
$("#appVerFoot").textContent = APP_VERSION;

/* ---------- 各項目の折りたたみ（状態はこの端末に保存） ---------- */
const FOLD_KEY = "wca-collapsed";
let FOLDED = new Set();
try { FOLDED = new Set(JSON.parse(localStorage.getItem(FOLD_KEY) || "[]")); } catch(e){}
const FOLD_SECTIONS = [...document.querySelectorAll("#main > section")];
for (const sec of FOLD_SECTIONS) {
  const h2 = sec.querySelector(":scope > h2");
  const body = document.createElement("div");
  body.className = "secbody"; body.id = sec.id + "-body";
  while (h2.nextSibling) body.appendChild(h2.nextSibling);
  sec.appendChild(body);
  const title = (h2.firstChild?.textContent || h2.textContent).trim();
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "sectoggle"; btn.setAttribute("aria-controls", body.id);
  btn.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  btn.dataset.title = title;
  h2.appendChild(btn);
  h2.addEventListener("click", () => setFold(sec, !sec.classList.contains("collapsed")));
  applyFold(sec, FOLDED.has(sec.id));
}
function applyFold(sec, closed){
  sec.classList.toggle("collapsed", closed);
  sec.querySelector(":scope > .secbody").hidden = closed;
  const btn = sec.querySelector(".sectoggle"), t = btn.dataset.title || "";
  btn.setAttribute("aria-expanded", String(!closed));
  btn.setAttribute("aria-label", `${t}を${closed ? "開く" : "折りたたむ"}`);
  btn.title = closed ? "開く" : "折りたたむ";
}
function setFold(sec, closed){
  applyFold(sec, closed);
  closed ? FOLDED.add(sec.id) : FOLDED.delete(sec.id);
  try { localStorage.setItem(FOLD_KEY, JSON.stringify([...FOLDED])); } catch(e){}
  // 閉じている間はグラフの幅を測れないので、開いたときに描き直す
  if (!closed && STATE) {
    if (sec.id === "secEvent") { drawProg(); drawHist(); }
    if (sec.id === "secAct") drawYears();
    if (sec.id === "secRankHist") rhRender();
  }
}
$("#foldOpen").addEventListener("click", () => FOLD_SECTIONS.forEach(sec => setFold(sec, false)));
$("#foldClose").addEventListener("click", () => FOLD_SECTIONS.forEach(sec => setFold(sec, true)));

/* ---------- boot ---------- */
(function boot(){
  let id = null;
  try { id = new URLSearchParams(location.search).get("id"); } catch(e){}
  if (!id && /^#\d{4}[A-Za-z]{4}\d{2}$/.test(location.hash)) id = location.hash.slice(1);
  // ホーム画面から開いたときは、最後に見ていた選手を表示する
  if (!id) { try { id = localStorage.getItem("wca-last-id"); } catch(e){} }
  if (id && /^\d{4}[A-Za-z]{4}\d{2}$/.test(id)) { $("#q").value = id.toUpperCase(); loadId(id.toUpperCase()); return; }
})();

/* ---------- iPhone: この選手のページをホーム画面に追加する案内 ---------- */
function showHomeHint(person){
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
  if (!ios || standalone) return;
  const s = document.createElement("span");
  s.className = "homehint";
  s.textContent = `この選手をホーム画面に追加: 共有ボタン →「ホーム画面に追加」`;
  $("#status").appendChild(s);
}

/* ---------- PWA: オフライン対応のサービスワーカー（https で公開したときのみ） ---------- */
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  // バージョンをURLに付けて登録する（バージョンが変わると新しい Service Worker に切り替わる）
  addEventListener("load", () => { navigator.serviceWorker.register("sw.js?v=" + encodeURIComponent(APP_VERSION)).catch(() => {}); });
}
