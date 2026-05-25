/* ====================================================================
   PLANNING POLICE — 3-3 / 2-2-3
   Tout fonctionne en local (double-clic sur index.html).
   Les fichiers config.json et conges.json sont lus s'ils sont servis
   (ex: via un petit serveur). Sinon, les valeurs par defaut ci-dessous
   sont utilisees. Les donnees saisies sont gardees dans le navigateur.
   ==================================================================== */

/* -------- Valeurs par defaut (copie de config.json / conges.json) ----- */
const DEFAULT_CONFIG = {
  vacationMinutes: 728,
  vacationLabel: "12h08",
  cadences: {
    "3-3":   { label: "3-3 (Nuit)", type: "nuit", description: "3 vacations travaillees puis 3 repos.", cycle: [1,1,1,0,0,0] },
    "2-2-3": { label: "2-2-3 (Jour)", type: "jour", description: "Rythme 2-2-3 sur 14 jours : 2 trav., 2 repos, 3 trav., 2 repos, 2 trav., 3 repos.", cycle: [1,1,0,0,1,1,1,0,0,1,1,0,0,0] }
  }
};
const DEFAULT_CONGES = {
  types: [
    { code:"CA",   label:"Conge Annuel",                couleur:"#2f81f7", consommeHeures:true,  minutesParDefaut:728, partiel:false, categorie:"conge" },
    { code:"RPS",  label:"Repos Penibilite Specifique", couleur:"#a371f7", consommeHeures:true,  minutesParDefaut:728, partiel:false, categorie:"conge" },
    { code:"RTC",  label:"Recup. Temps Compense",       couleur:"#3fb950", consommeHeures:true,  minutesParDefaut:728, partiel:false, categorie:"conge" },
    { code:"CF",   label:"Conge de Fractionnement",     couleur:"#d29922", consommeHeures:true,  minutesParDefaut:728, partiel:false, categorie:"conge" },
    { code:"DA",   label:"Depart Anticipe",             couleur:"#f85149", consommeHeures:true,  minutesParDefaut:120, partiel:true,  categorie:"conge" },
    { code:"STAGE",label:"Stage / Formation",           couleur:"#1f6feb", consommeHeures:false, minutesParDefaut:0,   partiel:false, categorie:"service" },
    { code:"TIR",  label:"Seance de Tir",               couleur:"#8b949e", consommeHeures:false, minutesParDefaut:0,   partiel:false, categorie:"service" }
  ]
};

const PROFILES_KEY = "planning_police_profiles";
const CURRENT_KEY  = "planning_police_current";
const OLD_KEY      = "planning_police_v1"; // ancienne version (migration)
const stateKeyFor  = (id) => "planning_police_state::" + id;

let FILE_TYPES = null;   // types lus dans conges.json (pour nouveaux profils)
let currentProfileId = null;

/* Mode "comptes" actif si les 2 clés Supabase sont renseignées */
const CLOUD = !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY);
const SUPA_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
let supa = null;          // client Supabase
let cloudUser = null;     // utilisateur connecté
let cloudSaveTimer = null;
let presenceTimer = null;
let cloudProfile = null;  // { display_name, role }
let authMode = "login";   // "login" | "signup"

/* -------- Etat de l'application -------- */
let CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
let state = {
  cadence: "2-2-3",
  startDate: null,
  endDate: null,
  leaves: {},          // { "2026-05-24": { code:"CA", minutes:728 } }
  types: JSON.parse(JSON.stringify(DEFAULT_CONGES.types)),
  remainingMinutes: 0
};
let modalDateISO = null;
let modalSelected = null;

/* ===================== Utilitaires ===================== */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function isoOf(d){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function parseISO(s){ const [y,m,d]=s.split("-").map(Number); return new Date(y, m-1, d, 12, 0, 0); }
function fmtMin(min){
  min = Math.round(min);
  const sign = min < 0 ? "-" : "";
  min = Math.abs(min);
  const h = Math.floor(min/60), m = min%60;
  return sign + h + "h" + String(m).padStart(2,"0");
}
function capit(s){ return s.charAt(0).toUpperCase()+s.slice(1); }
function typeByCode(code){ return state.types.find(t=>t.code===code); }

function freshState(){
  return {
    cadence: "2-2-3",
    startDate: null,
    endDate: null,
    leaves: {},
    types: JSON.parse(JSON.stringify((FILE_TYPES || DEFAULT_CONGES.types))),
    remainingMinutes: 0
  };
}

function save(){
  if(CLOUD){
    if(!cloudUser) return;
    try{ localStorage.setItem("cloud_cache::"+cloudUser.id, JSON.stringify(state)); }catch(e){}
    scheduleCloudSave();
    return;
  }
  if(!currentProfileId) return;
  try{ localStorage.setItem(stateKeyFor(currentProfileId), JSON.stringify(state)); }catch(e){}
}
function load(){
  if(!currentProfileId) return;
  try{
    const raw = localStorage.getItem(stateKeyFor(currentProfileId));
    if(raw){ state = Object.assign(freshState(), JSON.parse(raw)); }
    else { state = freshState(); }
  }catch(e){ state = freshState(); }
}

/* ----- Gestion des profils ----- */
function getProfiles(){
  try{ return JSON.parse(localStorage.getItem(PROFILES_KEY)) || []; }catch(e){ return []; }
}
function setProfiles(list){ try{ localStorage.setItem(PROFILES_KEY, JSON.stringify(list)); }catch(e){} }
function makeId(){ return "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

function createProfile(name){
  const list = getProfiles();
  const id = makeId();
  list.push({ id, name });
  setProfiles(list);
  // initialise un planning vierge pour ce profil
  const fresh = freshState();
  try{ localStorage.setItem(stateKeyFor(id), JSON.stringify(fresh)); }catch(e){}
  return id;
}
function deleteProfile(id){
  setProfiles(getProfiles().filter(p=>p.id!==id));
  try{ localStorage.removeItem(stateKeyFor(id)); }catch(e){}
  if(currentProfileId===id){ currentProfileId=null; try{ localStorage.removeItem(CURRENT_KEY); }catch(e){} }
}
function activateProfile(id){
  currentProfileId = id;
  try{ localStorage.setItem(CURRENT_KEY, id); }catch(e){}
  load();
  refreshProfileChip();
  syncInputsFromState();
  hideGate();
  renderAll();
}
function refreshProfileChip(){
  const p = getProfiles().find(x=>x.id===currentProfileId);
  const name = p ? p.name : "Profil";
  $("#pName").textContent = name;
  $("#pAvatar").textContent = (name[0]||"?").toUpperCase();
}

/* ----- Écran : décide profils (local) ou connexion (cloud) ----- */
function showGate(){
  const card = $("#gateCard");
  if(CLOUD){
    card.innerHTML = cloudUser ? accountPanelHTML() : authFormHTML();
    if(cloudUser) wireAccountPanel(); else wireAuthForm();
  } else {
    card.innerHTML = profilesHTML();
    wireProfiles();
  }
  $("#profileGate").hidden = false;
}
function hideGate(){ $("#profileGate").hidden = true; }
function escapeHtml(s){ return (s||"").replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

/* ===== Mode LOCAL : liste de profils ===== */
function profilesHTML(){
  const list = getProfiles();
  const items = list.length
    ? list.map(p=>`<div class="pitem" data-id="${p.id}">
         <span class="pavatar">${(p.name[0]||"?").toUpperCase()}</span>
         <span class="pi-name">${escapeHtml(p.name)}</span>
         <span class="pi-meta">ouvrir</span>
         <button class="pi-del" data-del="${p.id}" title="Supprimer">✕</button>
       </div>`).join("")
    : `<p class="empty">Aucun profil pour le moment. Crée le tien ci-dessous.</p>`;
  return `
    <div class="gate-head">
      <div class="shield">◈</div>
      <div><h3>Qui utilise ce planning ?</h3>
      <p class="muted">${currentProfileId?"Change de profil ou crée-en un nouveau.":"Chaque profil garde son propre planning sur cet appareil."}</p></div>
    </div>
    <div id="profileList" class="profile-list">${items}</div>
    <div class="new-profile">
      <input id="newProfileName" placeholder="Ton nom / matricule…" maxlength="24" />
      <button class="btn primary" id="createProfile">Créer mon profil</button>
    </div>`;
}
function wireProfiles(){
  $$("#profileList .pitem").forEach(el=>{
    el.addEventListener("click", e=>{ if(e.target.dataset.del) return; activateProfile(el.dataset.id); });
  });
  $$("#profileList .pi-del").forEach(b=>{
    b.addEventListener("click", e=>{
      e.stopPropagation();
      const p = getProfiles().find(x=>x.id===b.dataset.del);
      if(confirm(`Supprimer le profil « ${p?p.name:""} » et son planning ?`)){ deleteProfile(b.dataset.del); showGate(); }
    });
  });
  const create = ()=>{
    const name = $("#newProfileName").value.trim();
    if(!name){ alert("Entre un nom."); return; }
    activateProfile(createProfile(name));
  };
  $("#createProfile").addEventListener("click", create);
  $("#newProfileName").addEventListener("keydown", e=>{ if(e.key==="Enter") create(); });
}

/* ===== Mode CLOUD : formulaire de connexion ===== */
function authFormHTML(){
  const signup = authMode==="signup";
  const nameField = signup ? `
      <div class="ctrl"><label>Nom affiché</label><input type="text" id="authName" placeholder="ex: Dupont, Brigade B…" maxlength="30" /></div>` : "";
  return `
    <div class="gate-head">
      <div class="shield">◈</div>
      <div><h3>${signup?"Créer un compte":"Connexion"}</h3>
      <p class="muted">Email + mot de passe. Synchronisé sur tous tes appareils.</p></div>
    </div>
    <div class="auth-form">
      ${nameField}
      <div class="ctrl"><label>Email</label><input type="email" id="authEmail" placeholder="prenom.nom@…" autocomplete="email" /></div>
      <div class="ctrl"><label>Mot de passe</label><input type="password" id="authPass" placeholder="••••••••" autocomplete="${signup?"new-password":"current-password"}" /></div>
      <p class="auth-msg" id="authMsg"></p>
      <button class="btn primary block" id="authSubmit">${signup?"Créer mon compte":"Se connecter"}</button>
      <p class="auth-switch">${signup?"Déjà un compte ?":"Pas encore de compte ?"}
        <a href="#" id="authSwitch">${signup?"Se connecter":"En créer un"}</a></p>
    </div>`;
}
function wireAuthForm(){
  const submit = ()=> authMode==="signup" ? doSignup() : doLogin();
  $("#authSubmit").addEventListener("click", submit);
  $("#authPass").addEventListener("keydown", e=>{ if(e.key==="Enter") submit(); });
  $("#authSwitch").addEventListener("click", e=>{ e.preventDefault(); authMode = authMode==="signup"?"login":"signup"; showGate(); });
}
function setAuthMsg(t, err=true){ const m=$("#authMsg"); if(m){ m.textContent=t; m.className="auth-msg"+(err?" err":" ok"); } }

async function doLogin(){
  const email=$("#authEmail").value.trim(), password=$("#authPass").value;
  if(!email||!password){ setAuthMsg("Email et mot de passe requis."); return; }
  setAuthMsg("Connexion…", false);
  const { error } = await supa.auth.signInWithPassword({ email, password });
  if(error) setAuthMsg(traduireErreur(error.message));
}
async function doSignup(){
  const email=$("#authEmail").value.trim(), password=$("#authPass").value;
  const name=($("#authName")?$("#authName").value.trim():"");
  if(!name){ setAuthMsg("Indique un nom affiché."); return; }
  if(!email||!password){ setAuthMsg("Email et mot de passe requis."); return; }
  if(password.length<6){ setAuthMsg("Mot de passe : 6 caractères minimum."); return; }
  setAuthMsg("Création…", false);
  const { data, error } = await supa.auth.signUp({ email, password, options:{ data:{ display_name:name } } });
  if(error){ setAuthMsg(traduireErreur(error.message)); return; }
  if(!data.session){ setAuthMsg("Compte créé ! Vérifie ta boîte mail pour confirmer, puis connecte-toi.", false); authMode="login"; setTimeout(showGate,1800); }
}
function traduireErreur(m){
  m=(m||"").toLowerCase();
  if(m.includes("invalid login")) return "Email ou mot de passe incorrect.";
  if(m.includes("already registered")) return "Cet email a déjà un compte.";
  if(m.includes("confirm")) return "Confirme ton email avant de te connecter.";
  return "Erreur : "+m;
}

/* ===== Mode CLOUD : panneau compte (quand connecté) ===== */
function accountPanelHTML(){
  const dn = displayName();
  const roleBadge = isAdmin() ? `<span class="role-badge admin">ADMIN</span>` : `<span class="role-badge">Membre</span>`;
  return `
    <div class="gate-head">
      <div class="pavatar" style="width:42px;height:42px;font-size:1.1rem">${(dn[0]||"?").toUpperCase()}</div>
      <div><h3>${escapeHtml(dn)} ${roleBadge}</h3><p class="muted">${escapeHtml(cloudUser.email)}</p></div>
    </div>
    <div class="ctrl" style="margin-top:6px">
      <label>Nom affiché</label>
      <input type="text" id="acctName" maxlength="30" value="${escapeHtml(dn)}" />
    </div>
    <div class="modal-actions" style="justify-content:space-between;margin-top:14px">
      <button class="btn danger" id="acctLogout">Se déconnecter</button>
      <span>
        <button class="btn" id="acctClose">Fermer</button>
        <button class="btn primary" id="acctSave">Enregistrer</button>
      </span>
    </div>`;
}
function wireAccountPanel(){
  $("#acctClose").addEventListener("click", hideGate);
  $("#acctLogout").addEventListener("click", async ()=>{ await supa.auth.signOut(); });
  $("#acctSave").addEventListener("click", async ()=>{
    const name = $("#acctName").value.trim();
    if(!name){ alert("Le nom ne peut pas être vide."); return; }
    try{
      await supa.rpc("set_display_name", { name });
      cloudProfile = cloudProfile || {}; cloudProfile.display_name = name;
      refreshChipCloud(); hideGate();
    }catch(e){ alert("Erreur : "+e.message); }
  });
}

/* ===== CLOUD : init, login, sauvegarde ===== */
async function initCloud(){
  try{
    const mod = await import(SUPA_CDN);
    supa = mod.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  }catch(e){
    alert("Impossible de charger Supabase (connexion internet ?). L'appli ne peut pas démarrer en mode comptes.");
    return;
  }
  refreshChipCloud();
  const { data:{ session } } = await supa.auth.getSession();
  if(session && session.user) await onCloudLogin(session.user); else showGate();

  supa.auth.onAuthStateChange((_evt, sess)=>{
    if(sess && sess.user){ if(!cloudUser || cloudUser.id!==sess.user.id) onCloudLogin(sess.user); }
    else { cloudUser=null; cloudProfile=null; stopPresence(); refreshChipCloud(); showGate(); }
  });
}
async function onCloudLogin(user){
  cloudUser = user;
  hideGate();
  startPresence();
  try{
    const { data:prof } = await supa.from("profiles").select("display_name,role").eq("id", user.id).maybeSingle();
    cloudProfile = prof || {};
  }catch(e){ cloudProfile = {}; }
  refreshChipCloud();
  // cache local d'abord (affichage instantané + hors-ligne)
  let cached=null; try{ cached=JSON.parse(localStorage.getItem("cloud_cache::"+user.id)); }catch(e){}
  if(cached){ state=Object.assign(freshState(), cached); syncInputsFromState(); renderAll(); }
  // puis on récupère depuis le cloud
  try{
    const { data, error } = await supa.from("plannings").select("data").eq("user_id", user.id).maybeSingle();
    if(error) throw error;
    if(data && data.data){ state = Object.assign(freshState(), data.data); }
    else { state = freshState(); await supa.from("plannings").upsert({ user_id:user.id, data:state }); }
  }catch(e){ console.warn("Lecture cloud:", e.message); if(!cached) state=freshState(); }
  syncInputsFromState(); renderAll(); renderTypes();
}
function scheduleCloudSave(){
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(async ()=>{
    if(!cloudUser) return;
    try{ await supa.from("plannings").upsert({ user_id:cloudUser.id, data:state, updated_at:new Date().toISOString() }); }
    catch(e){ console.warn("Sauvegarde cloud échouée (gardée en local):", e.message); }
  }, 700);
}
function refreshChipCloud(){
  const name = cloudUser ? displayName() : "Connexion";
  $("#pName").textContent = name;
  $("#pAvatar").textContent = (name[0]||"?").toUpperCase();
}

/* Charge les .json si disponibles (sinon defauts) */
async function tryFetchJSON(path){
  try{
    const r = await fetch(path, {cache:"no-store"});
    if(!r.ok) return null;
    return await r.json();
  }catch(e){ return null; }
}

/* ===================== Init ===================== */
async function init(){
  // sécurité : la fenêtre "jour" doit être fermée au démarrage
  const mb = $("#modalBg"); mb.hidden = true; mb.style.display = "none";
  $("#partielWrap").hidden = true; $("#partielWrap").style.display = "none";

  const cfg = await tryFetchJSON("data/cadences.json");
  if(cfg && cfg.cadences) CONFIG = cfg;
  const cg = await tryFetchJSON("data/conges.json");
  if(cg && cg.types) FILE_TYPES = cg.types;

  $("#vacLabel").textContent = CONFIG.vacationLabel || fmtMin(CONFIG.vacationMinutes);
  buildCadenceSelect();
  bindEvents();
  bindProfileEvents();

  if(CLOUD){ await initCloud(); return; }

  migrateOldKey();
  let saved=null; try{ saved = localStorage.getItem(CURRENT_KEY); }catch(e){}
  const profiles = getProfiles();
  if(saved && profiles.find(p=>p.id===saved)){
    activateProfile(saved);
  } else {
    showGate();
  }
}

function syncInputsFromState(){
  if(!state.startDate){
    const t = new Date();
    state.startDate = isoOf(new Date(t.getFullYear(), t.getMonth(), t.getDate()));
    state.endDate = `${t.getFullYear()}-12-31`;
  }
  $("#cadenceSelect").value = state.cadence;
  $("#startDate").value = state.startDate;
  $("#endDate").value = state.endDate;
  $("#remH").value = Math.floor((state.remainingMinutes||0)/60) || "";
  $("#remM").value = (state.remainingMinutes||0)%60 || "";
  updateCadenceNote();
}

function migrateOldKey(){
  let old=null; try{ old = localStorage.getItem(OLD_KEY); }catch(e){}
  if(!old) return;
  if(getProfiles().length){ try{ localStorage.removeItem(OLD_KEY); }catch(e){} return; }
  try{
    const id = createProfile("Mon planning");
    localStorage.setItem(stateKeyFor(id), old);
    localStorage.setItem(CURRENT_KEY, id);
    localStorage.removeItem(OLD_KEY);
  }catch(e){}
}

function bindProfileEvents(){
  $("#profileChip").addEventListener("click", showGate);
  $("#profileGate").addEventListener("click", e=>{
    const canClose = CLOUD ? !!cloudUser : !!currentProfileId;
    if(e.target.id==="profileGate" && canClose) hideGate();
  });
  const rb = $("#refreshBtn");
  if(rb) rb.addEventListener("click", ()=> hardRefresh(rb));
}

async function hardRefresh(btn){
  if(btn) btn.classList.add("spin");
  // 1) on s'assure que les données en cours sont bien enregistrées dans le cloud
  try{
    if(CLOUD && cloudUser){
      await supa.from("plannings").upsert({ user_id:cloudUser.id, data:state, updated_at:new Date().toISOString() });
    }
  }catch(e){ /* on recharge quand même */ }
  // 2) rechargement en contournant le cache (récupère la dernière version mise en ligne)
  const base = location.origin + location.pathname;
  location.replace(base + "?r=" + Date.now());
}

function buildCadenceSelect(){
  const sel = $("#cadenceSelect");
  sel.innerHTML = "";
  for(const [key,c] of Object.entries(CONFIG.cadences)){
    const o = document.createElement("option");
    o.value = key; o.textContent = c.label;
    sel.appendChild(o);
  }
}

/* ===================== Evenements ===================== */
function bindEvents(){
  $$(".tab").forEach(t => t.addEventListener("click", () => {
    $$(".tab").forEach(x=>x.classList.remove("active"));
    $$(".panel").forEach(x=>x.classList.remove("active"));
    t.classList.add("active");
    $("#tab-"+t.dataset.tab).classList.add("active");
    if(t.dataset.tab==="heures") renderHours();
    if(t.dataset.tab==="equipe") renderTeamTab();
    if(t.dataset.tab==="membres") renderMembersTab();
    if(t.dataset.tab==="reglages") renderTypes();
  }));

  $("#cadenceSelect").addEventListener("change", e=>{ state.cadence=e.target.value; updateCadenceNote(); });
  $("#genBtn").addEventListener("click", ()=>{
    state.cadence = $("#cadenceSelect").value;
    state.startDate = $("#startDate").value;
    state.endDate = $("#endDate").value;
    if(!state.startDate || !state.endDate){ alert("Choisis une date de debut et de fin."); return; }
    if(parseISO(state.endDate) < parseISO(state.startDate)){ alert("La fin doit etre apres le debut."); return; }
    save(); renderAll();
  });

  // Modale
  $("#closeModal").addEventListener("click", closeModal);
  $("#modalBg").addEventListener("click", e=>{ if(e.target.id==="modalBg") closeModal(); });
  $("#clearDay").addEventListener("click", ()=>{ if(modalDateISO){ delete state.leaves[modalDateISO]; save(); closeModal(); renderAll(); } });
  $("#saveDay").addEventListener("click", saveDay);

  // Heures
  $("#saveHours").addEventListener("click", ()=>{
    const h = parseInt($("#remH").value||0,10);
    const m = parseInt($("#remM").value||0,10);
    state.remainingMinutes = Math.max(0, h*60 + m);
    save(); renderHours();
  });

  // Reglages
  $("#addType").addEventListener("click", addType);
  $("#expConges").addEventListener("click", ()=> download("conges.json", JSON.stringify({types:state.types}, null, 2)));
  $("#expAll").addEventListener("click", ()=> download("mon-planning.json", JSON.stringify(state, null, 2)));
  $("#impFile").addEventListener("change", importJSON);
  $("#resetAll").addEventListener("click", ()=>{
    if(confirm("Réinitialiser le planning de CE profil (les autres profils ne sont pas touchés) ?")){
      state = freshState();
      save(); syncInputsFromState(); renderAll(); renderTypes();
    }
  });
}

function updateCadenceNote(){
  const c = CONFIG.cadences[$("#cadenceSelect").value];
  $("#cadenceNote").textContent = c ? c.description : "";
}

/* ===================== Generation du planning ===================== */
function buildDays(){
  const out = [];
  if(!state.startDate || !state.endDate) return out;
  const cyc = CONFIG.cadences[state.cadence].cycle;
  const start = parseISO(state.startDate);
  const end = parseISO(state.endDate);
  let i = 0;
  for(let d = new Date(start); d <= end; d.setDate(d.getDate()+1)){
    const iso = isoOf(d);
    const isWork = cyc[i % cyc.length] === 1;
    out.push({ iso, date:new Date(d), work:isWork });
    i++;
  }
  return out;
}

/* ===================== Rendu ===================== */
function renderAll(){ renderLegend(); renderCalendar(); renderHours(); }

function renderLegend(){
  const el = $("#legend");
  const t = CONFIG.cadences[state.cadence].type;
  let html = `<span class="lg"><span class="dot" style="background:#f59e0b"></span>Vacation ${CONFIG.vacationLabel} (${t})</span>`;
  html += `<span class="lg"><span class="dot" style="background:#1c2740"></span>Repos</span>`;
  state.types.forEach(ty=>{
    html += `<span class="lg"><span class="dot" style="background:${ty.couleur}"></span>${ty.code}</span>`;
  });
  el.innerHTML = html;
}

function renderCalendar(){
  const cal = $("#calendar");
  const days = buildDays();
  if(!days.length){ cal.innerHTML = `<p class="empty">Choisis une cadence et des dates puis « Générer ».</p>`; return; }

  // Resume
  const workDays = days.filter(d=>d.work).length;
  const leavesCount = days.filter(d=>state.leaves[d.iso]).length;
  const workMin = workDays * CONFIG.vacationMinutes;
  $("#planSummary").innerHTML = `
    <div class="s"><b>${workDays}</b><span>vacations</span></div>
    <div class="s"><b>${fmtMin(workMin)}</b><span>temps de travail</span></div>
    <div class="s"><b>${leavesCount}</b><span>jours posés</span></div>
    <div class="s"><b>${days.length}</b><span>jours au total</span></div>`;

  // Groupage par mois
  const months = {};
  days.forEach(d=>{
    const key = d.date.getFullYear()+"-"+d.date.getMonth();
    (months[key] = months[key] || []).push(d);
  });

  let html = "";
  for(const key of Object.keys(months)){
    const arr = months[key];
    const first = arr[0].date;
    const title = capit(first.toLocaleDateString("fr-FR",{month:"long",year:"numeric"}));
    const wd = arr.filter(d=>d.work).length;
    html += `<div class="month"><h3>${title}<small>${wd} vacation(s)</small></h3><div class="days">`;
    arr.forEach(d=>{
      const dow = d.date.toLocaleDateString("fr-FR",{weekday:"short"});
      const we = (d.date.getDay()===0 || d.date.getDay()===6) ? " we":"";
      const lv = state.leaves[d.iso];
      const cls = (d.work?"work":"rest") + we + (lv?" has-leave":"");
      let leaveTag = "";
      if(lv){
        const ty = typeByCode(lv.code);
        const col = ty ? ty.couleur : "#888";
        leaveTag = `<span class="leave" style="background:${col}">${lv.code}</span>`;
        if(ty && ty.partiel) leaveTag += `<span class="leave-min">${fmtMin(lv.minutes)}</span>`;
      }
      const badge = d.work ? `<span class="badge">${CONFIG.vacationLabel}</span>` : `<span class="badge">Repos</span>`;
      html += `<div class="day ${cls}" data-iso="${d.iso}">
        <div class="dow">${dow}</div>
        <div class="num">${d.date.getDate()}</div>
        ${badge}${leaveTag}
      </div>`;
    });
    html += `</div></div>`;
  }
  cal.innerHTML = html;

  $$(".day").forEach(el=> el.addEventListener("click", ()=> openModal(el.dataset.iso)));
}

/* ===================== Modale jour ===================== */
function openModal(iso){
  modalDateISO = iso;
  const days = buildDays();
  const dd = days.find(d=>d.iso===iso);
  const date = parseISO(iso);
  $("#modalDate").textContent = capit(date.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"}));
  $("#modalState").textContent = dd && dd.work ? `Jour travaillé — vacation ${CONFIG.vacationLabel}` : "Jour de repos";

  const cur = state.leaves[iso];
  modalSelected = cur ? cur.code : null;

  const wrap = $("#modalTypes");
  wrap.innerHTML = "";
  state.types.forEach(ty=>{
    const b = document.createElement("button");
    b.className = "mt" + (modalSelected===ty.code?" sel":"");
    b.innerHTML = `<span class="dot" style="background:${ty.couleur}"></span>${ty.code}`;
    b.title = ty.label;
    b.addEventListener("click", ()=>{
      modalSelected = (modalSelected===ty.code)? null : ty.code;
      $$("#modalTypes .mt").forEach(x=>x.classList.remove("sel"));
      if(modalSelected===ty.code) b.classList.add("sel");
      togglePartiel();
    });
    wrap.appendChild(b);
  });

  const partH = $("#partielH");
  partH.value = (cur && cur.minutes!=null) ? (cur.minutes/60) : "";
  togglePartiel();

  const mb = $("#modalBg"); mb.hidden = false; mb.style.display = "grid";
}
function togglePartiel(){
  const ty = modalSelected ? typeByCode(modalSelected) : null;
  const show = !!(ty && ty.partiel);
  const w = $("#partielWrap");
  w.hidden = !show; w.style.display = show ? "flex" : "none";
}
function saveDay(){
  if(!modalDateISO) return;
  if(!modalSelected){ delete state.leaves[modalDateISO]; }
  else{
    const ty = typeByCode(modalSelected);
    let minutes = ty.minutesParDefaut;
    if(ty.partiel){
      const h = parseFloat($("#partielH").value||0);
      minutes = Math.round(h*60);
    }
    state.leaves[modalDateISO] = { code:modalSelected, minutes };
  }
  save(); closeModal(); renderAll();
}
function closeModal(){ const mb=$("#modalBg"); mb.hidden = true; mb.style.display="none"; modalDateISO=null; modalSelected=null; }

/* Statut d'un jour pour un planning donné (utilisé aussi pour l'équipe) */
function cycleFor(key){ return (CONFIG.cadences[key] || CONFIG.cadences["2-2-3"]).cycle; }
function dayStatus(st, dateISO){
  if(!st || !st.startDate || !st.endDate) return { inRange:false };
  const d = parseISO(dateISO), s = parseISO(st.startDate), e = parseISO(st.endDate);
  if(d < s || d > e) return { inRange:false };
  const cyc = cycleFor(st.cadence);
  const off = Math.round((d - s) / 86400000);
  const work = cyc[((off % cyc.length) + cyc.length) % cyc.length] === 1;
  const leave = st.leaves ? st.leaves[dateISO] : null;
  return { inRange:true, work, leave };
}

/* ===================== Onglet ÉQUIPE ===================== */
let teamGroups = [], selGroup = null, teamMonth = null, teamMembers = [], teamPlannings = {};
function displayName(){
  if(cloudProfile && cloudProfile.display_name) return cloudProfile.display_name;
  return cloudUser ? cloudUser.email.split("@")[0] : "Moi";
}
function isAdmin(){ return !!(cloudProfile && cloudProfile.role === "admin"); }
function leaveColor(code, st){
  const arr = (st && st.types) || state.types || [];
  const t = arr.find(x=>x.code===code);
  return t ? t.couleur : "#8b949e";
}

async function renderTeamTab(){
  const root = $("#teamRoot");
  if(!CLOUD){
    root.innerHTML = `<div class="card"><h2>Équipe / brigade</h2><p class="muted">Cette fonction nécessite le mode comptes (Supabase). Voir <b>GUIDE-SUPABASE.md</b> → section « Activer les équipes ».</p></div>`;
    return;
  }
  if(!cloudUser){
    root.innerHTML = `<div class="card"><h2>Équipe / brigade</h2><p class="muted">Connecte-toi pour créer ou rejoindre une brigade.</p><button class="btn primary" id="teamLogin">Se connecter</button></div>`;
    $("#teamLogin").addEventListener("click", showGate);
    return;
  }
  root.innerHTML = `<div class="card" id="teamManage"></div><div id="teamView"></div>`;
  await loadGroups();
}

async function loadGroups(){
  try{
    const { data, error } = await supa.from("groups").select("id,name,code");
    if(error) throw error;
    teamGroups = data || [];
  }catch(e){ teamGroups = []; console.warn("groups:", e.message); }
  renderTeamManage();
}

function renderTeamManage(){
  const el = $("#teamManage");
  const list = teamGroups.length ? teamGroups.map(g=>`
    <div class="grp-row">
      <span class="grp-name">${escapeHtml(g.name)}</span>
      <span class="grp-code">code <b>${g.code}</b> <button class="mini" data-copy="${g.code}">copier</button></span>
      <span class="grp-act">
        <button class="btn small" data-open="${g.id}">Voir</button>
        <button class="btn small danger" data-leave="${g.id}">Quitter</button>
      </span>
    </div>`).join("") : `<p class="empty">Tu n'es dans aucune brigade. Crée-en une ou rejoins-en une avec un code.</p>`;
  el.innerHTML = `
    <h2>Mes brigades</h2>
    <div class="grp-list">${list}</div>
    <div class="grp-forms">
      <div class="grp-form"><input id="grpNew" placeholder="Nom de la brigade…" maxlength="30" /><button class="btn primary" id="grpCreate">Créer</button></div>
      <div class="grp-form"><input id="grpCode" placeholder="Code à rejoindre…" maxlength="6" /><button class="btn" id="grpJoin">Rejoindre</button></div>
    </div>`;
  $("#grpCreate").addEventListener("click", createGroup);
  $("#grpJoin").addEventListener("click", joinGroup);
  $$("#teamManage [data-copy]").forEach(b=> b.addEventListener("click", ()=>{
    try{ navigator.clipboard.writeText(b.dataset.copy); b.textContent="copié !"; setTimeout(()=>b.textContent="copier",1200); }catch(e){}
  }));
  $$("#teamManage [data-open]").forEach(b=> b.addEventListener("click", ()=> openGroup(b.dataset.open)));
  $$("#teamManage [data-leave]").forEach(b=> b.addEventListener("click", ()=> leaveGroup(b.dataset.leave)));
}

async function createGroup(){
  const name = $("#grpNew").value.trim();
  if(!name) return alert("Donne un nom à la brigade.");
  try{
    const { data, error } = await supa.rpc("create_group", { group_name:name, display:displayName() });
    if(error) throw error;
    const g = Array.isArray(data) ? data[0] : data;
    await loadGroups();
    if(g) openGroup(g.id);
  }catch(e){ alert("Erreur création : "+e.message); }
}
async function joinGroup(){
  const code = $("#grpCode").value.trim();
  if(!code) return alert("Entre un code.");
  try{
    const { data, error } = await supa.rpc("join_group", { join_code:code, display:displayName() });
    if(error) throw error;
    const g = Array.isArray(data) ? data[0] : data;
    await loadGroups();
    if(g) openGroup(g.id);
  }catch(e){ alert("Code invalide ou erreur : "+e.message); }
}
async function leaveGroup(gid){
  if(!confirm("Quitter cette brigade ?")) return;
  try{ await supa.rpc("leave_group", { gid }); }catch(e){ alert("Erreur : "+e.message); }
  if(selGroup && selGroup.id===gid){ selGroup=null; $("#teamView").innerHTML=""; }
  await loadGroups();
}

async function openGroup(gid){
  selGroup = teamGroups.find(g=>g.id===gid) || { id:gid, name:"Brigade", code:"" };
  try{
    const { data:mem } = await supa.from("group_members").select("user_id,display_name,crew").eq("group_id", gid);
    teamMembers = mem || [];
    const ids = teamMembers.map(m=>m.user_id);
    teamPlannings = {};
    if(ids.length){
      const { data:pl } = await supa.from("plannings").select("user_id,data").in("user_id", ids);
      (pl||[]).forEach(p=> teamPlannings[p.user_id] = p.data || {});
    }
    teamPlannings[cloudUser.id] = state; // mes données à jour (même non encore sync)
  }catch(e){ console.warn("openGroup:", e.message); }
  if(!teamMonth) teamMonth = new Date();
  renderTeam();
}

function renderTeam(){
  const view = $("#teamView");
  if(!selGroup){ view.innerHTML=""; return; }
  const y = teamMonth.getFullYear(), m = teamMonth.getMonth();
  const nDays = new Date(y, m+1, 0).getDate();
  const monthName = capit(teamMonth.toLocaleDateString("fr-FR",{month:"long",year:"numeric"}));
  const todayISO = isoOf(new Date());

  let head = `<th class="mname">Membre</th>`;
  for(let d=1; d<=nDays; d++){
    const dt = new Date(y,m,d);
    const we = (dt.getDay()===0||dt.getDay()===6) ? " we":"";
    head += `<th class="dcol${we}"><span>${d}</span><small>${dt.toLocaleDateString("fr-FR",{weekday:"narrow"})}</small></th>`;
  }

  teamMembers.sort((a,b)=>(a.display_name||"").localeCompare(b.display_name||""));
  let rows = "";
  teamMembers.forEach(mem=>{
    const st = teamPlannings[mem.user_id] || {};
    const isMe = mem.user_id===cloudUser.id;
    let cells = "";
    for(let d=1; d<=nDays; d++){
      const iso = isoOf(new Date(y,m,d));
      const s = dayStatus(st, iso);
      const today = iso===todayISO ? " today":"";
      if(!s.inRange){ cells += `<td class="cell out${today}"></td>`; }
      else if(s.leave){ cells += `<td class="cell lv${today}" style="background:${leaveColor(s.leave.code, st)}" title="${escapeHtml(s.leave.code)}">${escapeHtml(s.leave.code[0])}</td>`; }
      else if(s.work){ cells += `<td class="cell work${today}" title="Vacation 12h08"></td>`; }
      else { cells += `<td class="cell rest${today}"></td>`; }
    }
    rows += `<tr><td class="mname${isMe?' me':''}">${escapeHtml(mem.display_name||'?')}</td>${cells}</tr>`;
  });

  const gridCard = `
   <div class="card">
     <div class="team-head">
       <div><h2>${escapeHtml(selGroup.name)}</h2>
         <p class="muted">Code <b>${selGroup.code||''}</b> · ${teamMembers.length} membre(s)</p></div>
       <div class="month-nav">
         <button class="btn small" id="tmPrev">‹</button>
         <span>${monthName}</span>
         <button class="btn small" id="tmNext">›</button>
       </div>
     </div>
     <div class="team-scroll"><table class="team-grid"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>
     <div class="legend" style="margin-top:14px">
       <span class="lg"><span class="dot" style="background:#f0a23c"></span>Vacation</span>
       <span class="lg"><span class="dot" style="background:#e7eaf1"></span>Repos</span>
       <span class="lg"><span class="dot" style="background:#4f46e5"></span>Congé (lettre = code)</span>
     </div>
   </div>`;

  const cycleDays = computeNextCycle(state);
  view.innerHTML = nextCycleHTML(cycleDays) + crewsHTML(cycleDays) + gridCard;

  $("#tmPrev").addEventListener("click", ()=>{ teamMonth = new Date(y, m-1, 1); renderTeam(); });
  $("#tmNext").addEventListener("click", ()=>{ teamMonth = new Date(y, m+1, 1); renderTeam(); });
  $$("#teamView [data-mine]").forEach(b=> b.addEventListener("click", ()=> setMyCrew(b.dataset.mine)));
  $$("#teamView .crew-set").forEach(s=> s.addEventListener("change", ()=> setMemberCrew(s.dataset.uid, s.value)));
}

/* Prochain cycle = prochain bloc de vacations du planning de l'utilisateur */
function computeNextCycle(st){
  if(!st || !st.startDate || !st.endDate) return [];
  const end = parseISO(st.endDate);
  const isW = (dt)=>{ const s = dayStatus(st, isoOf(dt)); return s.inRange && s.work; };
  let d = new Date(); d.setHours(12,0,0,0);
  let g = 0;
  if(isW(d)){ while(isW(d) && g++<500){ d.setDate(d.getDate()+1); } } // sortir du cycle en cours
  while(!isW(d) && d <= end && g++<900){ d.setDate(d.getDate()+1); }   // aller au prochain jour travaillé
  const out = [];
  while(isW(d) && d <= end && out.length < 12){ out.push(isoOf(d)); d.setDate(d.getDate()+1); }
  return out;
}
function cycleCells(st, days){
  return days.map(iso=>{
    const s = dayStatus(st, iso);
    if(!s.inRange) return `<span class="cc out"></span>`;
    if(s.leave) return `<span class="cc lv" style="background:${leaveColor(s.leave.code, st)}" title="${escapeHtml(s.leave.code)}">${escapeHtml(s.leave.code[0])}</span>`;
    if(s.work) return `<span class="cc work" title="Vacation"></span>`;
    return `<span class="cc rest" title="Repos"></span>`;
  }).join("");
}
function nextCycleHTML(days){
  if(!days.length) return `<div class="card"><div class="card-head"><h2>Prochain cycle</h2></div><p class="empty">Génère d'abord ton planning (onglet Planning) pour calculer ton prochain cycle.</p></div>`;
  const dstr = capit(parseISO(days[0]).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"}))
    + " → " + capit(parseISO(days[days.length-1]).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"}));
  const cols = days.map(iso=>{
    let present=0, leave=0;
    teamMembers.forEach(mem=>{ const s=dayStatus(teamPlannings[mem.user_id]||{}, iso); if(s.inRange && s.work){ if(s.leave) leave++; else present++; } });
    const d = parseISO(iso);
    return `<div class="cyc-day">
      <div class="cyc-d">${capit(d.toLocaleDateString("fr-FR",{weekday:"short"}))} ${d.getDate()}/${d.getMonth()+1}</div>
      <div class="cyc-n"><b>${present}</b> au travail</div>
      <div class="cyc-l">${leave} en congé</div></div>`;
  }).join("");
  return `<div class="card">
    <div class="card-head"><h2>Prochain cycle</h2></div>
    <p class="muted">${days.length} vacation(s) · ${dstr}</p>
    <div class="cyc-grid">${cols}</div></div>`;
}
function crewsHTML(days){
  const order = ["Alpha","Bravo","Charlie"];
  const groups = {};
  teamMembers.forEach(m=>{ const c = m.crew || "__none"; (groups[c]=groups[c]||[]).push(m); });
  const keys = [...order.filter(k=>groups[k]),
                ...Object.keys(groups).filter(k=>!order.includes(k) && k!=="__none"),
                ...(groups["__none"]?["__none"]:[])];
  const myCrew = (teamMembers.find(m=>m.user_id===cloudUser.id)||{}).crew || "";
  const admin = isAdmin();
  const dayHead = days.map(iso=>{ const d=parseISO(iso); return `<span class="cc-h">${d.getDate()}</span>`; }).join("");

  const body = keys.length ? keys.map(k=>{
    const title = k==="__none" ? "Sans équipage" : `${escapeHtml(selGroup.name)} ${k}`;
    const list = groups[k].map(mem=>{
      const st = teamPlannings[mem.user_id] || {};
      const isMe = mem.user_id===cloudUser.id;
      const cells = days.length ? `<span class="cc-row">${cycleCells(st, days)}</span>` : "";
      let sel = "";
      if(admin){
        sel = `<select class="crew-set" data-uid="${mem.user_id}"><option value="">—</option>`
          + ["Alpha","Bravo","Charlie"].map(c=>`<option value="${c}"${mem.crew===c?" selected":""}>${c}</option>`).join("")
          + `</select>`;
      }
      return `<div class="crew-mem"><span class="cm-name">${escapeHtml(mem.display_name||'?')}${isMe?' <em>(moi)</em>':''}</span>${cells}${sel}</div>`;
    }).join("");
    return `<div class="crew-block"><div class="crew-title">${title}<span class="crew-count">${groups[k].length}</span></div>
      ${days.length?`<div class="cc-head"><span class="cm-name"></span><span class="cc-row">${dayHead}</span></div>`:""}
      ${list}</div>`;
  }).join("") : `<p class="empty">Aucun membre.</p>`;

  const picker = `<div class="crew-picker"><span class="cp-label">Mon équipage :</span>`
    + ["Alpha","Bravo","Charlie"].map(c=>`<button class="mini${myCrew===c?' on':''}" data-mine="${c}">${c}</button>`).join("")
    + `<button class="mini${!myCrew?' on':''}" data-mine="">Aucun</button></div>`;

  return `<div class="card">
    <div class="card-head"><h2>Équipages — prochain cycle</h2></div>
    ${picker}${body}</div>`;
}
async function setMyCrew(c){
  try{ await supa.rpc("set_crew",{ gid:selGroup.id, crew_name:c }); await openGroup(selGroup.id); }
  catch(e){ alert("Erreur : "+e.message); }
}
async function setMemberCrew(uid, c){
  try{ await supa.rpc("set_member_crew",{ gid:selGroup.id, target:uid, crew_name:c }); await openGroup(selGroup.id); }
  catch(e){ alert("Erreur : "+e.message); }
}
/* ===================== Présence + MEMBRES ===================== */
async function pingPresence(){
  if(!cloudUser) return;
  try{ await supa.rpc("ping"); }catch(e){ /* ignore */ }
}
function startPresence(){
  pingPresence();
  clearInterval(presenceTimer);
  presenceTimer = setInterval(pingPresence, 60000); // toutes les 60 s
}
function stopPresence(){ clearInterval(presenceTimer); presenceTimer=null; }

function timeAgo(iso){
  if(!iso) return "jamais";
  const s = Math.floor((Date.now() - new Date(iso).getTime())/1000);
  if(s < 60) return "à l'instant";
  if(s < 3600) return "il y a "+Math.floor(s/60)+" min";
  if(s < 86400) return "il y a "+Math.floor(s/3600)+" h";
  return "il y a "+Math.floor(s/86400)+" j";
}
function onlineState(iso){
  if(!iso) return "off";
  const s = (Date.now() - new Date(iso).getTime())/1000;
  if(s < 120) return "on";       // < 2 min = en ligne
  if(s < 900) return "idle";     // < 15 min = récent
  return "off";
}

async function renderMembersTab(){
  const root = $("#membersRoot");
  if(!CLOUD){
    root.innerHTML = `<div class="card"><h2>Membres</h2><p class="muted">Disponible en mode comptes (Supabase). Voir <b>database.sql</b> et <b>GUIDE-SUPABASE.md</b>.</p></div>`;
    return;
  }
  if(!cloudUser){
    root.innerHTML = `<div class="card"><h2>Membres</h2><p class="muted">Connecte-toi pour voir les inscrits et qui est en ligne.</p><button class="btn primary" id="memLogin">Se connecter</button></div>`;
    $("#memLogin").addEventListener("click", showGate);
    return;
  }
  root.innerHTML = `<div class="stats" id="memStats"></div>
    <div class="card"><div class="mem-head"><h2>Liste des inscrits</h2><button class="btn small" id="memRefresh">Rafraîchir</button></div>
    <div id="memList" class="posed-list"><p class="empty">Chargement…</p></div></div>`;
  $("#memRefresh").addEventListener("click", loadMembers);
  await pingPresence();
  await loadMembers();
}

async function loadMembers(){
  let rows = [];
  try{
    const { data, error } = await supa.from("profiles").select("id,email,display_name,role,created_at,last_seen").order("last_seen",{ascending:false});
    if(error) throw error;
    rows = data || [];
  }catch(e){
    $("#memList").innerHTML = `<p class="empty">Impossible de lire la liste (as-tu exécuté <b>database.sql</b> ?). ${escapeHtml(e.message)}</p>`;
    return;
  }
  const online = rows.filter(r=>onlineState(r.last_seen)==="on").length;
  const admins = rows.filter(r=>r.role==="admin").length;
  $("#memStats").innerHTML = `
    <div class="stat"><b>${rows.length}</b><span>inscrits</span></div>
    <div class="stat good"><b>${online}</b><span>en ligne maintenant</span></div>
    <div class="stat"><b>${admins}</b><span>admin(s)</span></div>`;
  if(!rows.length){ $("#memList").innerHTML = `<p class="empty">Aucun inscrit pour le moment.</p>`; return; }

  const admin = isAdmin();
  $("#memList").innerHTML = rows.map(r=>{
    const st = onlineState(r.last_seen);
    const isMe = r.id===cloudUser.id;
    const dn = r.display_name || (r.email||"—").split("@")[0];
    const label = st==="on" ? "en ligne" : timeAgo(r.last_seen);
    const badge = r.role==="admin" ? `<span class="role-badge admin">ADMIN</span>` : "";
    let actions = "";
    if(admin){
      const toggle = r.role==="admin"
        ? `<button class="mini" data-role="user" data-id="${r.id}">retirer admin</button>`
        : `<button class="mini" data-role="admin" data-id="${r.id}">promouvoir admin</button>`;
      actions = `<span class="mem-actions">${toggle}<button class="mini danger" data-reset="${r.id}">réinit. planning</button></span>`;
    }
    return `<div class="posed-row mem-row">
      <span class="mem-id"><span class="online ${st}"></span><b>${escapeHtml(dn)}</b>${badge}${isMe?' <em>(moi)</em>':''}<small class="mem-email">${escapeHtml(r.email||"")}</small></span>
      <span class="mem-right"><span class="mem-meta">${label}</span>${actions}</span>
    </div>`;
  }).join("");

  if(admin){
    $$("#memList [data-role]").forEach(b=> b.addEventListener("click", async ()=>{
      try{ await supa.rpc("set_role",{ target:b.dataset.id, new_role:b.dataset.role }); await loadMembers(); }
      catch(e){ alert("Erreur : "+e.message); }
    }));
    $$("#memList [data-reset]").forEach(b=> b.addEventListener("click", async ()=>{
      if(!confirm("Réinitialiser (vider) le planning de ce membre ?")) return;
      try{ await supa.rpc("admin_reset_planning",{ target:b.dataset.reset }); alert("Planning réinitialisé."); }
      catch(e){ alert("Erreur : "+e.message); }
    }));
  }
}

function renderHours(){
  const days = buildDays();
  let consumed = 0, posedCount = 0;
  const posed = [];
  days.forEach(d=>{
    const lv = state.leaves[d.iso];
    if(!lv) return;
    const ty = typeByCode(lv.code);
    posedCount++;
    const c = (ty && ty.consommeHeures) ? lv.minutes : 0;
    consumed += c;
    posed.push({ iso:d.iso, date:d.date, lv, ty, cost:c });
  });

  const remaining = state.remainingMinutes;
  const available = remaining - consumed;
  const vacM = CONFIG.vacationMinutes;
  const bookable = available > 0 ? Math.floor(available / vacM) : 0;

  const availClass = available < 0 ? "bad" : (available < vacM ? "warn" : "good");
  $("#hourStats").innerHTML = `
    <div class="stat"><b>${fmtMin(remaining)}</b><span>heures restantes</span></div>
    <div class="stat warn"><b>${fmtMin(consumed)}</b><span>déjà posé (${posedCount} jour·s)</span></div>
    <div class="stat ${availClass}"><b>${fmtMin(available)}</b><span>heures disponibles</span></div>
    <div class="stat good"><b>${bookable}</b><span>vacations posables (${CONFIG.vacationLabel})</span></div>`;

  // Liste detaillee
  const list = $("#posedList");
  if(!posed.length){ list.innerHTML = `<p class="empty">Aucun congé posé. Clique sur un jour du planning pour en ajouter.</p>`; return; }
  posed.sort((a,b)=>a.iso.localeCompare(b.iso));
  list.innerHTML = posed.map(p=>{
    const col = p.ty ? p.ty.couleur : "#888";
    const lbl = p.ty ? p.ty.label : p.lv.code;
    const dstr = capit(p.date.toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short"}));
    const cost = p.cost ? `−${fmtMin(p.cost)}` : "n'entame pas le compteur";
    return `<div class="posed-row">
      <span><span class="tag" style="background:${col}">${p.lv.code}</span> ${dstr} — ${lbl}</span>
      <span>${cost} <button class="rm" data-iso="${p.iso}">✕</button></span>
    </div>`;
  }).join("");
  $$("#posedList .rm").forEach(b=> b.addEventListener("click", ()=>{
    delete state.leaves[b.dataset.iso]; save(); renderAll();
  }));
}

/* ===================== Onglet Reglages ===================== */
function renderTypes(){
  const el = $("#typesTable");
  el.innerHTML = state.types.map((t,i)=>{
    const meta = t.consommeHeures ? `consomme ${fmtMin(t.minutesParDefaut)}${t.partiel?" (partiel)":""}` : "service — pas d'heures";
    return `<div class="type-row">
      <span class="code" style="background:${t.couleur}">${t.code}</span>
      <span class="nm">${t.label}</span>
      <span class="meta">${meta}</span>
      <button class="rm" data-i="${i}">Supprimer</button>
    </div>`;
  }).join("");
  $$("#typesTable .rm").forEach(b=> b.addEventListener("click", ()=>{
    state.types.splice(parseInt(b.dataset.i,10),1); save(); renderTypes(); renderLegend();
  }));
}
function addType(){
  const code = $("#ntCode").value.trim().toUpperCase();
  const label = $("#ntLabel").value.trim();
  if(!code || !label){ alert("Code et libellé requis."); return; }
  if(typeByCode(code)){ alert("Ce code existe déjà."); return; }
  state.types.push({
    code, label,
    couleur: $("#ntColor").value,
    consommeHeures: $("#ntConsume").checked,
    minutesParDefaut: parseInt($("#ntMinutes").value||0,10),
    partiel: $("#ntPartiel").checked,
    categorie: $("#ntConsume").checked ? "conge" : "service"
  });
  $("#ntCode").value=""; $("#ntLabel").value="";
  save(); renderTypes(); renderLegend();
}

/* ===================== Import / Export ===================== */
function download(name, text){
  const blob = new Blob([text], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
function importJSON(e){
  const f = e.target.files[0]; if(!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const data = JSON.parse(reader.result);
      if(data.types && data.leaves !== undefined){ // sauvegarde complete
        Object.assign(state, data);
      } else if(data.types){ // juste conges.json
        state.types = data.types;
      } else { alert("JSON non reconnu."); return; }
      save();
      $("#cadenceSelect").value = state.cadence || $("#cadenceSelect").value;
      $("#startDate").value = state.startDate || "";
      $("#endDate").value = state.endDate || "";
      $("#remH").value = Math.floor((state.remainingMinutes||0)/60) || "";
      $("#remM").value = (state.remainingMinutes||0)%60 || "";
      renderAll(); renderTypes();
      alert("Import réussi.");
    }catch(err){ alert("Fichier illisible : "+err.message); }
  };
  reader.readAsText(f);
  e.target.value = "";
}

/* ===================== Go ===================== */
init();