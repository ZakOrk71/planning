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
    remainingMinutes: 0,
    remainingByType: {}
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
  const roleBadge = roleBadgeHTML(cloudProfile ? cloudProfile.role : "user");
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
    else { cloudUser=null; cloudProfile=null; stopPresence(); refreshChipCloud(); const at=$("#adminTab"); if(at) at.hidden=true; showGate(); }
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
  const adminTab = $("#adminTab"); if(adminTab) adminTab.hidden = !isAdmin();
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
  initTheme();
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
  const remH = $("#remH"); if(remH) remH.value = Math.floor((state.remainingMinutes||0)/60) || "";
  const remM = $("#remM"); if(remM) remM.value = (state.remainingMinutes||0)%60 || "";
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
  const tb = $("#themeBtn");
  if(tb) tb.addEventListener("click", toggleTheme);
}

async function hardRefresh(btn){
  if(btn){ btn.classList.add("spin"); btn.disabled = true; }
  const t0 = Date.now();
  try{
    if(CLOUD && cloudUser){
      await supa.from("plannings").upsert({ user_id:cloudUser.id, data:state, updated_at:new Date().toISOString() });
    }
  }catch(e){ /* on recharge quand même */ }
  // Garantit 700ms d'animation visible avant le rechargement
  const elapsed = Date.now() - t0;
  if(elapsed < 700) await new Promise(r => setTimeout(r, 700 - elapsed));
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
    if(t.dataset.tab==="admin") renderAdminTab();
    if(t.dataset.tab==="feuille") renderCycleTab();
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
  $("#clearDay").addEventListener("click", async ()=>{
    if(!modalDateISO) return;
    if(teamEditUID){
      try{
        const { error } = await supa.rpc("chef_save_leave",{ target_uid:teamEditUID, date_iso:modalDateISO, leave_code:"", leave_minutes:0 });
        if(error) throw error;
        if(teamEditMemberSt && teamEditMemberSt.leaves) delete teamEditMemberSt.leaves[modalDateISO];
        const cb = teamEditCallback; closeModal(); if(cb) cb(); else renderTeam();
      }catch(e){ alert("Erreur : "+e.message); }
      return;
    }
    delete state.leaves[modalDateISO]; save(); closeModal(); renderAll();
  });
  $("#saveDay").addEventListener("click", ()=> saveDay());

  // Heures — lecture des inputs dynamiques par type
  $("#saveHours").addEventListener("click", ()=>{
    if(!state.remainingByType) state.remainingByType = {};
    $$(".rem-h-inp").forEach(inp=>{
      const code = inp.dataset.code;
      const mInp = document.querySelector(`.rem-m-inp[data-code="${code}"]`);
      const h = parseInt(inp.value||0,10), m = parseInt(mInp?mInp.value||0:0,10);
      state.remainingByType[code] = Math.max(0, h*60+m);
    });
    state.remainingMinutes = Object.values(state.remainingByType).reduce((a,b)=>a+b, 0);
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
  if(!days.length){
    cal.innerHTML = `<div class="p4-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="48" height="48"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9h18M8 3v3M16 3v3"/></svg><p>Choisis une cadence et des dates, puis clique sur <b>Générer</b>.</p></div>`;
    return;
  }

  const workDays  = days.filter(d=>d.work).length;
  const leavesCount = days.filter(d=>state.leaves[d.iso]).length;
  const workMin   = workDays * CONFIG.vacationMinutes;
  const consumed  = days.reduce((a,d)=>{ const lv=state.leaves[d.iso]; if(!lv) return a; const ty=typeByCode(lv.code); return a+((ty&&ty.consommeHeures)?lv.minutes:0); },0);
  const avail     = state.remainingMinutes - consumed;
  const bookable  = avail > 0 ? Math.floor(avail / CONFIG.vacationMinutes) : 0;

  $("#planSummary").innerHTML = `
    <div class="s s-amber"><b>${workDays}</b><span>vacations</span></div>
    <div class="s s-indigo"><b>${fmtMin(workMin)}</b><span>heures trav.</span></div>
    <div class="s s-green"><b>${leavesCount}</b><span>jours posés</span></div>
    <div class="s s-purple"><b>${bookable}</b><span>posables</span></div>`;

  const months = {};
  days.forEach(d=>{
    const k = d.date.getFullYear()+"-"+String(d.date.getMonth()).padStart(2,"0");
    (months[k] = months[k]||[]).push(d);
  });
  const todayISO = isoOf(new Date());

  let html = "";
  for(const k of Object.keys(months).sort()){
    const arr = months[k], first = arr[0].date;
    const title = capit(first.toLocaleDateString("fr-FR",{month:"long",year:"numeric"}));
    const wd = arr.filter(d=>d.work).length;
    const posed = arr.filter(d=>state.leaves[d.iso]).length;
    const offset = (new Date(first.getFullYear(),first.getMonth(),1).getDay()+6)%7;

    html += `<div class="p4-month"><div class="p4-mhd">
      <h3>${title}</h3>
      <div class="p4-chips">
        <span class="p4-chip amber">${wd} vac.</span>
        ${posed?`<span class="p4-chip green">${posed} posé(s)</span>`:""}
      </div></div>
      <div class="p4-whd"><span>Lun</span><span>Mar</span><span>Mer</span><span>Jeu</span><span>Ven</span><span class="we-h">Sam</span><span class="we-h">Dim</span></div>
      <div class="p4-grid">`;

    for(let i=0; i<offset; i++) html += `<div class="p4-cell empty"></div>`;

    arr.forEach(d=>{
      const lv = state.leaves[d.iso], ty = lv ? typeByCode(lv.code) : null;
      const isToday = d.iso === todayISO;
      const isWE = d.date.getDay()===0 || d.date.getDay()===6;
      const cls = (d.work?"work":"rest") + (isWE?" we":"") + (lv?" lv":"") + (isToday?" now":"");
      const bord = lv && ty ? `style="border-left:4px solid ${ty.couleur}"` : "";
      html += `<div class="p4-cell ${cls}" data-iso="${d.iso}" ${bord}>
        <span class="p4-n${isToday?" p4-today":""}">${d.date.getDate()}</span>
        ${lv ? `<span class="p4-lcode" style="background:${ty?ty.couleur:"#888"}">${lv.code}</span>`
             : (d.work ? `<span class="p4-vtag">V</span>` : ``)}
        ${lv && ty && ty.partiel ? `<span class="p4-lmin">${fmtMin(lv.minutes)}</span>` : ""}
      </div>`;
    });
    html += `</div></div>`;
  }
  cal.innerHTML = html;
  $$(".p4-cell[data-iso]").forEach(el => el.addEventListener("click", ()=> openModal(el.dataset.iso)));
}

/* ===================== Modale jour ===================== */
// Team edit context (chef/admin modifying another member's leave)
let teamEditUID = null, teamEditName = null, teamEditMemberSt = null, teamEditCallback = null;

function openTeamLeaveModal(uid, memberName, iso, memberSt, callback){
  teamEditUID = uid; teamEditName = memberName; teamEditMemberSt = memberSt;
  teamEditCallback = callback || null;
  openModal(iso, memberSt);
}

function openModal(iso, memberSt){
  modalDateISO = iso;
  const activeSt = memberSt || state;
  const date = parseISO(iso);

  if(teamEditUID){
    const ds = dayStatus(activeSt, iso);
    $("#modalDate").textContent = `${teamEditName} — ${capit(date.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"}))}`;
    $("#modalState").textContent = !ds.inRange ? "Hors plage de planning" : (ds.work ? `Vacation ${CONFIG.vacationLabel}` : "Jour de repos");
  } else {
    const days = buildDays();
    const dd = days.find(d=>d.iso===iso);
    $("#modalDate").textContent = capit(date.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"}));
    $("#modalState").textContent = dd && dd.work ? `Jour travaillé — vacation ${CONFIG.vacationLabel}` : "Jour de repos";
  }

  const cur = activeSt.leaves ? activeSt.leaves[iso] : null;
  modalSelected = cur ? cur.code : null;
  const types = (activeSt.types && activeSt.types.length) ? activeSt.types : state.types;

  const wrap = $("#modalTypes");
  wrap.innerHTML = "";
  types.forEach(ty=>{
    const b = document.createElement("button");
    b.className = "mt" + (modalSelected===ty.code?" sel":"");
    b.innerHTML = `<span class="dot" style="background:${ty.couleur}"></span><span style="font-weight:800">${ty.code}</span><span class="mt-label">${ty.label}</span>`;
    b.title = ty.label;
    b.addEventListener("click", ()=>{
      modalSelected = (modalSelected===ty.code)? null : ty.code;
      $$("#modalTypes .mt").forEach(x=>x.classList.remove("sel"));
      if(modalSelected===ty.code) b.classList.add("sel");
      togglePartiel(types);
    });
    wrap.appendChild(b);
  });

  const partH = $("#partielH");
  partH.value = (cur && cur.minutes!=null) ? (cur.minutes/60) : "";
  togglePartiel(types);

  const mb = $("#modalBg"); mb.hidden = false; mb.style.display = "grid";
}
function togglePartiel(types){
  const tyList = types || state.types;
  const ty = modalSelected ? tyList.find(t=>t.code===modalSelected) : null;
  const show = !!(ty && ty.partiel);
  const w = $("#partielWrap");
  w.hidden = !show; w.style.display = show ? "flex" : "none";
}
async function saveDay(){
  if(!modalDateISO) return;
  if(teamEditUID){
    const code = modalSelected || "";
    const tyList = (teamEditMemberSt && teamEditMemberSt.types && teamEditMemberSt.types.length) ? teamEditMemberSt.types : state.types;
    const ty = code ? tyList.find(t=>t.code===code) : null;
    let minutes = ty ? ty.minutesParDefaut : 0;
    if(ty && ty.partiel){ const h=parseFloat($("#partielH").value||0); minutes=Math.round(h*60); }
    try{
      const { error } = await supa.rpc("chef_save_leave",{ target_uid:teamEditUID, date_iso:modalDateISO, leave_code:code, leave_minutes:minutes });
      if(error) throw error;
      if(teamEditMemberSt){ if(!teamEditMemberSt.leaves) teamEditMemberSt.leaves={}; if(code) teamEditMemberSt.leaves[modalDateISO]={code,minutes}; else delete teamEditMemberSt.leaves[modalDateISO]; }
      const cb = teamEditCallback; closeModal(); if(cb) cb(); else renderTeam();
    }catch(e){ alert("Erreur : "+e.message); }
    return;
  }
  if(!modalSelected){ delete state.leaves[modalDateISO]; }
  else{
    const ty = typeByCode(modalSelected);
    let minutes = ty.minutesParDefaut;
    if(ty.partiel){ const h=parseFloat($("#partielH").value||0); minutes=Math.round(h*60); }
    state.leaves[modalDateISO] = { code:modalSelected, minutes };
  }
  save(); closeModal(); renderAll();
}
function closeModal(){
  const mb=$("#modalBg"); mb.hidden=true; mb.style.display="none";
  modalDateISO=null; modalSelected=null;
  teamEditUID=null; teamEditName=null; teamEditMemberSt=null; teamEditCallback=null;
}

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
let cycleGroups = [], cycleSelGid = null, cycleStartDate = null, cycleNotes = {};
function displayName(){
  if(cloudProfile && cloudProfile.display_name) return cloudProfile.display_name;
  return cloudUser ? cloudUser.email.split("@")[0] : "Moi";
}
function isAdmin(){ return !!(cloudProfile && (cloudProfile.role === "admin" || cloudProfile.role === "dev")); }
function isChef(){ return !!(cloudProfile && (cloudProfile.role === "admin" || cloudProfile.role === "chef" || cloudProfile.role === "dev")); }
function isDev(){ return !!(cloudProfile && cloudProfile.role === "dev"); }
function roleBadgeHTML(role){
  const cfg = {
    admin: { label:"ADMIN",  cls:"admin",  bg:"#4338ca", color:"#fff" },
    chef:  { label:"CHEF",   cls:"chef",   bg:"#15803d", color:"#fff" },
    dev:   { label:"DEV",    cls:"dev",    bg:"#b45309", color:"#fff" },
    user:  { label:"MEMBRE", cls:"membre", bg:"#5b6478", color:"#fff" },
    membre:{ label:"MEMBRE", cls:"membre", bg:"#5b6478", color:"#fff" }
  };
  const r = cfg[role] || cfg.user;
  return `<span class="role-badge ${r.cls}" style="background:${r.bg};color:${r.color}">${r.label}</span>`;
}
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
        ${isChef()?`<button class="btn small primary" data-manage="${g.id}">⚙ Gérer</button>`:""}
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
  $$("#teamManage [data-manage]").forEach(b=> b.addEventListener("click", ()=> renderManageOverlay(b.dataset.manage)));
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

  const canEdit = isChef();
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
      const editable = canEdit && !isMe && s.inRange;
      const editAttr = editable ? ` data-euid="${mem.user_id}" data-eiso="${iso}"` : "";
      const editStyle = editable ? " editable" : "";
      if(!s.inRange){ cells += `<td class="cell out${today}${editStyle}"${editAttr}></td>`; }
      else if(s.leave){ cells += `<td class="cell lv${today}${editStyle}" style="background:${leaveColor(s.leave.code, st)}"${editAttr} title="${escapeHtml(s.leave.code)}">${escapeHtml(s.leave.code[0])}</td>`; }
      else if(s.work){ cells += `<td class="cell work${today}${editStyle}"${editAttr} title="Vacation"></td>`; }
      else { cells += `<td class="cell rest${today}${editStyle}"${editAttr}></td>`; }
    }
    const dnLabel = escapeHtml(mem.display_name||'?');
    rows += `<tr><td class="mname${isMe?' me':''}">${dnLabel}${isMe?` <em>(moi)</em>`:''}</td>${cells}</tr>`;
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
  if(canEdit){
    $$("#teamView [data-euid]").forEach(td=>{
      td.addEventListener("click", ()=>{
        const uid = td.dataset.euid, iso = td.dataset.eiso;
        const mem = teamMembers.find(m=>m.user_id===uid);
        const memberSt = teamPlannings[uid] || {};
        openTeamLeaveModal(uid, mem ? (mem.display_name||mem.user_id) : "?", iso, memberSt);
      });
    });
  }
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

/* ===================== Thème clair / sombre ===================== */
function initTheme(){
  const saved = localStorage.getItem("planning_theme") || "light";
  applyTheme(saved, false);
}
function applyTheme(theme, save=true){
  document.documentElement.setAttribute("data-theme", theme);
  if(save) localStorage.setItem("planning_theme", theme);
  const btn = $("#themeBtn");
  if(!btn) return;
  if(theme === "dark"){
    btn.title = "Passer en mode clair";
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;
  } else {
    btn.title = "Passer en mode sombre";
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/></svg>`;
  }
}
function toggleTheme(){
  const cur = document.documentElement.getAttribute("data-theme") || "light";
  applyTheme(cur === "dark" ? "light" : "dark");
}

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
    <div class="card"><div class="mem-head"><h2>Liste des inscrits</h2>
    <button class="btn small" id="memRefresh">
      <svg class="mem-refresh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/></svg>Rafraîchir
    </button></div>
    <div id="memList" class="posed-list"><p class="empty">Chargement…</p></div></div>`;
  $("#memRefresh").addEventListener("click", loadMembers);
  await pingPresence();
  await loadMembers();
}

async function loadMembers(){
  const btn = $("#memRefresh");
  if(btn){ btn.disabled = true; btn.classList.add("mem-refresh-loading"); }
  let rows = [];
  try{
    const { data, error } = await supa.from("profiles").select("id,email,display_name,role,created_at,last_seen").order("last_seen",{ascending:false});
    if(error) throw error;
    rows = data || [];
  }catch(e){
    $("#memList").innerHTML = `<p class="empty">Impossible de lire la liste (as-tu exécuté <b>database.sql</b> ?). ${escapeHtml(e.message)}</p>`;
    if(btn){ btn.disabled = false; btn.classList.remove("mem-refresh-loading"); }
    return;
  }
  const online = rows.filter(r=>onlineState(r.last_seen)==="on").length;
  const admins = rows.filter(r=>r.role==="admin").length;
  const chefs = rows.filter(r=>r.role==="chef").length;
  $("#memStats").innerHTML = `
    <div class="stat"><b>${rows.length}</b><span>inscrits</span></div>
    <div class="stat good"><b>${online}</b><span>en ligne</span></div>
    <div class="stat"><b>${admins}</b><span>admin(s)</span></div>
    <div class="stat"><b>${chefs}</b><span>chef(s) d'équipe</span></div>`;
  if(!rows.length){ $("#memList").innerHTML = `<p class="empty">Aucun inscrit pour le moment.</p>`; if(btn){ btn.disabled=false; btn.classList.remove("mem-refresh-loading"); } return; }

  const admin = isAdmin();
  $("#memList").innerHTML = rows.map(r=>{
    const st = onlineState(r.last_seen);
    const isMe = r.id===cloudUser.id;
    const dn = r.display_name || (r.email||"—").split("@")[0];
    const label = st==="on" ? "en ligne" : timeAgo(r.last_seen);
    const badge = roleBadgeHTML(r.role);
    const canRename = isAdmin() && !isMe;
    let actions = "";
    if(admin && !isMe){
      const toggle = r.role==="admin"
        ? `<button class="mini" data-role="user" data-id="${r.id}">retirer admin</button>`
        : `<button class="mini" data-role="admin" data-id="${r.id}">→ admin</button>`;
      actions = `<span class="mem-actions">${toggle}<button class="mini danger" data-reset="${r.id}">réinit.</button></span>`;
    }
    return `<div class="posed-row mem-row" data-mid="${r.id}">
      <span class="mem-id">
        <span class="online ${st}"></span>
        <span class="mem-name-wrap">
          <b class="mem-dname">${escapeHtml(dn)}</b>${badge}${isMe?' <em>(moi)</em>':''}
          ${canRename?`<button class="mini mem-rename-btn" data-uid="${r.id}" data-cur="${escapeHtml(dn)}" title="Renommer">✎</button>`:''}
        </span>
        <small class="mem-email">${escapeHtml(r.email||"")}</small>
      </span>
      <span class="mem-right"><span class="mem-meta">${label}</span>${actions}</span>
    </div>`;
  }).join("");

  if(admin){
    $$("#memList [data-role]").forEach(b=> b.addEventListener("click", async ()=>{
      try{ await supa.rpc("admin_set_role",{ target:b.dataset.id, new_role:b.dataset.role }); await loadMembers(); }
      catch(e){ alert("Erreur : "+e.message); }
    }));
    $$("#memList [data-reset]").forEach(b=> b.addEventListener("click", async ()=>{
      if(!confirm("Réinitialiser (vider) le planning de ce membre ?")) return;
      try{ await supa.rpc("admin_reset_planning",{ target:b.dataset.reset }); alert("Planning réinitialisé."); }
      catch(e){ alert("Erreur : "+e.message); }
    }));
  }
  // Renommage inline (admin/dev uniquement)
  if(isAdmin()){
    $$("#memList .mem-rename-btn").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const uid = btn.dataset.uid;
        const cur = btn.dataset.cur;
        const row = btn.closest(".mem-row");
        const nameEl = row ? row.querySelector(".mem-dname") : null;
        if(!nameEl) return;
        const inp = document.createElement("input");
        inp.value = cur; inp.className = "mgr-rename-inp"; inp.maxLength = 30;
        inp.style.cssText = "width:130px;font-size:.88rem";
        const doSave = async ()=>{
          const newName = inp.value.trim();
          if(!newName || newName === cur){ await loadMembers(); return; }
          try{
            await supa.rpc("chef_rename_member", { target_uid:uid, new_name:newName });
            await loadMembers();
          }catch(e){ alert("Erreur : "+e.message); await loadMembers(); }
        };
        inp.addEventListener("blur", doSave);
        inp.addEventListener("keydown", e=>{ if(e.key==="Enter") inp.blur(); if(e.key==="Escape"){ inp.removeEventListener("blur",doSave); loadMembers(); } });
        nameEl.replaceWith(inp);
        inp.focus(); inp.select();
      });
    });
  }
  if(btn){ btn.disabled = false; btn.classList.remove("mem-refresh-loading"); }
}

function renderHours(){
  if(!state.remainingByType) state.remainingByType = {};
  const days = buildDays();
  const consumedByType = {}, posedByType = {}, posedItems = [];

  days.forEach(d=>{
    const lv = state.leaves[d.iso]; if(!lv) return;
    const ty = typeByCode(lv.code); if(!ty) return;
    posedItems.push({ iso:d.iso, date:d.date, lv, ty });
    if(ty.consommeHeures){
      consumedByType[lv.code] = (consumedByType[lv.code]||0) + lv.minutes;
      posedByType[lv.code]    = (posedByType[lv.code]||0) + 1;
    }
  });

  // Inputs par type
  const congeTypes = state.types.filter(t=>t.consommeHeures);
  const inpContainer = $("#hoursTypeInputs");
  if(inpContainer){
    inpContainer.innerHTML = congeTypes.map(ty=>{
      const rem      = state.remainingByType[ty.code] || 0;
      const consumed = consumedByType[ty.code] || 0;
      const avail    = rem - consumed;
      const bookable = avail > 0 ? Math.floor(avail / CONFIG.vacationMinutes) : 0;
      const h = Math.floor(rem/60), m = rem%60;
      const aClass = avail < 0 ? "color:var(--danger)" : avail < CONFIG.vacationMinutes ? "color:var(--work)" : "color:var(--ok)";
      return `<div class="hours-type-block">
        <div class="hours-type-hd">
          <span class="tag" style="background:${ty.couleur}">${ty.code}</span>
          <span class="hours-type-lbl">${ty.label}</span>
          ${posedByType[ty.code]?`<span class="hours-type-posed">${posedByType[ty.code]} posé(s) · −${fmtMin(consumed)}</span>`:""}
        </div>
        <div class="hours-type-row">
          <input type="number" class="rem-h-inp" data-code="${ty.code}" min="0" step="1" placeholder="0" value="${h||""}" />
          <span class="hsep">h</span>
          <input type="number" class="rem-m-inp" data-code="${ty.code}" min="0" max="59" step="1" placeholder="0" value="${m||""}" />
          <span class="hours-dispo" style="${aClass}">${fmtMin(avail)} dispo — ${bookable} vac.</span>
        </div>
      </div>`;
    }).join("") || `<p class="muted">Aucun type de congé configuré. Ajoute-en dans Réglages.</p>`;
  }

  // Stats totales
  const totalRem      = congeTypes.reduce((a,ty)=>a+(state.remainingByType[ty.code]||0), 0);
  const totalConsumed = Object.values(consumedByType).reduce((a,b)=>a+b, 0);
  const totalAvail    = totalRem - totalConsumed;
  const totalBookable = totalAvail > 0 ? Math.floor(totalAvail / CONFIG.vacationMinutes) : 0;
  const availClass    = totalAvail < 0 ? "bad" : totalAvail < CONFIG.vacationMinutes ? "warn" : "good";

  $("#hourStats").innerHTML = `
    <div class="stat"><b>${fmtMin(totalRem)}</b><span>total restant</span></div>
    <div class="stat warn"><b>${fmtMin(totalConsumed)}</b><span>déjà posé</span></div>
    <div class="stat ${availClass}"><b>${fmtMin(totalAvail)}</b><span>disponible</span></div>
    <div class="stat good"><b>${totalBookable}</b><span>vacations posables</span></div>`;

  // Liste détaillée
  const list = $("#posedList");
  if(!posedItems.length){ list.innerHTML=`<p class="empty">Aucun congé posé. Clique sur un jour du planning pour en ajouter.</p>`; return; }
  posedItems.sort((a,b)=>a.iso.localeCompare(b.iso));
  list.innerHTML = posedItems.map(p=>{
    const dstr = capit(p.date.toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short"}));
    const cost = p.ty.consommeHeures ? `−${fmtMin(p.lv.minutes)}` : "hors compteur";
    return `<div class="posed-row">
      <span><span class="tag" style="background:${p.ty.couleur}">${p.lv.code}</span> ${dstr} — ${p.ty.label}</span>
      <span>${cost} <button class="rm" data-iso="${p.iso}">✕</button></span>
    </div>`;
  }).join("");
  $$("#posedList .rm").forEach(b=>b.addEventListener("click",()=>{ delete state.leaves[b.dataset.iso]; save(); renderAll(); }));
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

/* ===================== PANNEAU ADMIN ===================== */
let adminAllMembers = [], adminAllBrigades = [], adminBrigadeMembers = [];
let adminSearchQuery = "", adminSelBrigade = null, adminPlanMonth = new Date();

async function renderAdminTab(){
  const root = $("#adminRoot");
  if(!CLOUD){ root.innerHTML = `<div class="card"><h2>Administration</h2><p class="muted">Mode comptes (Supabase) requis.</p></div>`; return; }
  if(!cloudUser || !isAdmin()){ root.innerHTML = `<div class="card"><h2>Accès refusé</h2><p class="muted">Réservé aux administrateurs.</p></div>`; return; }
  root.innerHTML = `<p class="empty" style="padding:24px;text-align:center">Chargement du panneau admin…</p>`;
  await adminLoadAll();
}

async function adminLoadAll(){
  try{
    const [r1,r2,r3] = await Promise.all([
      supa.from("profiles").select("id,email,display_name,role,created_at,last_seen").order("display_name",{ascending:true}),
      supa.from("groups").select("id,name,code"),
      supa.from("group_members").select("user_id,display_name,crew,group_id")
    ]);
    adminAllMembers = r1.data||[];
    adminAllBrigades = r2.data||[];
    adminBrigadeMembers = r3.data||[];
  }catch(e){ console.warn("Admin load:",e.message); adminAllMembers=[]; adminAllBrigades=[]; adminBrigadeMembers=[]; }
  adminRenderFull();
}

function adminRenderFull(){
  const root = $("#adminRoot");
  if(!root) return;
  const online = adminAllMembers.filter(r=>onlineState(r.last_seen)==="on").length;
  const admins = adminAllMembers.filter(r=>r.role==="admin").length;
  const chefs  = adminAllMembers.filter(r=>r.role==="chef").length;

  root.innerHTML = `
    <!-- Dashboard -->
    <div class="stats">
      <div class="stat"><b>${adminAllMembers.length}</b><span>inscrits</span></div>
      <div class="stat good"><b>${online}</b><span>en ligne</span></div>
      <div class="stat"><b>${adminAllBrigades.length}</b><span>brigades</span></div>
      <div class="stat"><b>${admins}A · ${chefs}C</b><span>admins · chefs</span></div>
    </div>

    <!-- Gestion des membres -->
    <div class="card">
      <div class="card-head" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <h2>👥 Gestion des membres</h2>
        <button class="btn small" id="adminRefreshBtn">
          <svg id="adminRefreshIcon" class="mem-refresh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/></svg>Rafraîchir
        </button>
      </div>
      <div class="admin-search-wrap">
        <input type="text" id="adminSearch" placeholder="Rechercher par nom ou email…" value="${escapeHtml(adminSearchQuery)}" />
      </div>
      <div id="adminMemberList"></div>
    </div>

    <!-- Gestion des brigades -->
    <div class="card">
      <div class="card-head"><h2>🚔 Gestion des brigades</h2></div>
      <div id="adminBrigadeList"></div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <input id="adminNewBrig" placeholder="Nom de la brigade à créer…" maxlength="30" style="flex:1;min-width:180px" />
        <button class="btn primary" id="adminCreateBrig">Créer</button>
      </div>
    </div>

    <!-- Vue planning par brigade -->
    <div class="card" id="adminPlanCard" ${adminSelBrigade?"":"style=\"display:none\""}>
      <div class="admin-plan-header card-head">
        <h2>📅 Planning — <span id="adminPlanName">${adminSelBrigade?escapeHtml(adminSelBrigade.name):""}</span></h2>
        <div class="month-nav">
          <button class="btn small" id="adminPlanPrev">‹</button>
          <span id="adminPlanMonthLbl"></span>
          <button class="btn small" id="adminPlanNext">›</button>
        </div>
      </div>
      <div id="adminPlanContent"></div>
    </div>`;

  adminRenderMemberList();
  adminRenderBrigadeList();
  if(adminSelBrigade) adminRenderPlanning();
  adminBindEvents();
}

function adminGetFilteredMembers(){
  const q = adminSearchQuery.toLowerCase();
  return q ? adminAllMembers.filter(r=>(r.display_name||"").toLowerCase().includes(q)||(r.email||"").toLowerCase().includes(q)) : adminAllMembers;
}

function adminRenderMemberList(){
  const c = $("#adminMemberList"); if(!c) return;
  const list = adminGetFilteredMembers();
  if(!list.length){ c.innerHTML=`<p class="empty">Aucun membre trouvé.</p>`; return; }
  const roles = ["membre","chef","admin","dev"];
  c.innerHTML = `<div class="admin-mem-table">` + list.map(r=>{
    const st = onlineState(r.last_seen);
    const isMe = r.id===cloudUser.id;
    const dn = r.display_name||(r.email||"—").split("@")[0];
    const brigs = adminBrigadeMembers.filter(bm=>bm.user_id===r.id).map(bm=>{
      const g=adminAllBrigades.find(x=>x.id===bm.group_id);
      return g ? escapeHtml(g.name)+(bm.crew?` (${bm.crew})`:"") : null;
    }).filter(Boolean).join(", ")||"—";
    const curRole = r.role==="user"||!r.role ? "membre" : r.role;
    const opts = roles.map(rl=>`<option value="${rl}"${curRole===rl?" selected":""}>${rl==="chef"?"chef d'équipe":rl}</option>`).join("");
    return `<div class="admin-mem-row${isMe?" me":""}">
      <span class="admin-mem-id">
        <span class="online ${st}" title="${st==="on"?"en ligne":timeAgo(r.last_seen)}"></span>
        <span><b>${escapeHtml(dn)}</b>${isMe?` <em>(moi)</em>`:""}${roleBadgeHTML(r.role)}<small class="mem-email">${escapeHtml(r.email||"")}</small></span>
      </span>
      <span class="admin-mem-brigade" title="${escapeHtml(brigs)}">${brigs}</span>
      <span class="admin-mem-activity">${st==="on"?"en ligne":timeAgo(r.last_seen)}</span>
      <span class="admin-mem-actions">
        <select class="admin-role-sel" data-uid="${r.id}" data-cur="${r.role||"user"}" data-isme="${isMe}" title="Changer le rôle">${opts}</select>
        ${isMe?"" : `<button class="mini danger" data-reset-plan="${r.id}" title="Réinitialiser le planning">Réinit.</button>`}
      </span>
    </div>`;
  }).join("") + `</div>`;
}

function adminRenderBrigadeList(){
  const c = $("#adminBrigadeList"); if(!c) return;
  if(!adminAllBrigades.length){ c.innerHTML=`<p class="empty">Aucune brigade créée pour le moment.</p>`; return; }
  c.innerHTML = adminAllBrigades.map(g=>{
    const mems = adminBrigadeMembers.filter(bm=>bm.group_id===g.id);
    const crews = {Alpha:0,Bravo:0,Charlie:0};
    mems.forEach(m=>{ if(m.crew&&crews[m.crew]!==undefined) crews[m.crew]++; });
    const crewStr = Object.entries(crews).filter(([,n])=>n>0).map(([c,n])=>`${c[0]}:${n}`).join(" ") || "—";
    const memInBrigIds = new Set(mems.map(m=>m.user_id));
    const notIn = adminAllMembers.filter(m=>!memInBrigIds.has(m.id));
    const addOpts = notIn.length
      ? `<option value="">+ Ajouter un membre…</option>`+notIn.map(m=>`<option value="${m.id}">${escapeHtml(m.display_name||(m.email||"?").split("@")[0])}</option>`).join("")
      : `<option value="">— Tous déjà dans la brigade —</option>`;
    const memList = mems.length ? mems.map(m=>`<span class="brig-mem-chip">${escapeHtml(m.display_name||"?")}
      <button class="brig-kick" data-uid="${m.user_id}" data-gid="${g.id}" title="Retirer">×</button></span>`).join("") : `<span class="empty">Aucun membre</span>`;
    return `<div class="admin-brigade-row">
      <div class="brig-row-top">
        <span class="grp-name">${escapeHtml(g.name)}</span>
        <span class="grp-code">code <b>${g.code}</b></span>
        <span class="admin-brigade-crew">${crewStr}</span>
        <span class="admin-brigade-count">${mems.length} membre(s)</span>
        <span class="grp-act">
          <button class="btn small" data-admin-plan="${g.id}">📅 Planning</button>
          <button class="mini danger" data-admin-del-brig="${g.id}">Supprimer</button>
        </span>
      </div>
      <div class="brig-mems">${memList}</div>
      <div class="brig-assign">
        <select class="admin-assign-sel" data-brig="${g.id}">${addOpts}</select>
        <button class="mini" data-admin-assign="${g.id}">Ajouter</button>
      </div>
    </div>`;
  }).join("");
}

async function adminRenderPlanning(){
  const card=$("#adminPlanCard"), content=$("#adminPlanContent");
  if(!card||!content||!adminSelBrigade) return;
  card.style.display="";
  if($("#adminPlanName")) $("#adminPlanName").textContent = adminSelBrigade.name;
  const y=adminPlanMonth.getFullYear(), m=adminPlanMonth.getMonth();
  const lbl = capit(adminPlanMonth.toLocaleDateString("fr-FR",{month:"long",year:"numeric"}));
  if($("#adminPlanMonthLbl")) $("#adminPlanMonthLbl").textContent = lbl;
  content.innerHTML=`<p class="empty">Chargement…</p>`;
  const brigMems = adminBrigadeMembers.filter(bm=>bm.group_id===adminSelBrigade.id);
  let plannings={};
  if(brigMems.length){
    try{
      const {data}=await supa.from("plannings").select("user_id,data").in("user_id",brigMems.map(m=>m.user_id));
      (data||[]).forEach(p=>plannings[p.user_id]=p.data||{});
    }catch(e){ console.warn(e.message); }
  }
  const nDays=new Date(y,m+1,0).getDate();
  const todayISO=isoOf(new Date());
  let head=`<th class="mname">Membre</th>`;
  for(let d=1;d<=nDays;d++){
    const dt=new Date(y,m,d);
    const we=(dt.getDay()===0||dt.getDay()===6)?" we":"";
    head+=`<th class="dcol${we}"><span>${d}</span><small>${dt.toLocaleDateString("fr-FR",{weekday:"narrow"})}</small></th>`;
  }
  brigMems.sort((a,b)=>(a.display_name||"").localeCompare(b.display_name||""));
  const rows = brigMems.map(mem=>{
    const st=plannings[mem.user_id]||{};
    const isMe=mem.user_id===cloudUser.id;
    const crewCls=mem.crew?`crew-${mem.crew.toLowerCase()}`:"";
    const crewBadge=mem.crew?`<span class="crew-badge-sm ${crewCls}">${mem.crew[0]}</span>`:"";
    let cells="";
    for(let d=1;d<=nDays;d++){
      const iso=isoOf(new Date(y,m,d));
      const s=dayStatus(st,iso);
      const today=iso===todayISO?" today":"";
      if(!s.inRange) cells+=`<td class="cell out${today}"></td>`;
      else if(s.leave) cells+=`<td class="cell lv${today}" style="background:${leaveColor(s.leave.code,st)}" title="${escapeHtml(s.leave.code)}">${escapeHtml(s.leave.code[0])}</td>`;
      else if(s.work) cells+=`<td class="cell work${today}" title="Vacation"></td>`;
      else cells+=`<td class="cell rest${today}"></td>`;
    }
    return `<tr><td class="mname${isMe?" me":""}">${escapeHtml(mem.display_name||"?")}${crewBadge}</td>${cells}</tr>`;
  }).join("");
  if(!brigMems.length){ content.innerHTML=`<p class="empty">Cette brigade n'a pas de membres.</p>`; return; }
  content.innerHTML=`
    <div class="team-scroll"><table class="team-grid"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    <div class="legend" style="margin-top:12px">
      <span class="lg"><span class="dot" style="background:#f0a23c"></span>Vacation</span>
      <span class="lg"><span class="dot" style="background:var(--surface2)"></span>Repos</span>
      <span class="lg"><span class="dot" style="background:var(--accent)"></span>Congé</span>
    </div>`;
}

function adminBindEvents(){
  const search=$("#adminSearch");
  if(search) search.addEventListener("input",e=>{ adminSearchQuery=e.target.value; adminRenderMemberList(); });

  const rfBtn=$("#adminRefreshBtn");
  if(rfBtn) rfBtn.addEventListener("click",async()=>{
    rfBtn.disabled=true; rfBtn.classList.add("mem-refresh-loading");
    await adminLoadAll();
    rfBtn.disabled=false; rfBtn.classList.remove("mem-refresh-loading");
  });

  // Changement de rôle
  $$(".admin-role-sel").forEach(sel=>sel.addEventListener("change",async()=>{
    let newRole=sel.value;
    if(newRole==="membre") newRole="user";
    const isMe = sel.dataset.isme==="true";
    if(isMe && (newRole==="user")){
      if(!confirm("Tu vas retirer ton propre rôle admin. Tu perdras l'accès à ce panneau. Continuer ?")){ sel.value=sel.dataset.cur; return; }
    }
    sel.disabled = true;
    try{
      const { error } = await supa.rpc("admin_set_role",{ target:sel.dataset.uid, new_role:newRole });
      if(error) throw error;
      if(isMe){ cloudProfile = cloudProfile||{}; cloudProfile.role=newRole; refreshChipCloud(); const at=$("#adminTab"); if(at) at.hidden=!isAdmin(); }
      await adminLoadAll();
    }catch(e){
      alert("Erreur : "+e.message+"\n\nExecute ce SQL dans Supabase > SQL Editor :\n\nCREATE OR REPLACE FUNCTION admin_set_role(target uuid, new_role text)\nRETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$\nBEGIN\n  IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND role='admin') THEN\n    RAISE EXCEPTION 'Permission refusee';\n  END IF;\n  UPDATE profiles SET role = CASE WHEN new_role='membre' THEN 'user' ELSE new_role END WHERE id=target;\nEND; $$;\nGRANT EXECUTE ON FUNCTION admin_set_role(uuid,text) TO authenticated;");
      sel.value=sel.dataset.cur; sel.disabled=false;
    }
  }));

  // Réinit planning
  $$("[data-reset-plan]").forEach(b=>b.addEventListener("click",async()=>{
    if(!confirm("Réinitialiser le planning de ce membre ?")) return;
    try{ await supa.rpc("admin_reset_planning",{target:b.dataset.resetPlan}); alert("Planning réinitialisé."); }
    catch(e){ alert("Erreur : "+e.message); }
  }));

  // Ouvrir planning brigade
  $$("[data-admin-plan]").forEach(b=>b.addEventListener("click",async()=>{
    adminSelBrigade=adminAllBrigades.find(g=>g.id===b.dataset.adminPlan);
    adminPlanMonth=new Date();
    const card=$("#adminPlanCard"); if(card) card.style.display="";
    await adminRenderPlanning();
    adminBindPlanNav();
  }));

  // Supprimer brigade
  $$("[data-admin-del-brig]").forEach(b=>b.addEventListener("click",async()=>{
    const gid=b.dataset.adminDelBrig;
    const g=adminAllBrigades.find(x=>x.id===gid);
    if(!confirm(`Supprimer la brigade « ${g?g.name:gid} » et retirer tous ses membres ?`)) return;
    try{
      await supa.from("group_members").delete().eq("group_id",gid);
      await supa.from("groups").delete().eq("id",gid);
      if(adminSelBrigade&&adminSelBrigade.id===gid){ adminSelBrigade=null; const card=$("#adminPlanCard"); if(card) card.style.display="none"; }
      await adminLoadAll();
    }catch(e){ alert("Erreur suppression : "+e.message); }
  }));

  // Assigner un membre à une brigade
  $$("[data-admin-assign]").forEach(btn=>{
    btn.addEventListener("click",async()=>{
      const gid=btn.dataset.adminAssign;
      const sel=document.querySelector(`.admin-assign-sel[data-brig="${gid}"]`);
      const uid=sel?sel.value:"";
      if(!uid) return;
      try{
        await supa.rpc("admin_add_to_brigade",{target_uid:uid, p_group_id:gid});
        await adminLoadAll();
      }catch(e){ alert("Erreur : "+e.message); }
    });
  });

  // Retirer un membre d'une brigade
  $$(".brig-kick").forEach(btn=>{
    btn.addEventListener("click",async()=>{
      if(!confirm("Retirer ce membre de la brigade ?")) return;
      try{
        await supa.rpc("admin_remove_from_brigade",{target_uid:btn.dataset.uid, p_group_id:btn.dataset.gid});
        await adminLoadAll();
      }catch(e){ alert("Erreur : "+e.message); }
    });
  });

  // Créer une brigade (admin)
  const createBrig=async()=>{
    const name=($("#adminNewBrig")||{}).value&&$("#adminNewBrig").value.trim();
    if(!name) return alert("Donne un nom.");
    try{
      await supa.rpc("create_group",{group_name:name, display:displayName()});
      if($("#adminNewBrig")) $("#adminNewBrig").value="";
      await adminLoadAll();
    }catch(e){ alert("Erreur création : "+e.message); }
  };
  const cBtn=$("#adminCreateBrig");
  if(cBtn) cBtn.addEventListener("click",createBrig);

  adminBindPlanNav();
}

function adminBindPlanNav(){
  const prev=$("#adminPlanPrev"), next=$("#adminPlanNext");
  if(prev) prev.onclick=async()=>{ adminPlanMonth=new Date(adminPlanMonth.getFullYear(),adminPlanMonth.getMonth()-1,1); await adminRenderPlanning(); adminBindPlanNav(); };
  if(next) next.onclick=async()=>{ adminPlanMonth=new Date(adminPlanMonth.getFullYear(),adminPlanMonth.getMonth()+1,1); await adminRenderPlanning(); adminBindPlanNav(); };
}

/* ===================== Panneau GÉRER (chef/admin/dev) ===================== */
async function renderManageOverlay(gid){
  if(!CLOUD || !cloudUser) return;
  const g = teamGroups.find(x=>x.id===gid) || { id:gid, name:"Brigade", code:"" };

  let overlay = $("#manageOverlay");
  if(!overlay){
    overlay = document.createElement("div");
    overlay.id = "manageOverlay";
    overlay.className = "manage-overlay";
    overlay.setAttribute("hidden","");
    document.body.appendChild(overlay);
  }
  overlay.removeAttribute("hidden");
  overlay.innerHTML = `<div class="manage-inner">
    <div class="manage-topbar">
      <div class="manage-topbar-row">
        <button class="btn small" id="manageClose">← Retour</button>
        <div class="manage-title">
          <h2>${escapeHtml(g.name)}</h2>
          <small>code <b>${g.code}</b></small>
        </div>
      </div>
      <div class="manage-topbar-row" style="justify-content:center">
        <div class="month-nav">
          <button class="btn small" id="managePrev">‹</button>
          <span id="manageMonthLbl"></span>
          <button class="btn small" id="manageNext">›</button>
        </div>
      </div>
    </div>
    <div class="manage-body" id="manageBody"><p class="empty" style="padding:48px;text-align:center">Chargement…</p></div>
  </div>`;

  let manageMonth = new Date();
  let brigMems = [], brigPlannings = {};

  const fetchData = async ()=>{
    try{
      const {data} = await supa.from("group_members").select("user_id,display_name,crew").eq("group_id",gid);
      brigMems = (data||[]).sort((a,b)=>(a.display_name||"").localeCompare(b.display_name||""));
    }catch(e){ brigMems=[]; }
    if(brigMems.length){
      try{
        const {data} = await supa.from("plannings").select("user_id,data").in("user_id",brigMems.map(m=>m.user_id));
        brigPlannings={};
        (data||[]).forEach(p=>brigPlannings[p.user_id]=p.data||{});
      }catch(e){ brigPlannings={}; }
    }
  };

  const WEEK_LBL = ["L","M","M","J","V","S","D"];

  const renderManage = async ()=>{
    const body=$("#manageBody");
    if(!body) return;
    body.innerHTML=`<p class="empty" style="padding:48px;text-align:center">Chargement…</p>`;
    await fetchData();
    const y=manageMonth.getFullYear(), mo=manageMonth.getMonth();
    const nDays=new Date(y,mo+1,0).getDate();
    const todayISO=isoOf(new Date());
    const monthName=capit(manageMonth.toLocaleDateString("fr-FR",{month:"long",year:"numeric"}));
    if($("#manageMonthLbl")) $("#manageMonthLbl").textContent=monthName;
    if(!brigMems.length){
      body.innerHTML=`<p class="empty" style="padding:48px;text-align:center">Aucun membre dans cette brigade.</p>`;
      return;
    }
    // First day of month → Monday-based offset (0=Mon … 6=Sun)
    const firstDOW=(new Date(y,mo,1).getDay()+6)%7;
    // Week header HTML (shared)
    const whdHtml=WEEK_LBL.map((l,i)=>`<span class="${i>=5?"we-h":""}">${l}</span>`).join("");

    let cardsHtml="";
    brigMems.forEach(mem=>{
      const st=brigPlannings[mem.user_id]||{};
      const isMe=mem.user_id===cloudUser.id;
      const dn=escapeHtml(mem.display_name||"?");
      const initials=(mem.display_name||"?").split(" ").filter(Boolean).map(w=>w[0]).join("").toUpperCase().substring(0,2)||"?";
      const crewOpts=["","Alpha","Bravo","Charlie"].map(c=>`<option value="${c}"${mem.crew===c?" selected":""}>${c||"— équipage"}</option>`).join("");
      const canRen=isAdmin()&&!isMe;

      // Cells : padding + days
      let cellsHtml="";
      for(let p=0;p<firstDOW;p++) cellsHtml+=`<div class="p4-cell empty"></div>`;
      for(let d=1;d<=nDays;d++){
        const dt=new Date(y,mo,d), iso=isoOf(dt);
        const s=dayStatus(st,iso);
        const isToday=iso===todayISO, isWE=dt.getDay()===0||dt.getDay()===6;
        const editable=!isMe&&s.inRange;
        let cls="p4-cell"+(isToday?" now":"");
        let style="", inner="";
        if(!s.inRange){
          cls+=" empty";
          inner=`<span class="p4-n" style="opacity:.25">${d}</span>`;
        } else if(s.leave){
          const col=leaveColor(s.leave.code,st);
          style=`background:${col}`;
          cls+=" lv";
          inner=`<span class="p4-n" style="color:#fff">${d}</span><span class="p4-lcode" style="background:rgba(0,0,0,.22)">${escapeHtml(s.leave.code.substring(0,4))}</span>`;
        } else if(s.work){
          cls+=isWE?" work we":" work";
          inner=`<span class="p4-n">${d}</span><span class="p4-vtag">V</span>`;
        } else {
          cls+=isWE?" we":" rest";
          inner=`<span class="p4-n">${d}</span>`;
        }
        const ea=editable?` data-meuid="${mem.user_id}" data-meiso="${iso}"`:"";
        cellsHtml+=`<div class="${cls}" style="${style}"${ea}>${inner}</div>`;
      }

      cardsHtml+=`<div class="mgr-card" data-uid="${mem.user_id}">
        <div class="mgr-card-hd">
          <div class="mgr-avatar">${escapeHtml(initials)}</div>
          <div class="mgr-card-info">
            <span class="mgr-card-dn">${dn}${isMe?` <em>(moi)</em>`:""}</span>
          </div>
          <div class="mgr-crew-wrap"><select class="mgr-crew-sel" data-muid="${mem.user_id}">${crewOpts}</select></div>
          ${canRen?`<button class="mgr-card-rename" data-ruid="${mem.user_id}" title="Renommer">✎</button>`:""}
        </div>
        <div class="p4-whd">${whdHtml}</div>
        <div class="p4-grid mgr-p4-grid">${cellsHtml}</div>
      </div>`;
    });

    body.innerHTML=`<div class="manage-cards">${cardsHtml}
      <div class="legend" style="padding-bottom:4px">
        <span class="lg"><span class="dot" style="background:#fff7ed;border:1px solid #f59e0b"></span>Vacation</span>
        <span class="lg"><span class="dot" style="background:var(--surface2)"></span>Repos</span>
        <span class="lg"><span class="dot" style="background:#4f46e5"></span>Congé</span>
        ${isChef()?`<span class="lg" style="color:var(--accent)">Toucher une case pour modifier</span>`:""}
      </div>
    </div>`;

    // Events : cells
    $$(".mgr-p4-grid .p4-cell[data-meuid]").forEach(cell=>{
      cell.addEventListener("click",()=>{
        const uid=cell.dataset.meuid, iso=cell.dataset.meiso;
        const mem=brigMems.find(m=>m.user_id===uid);
        openTeamLeaveModal(uid, mem?(mem.display_name||"?"):"?", iso, brigPlannings[uid]||{}, renderManage);
      });
    });

    // Events : crew
    $$(".mgr-crew-sel").forEach(sel=>{
      sel.addEventListener("change",async()=>{
        try{
          await supa.rpc("set_member_crew",{gid, target:sel.dataset.muid, crew_name:sel.value});
          const mem=brigMems.find(m=>m.user_id===sel.dataset.muid);
          if(mem) mem.crew=sel.value;
        }catch(e){ alert("Erreur équipage : "+e.message); }
      });
    });

    // Events : renommer (admin/dev)
    $$(".mgr-card-rename").forEach(btn=>{
      btn.addEventListener("click",()=>{
        const uid=btn.dataset.ruid;
        const mem=brigMems.find(m=>m.user_id===uid);
        const card=btn.closest(".mgr-card");
        const dnEl=card?card.querySelector(".mgr-card-dn"):null;
        if(!dnEl) return;
        const cur=(mem&&mem.display_name)||"";
        const inp=document.createElement("input");
        inp.value=cur; inp.className="mgr-card-rename-inp"; inp.maxLength=30;
        const doSave=async()=>{
          const newName=inp.value.trim();
          if(!newName||newName===cur){ await renderManage(); return; }
          try{
            await supa.rpc("chef_rename_member",{target_uid:uid,new_name:newName});
            if(mem) mem.display_name=newName;
            await renderManage();
          }catch(e){ alert("Erreur renommage : "+e.message); await renderManage(); }
        };
        inp.addEventListener("blur",doSave);
        inp.addEventListener("keydown",e=>{
          if(e.key==="Enter") inp.blur();
          if(e.key==="Escape"){ inp.removeEventListener("blur",doSave); renderManage(); }
        });
        dnEl.replaceWith(inp); inp.focus(); inp.select();
      });
    });
  };

  await renderManage();
  $("#manageClose").addEventListener("click",()=>{ overlay.setAttribute("hidden",""); });
  $("#managePrev").addEventListener("click",async()=>{ manageMonth=new Date(manageMonth.getFullYear(),manageMonth.getMonth()-1,1); await renderManage(); });
  $("#manageNext").addEventListener("click",async()=>{ manageMonth=new Date(manageMonth.getFullYear(),manageMonth.getMonth()+1,1); await renderManage(); });
}

/* ===================== Feuille de cycle ===================== */
async function renderCycleTab(){
  const root=$("#cycleRoot"); if(!root) return;
  if(!CLOUD||!cloudUser){
    root.innerHTML=`<div class="card"><p class="muted">Connexion requise pour accéder à la feuille de cycle.</p></div>`;
    return;
  }
  root.innerHTML=`<p class="empty" style="padding:48px;text-align:center">Chargement…</p>`;
  try{
    const {data}=await supa.from("group_members").select("group_id,groups(id,name,code)").eq("user_id",cloudUser.id);
    cycleGroups=(data||[]).map(d=>d.groups).filter(Boolean);
  }catch(e){ cycleGroups=[]; }
  if(!cycleGroups.length){
    root.innerHTML=`<div class="card"><p class="muted">Tu n'es dans aucune brigade. Rejoins-en une depuis l'onglet Équipe.</p></div>`;
    return;
  }
  if(!cycleSelGid||!cycleGroups.find(g=>g.id===cycleSelGid)) cycleSelGid=cycleGroups[0].id;
  if(!cycleStartDate){ cycleStartDate=new Date(); cycleStartDate.setHours(0,0,0,0); }
  await renderCycle();
}

async function renderCycle(){
  const root=$("#cycleRoot"); if(!root) return;
  let brigMems=[], brigPlannings={};
  try{
    const {data}=await supa.from("group_members").select("user_id,display_name,crew").eq("group_id",cycleSelGid);
    brigMems=(data||[]).sort((a,b)=>(a.display_name||"").localeCompare(b.display_name||""));
  }catch(e){}
  if(brigMems.length){
    try{
      const {data}=await supa.from("plannings").select("user_id,data").in("user_id",brigMems.map(m=>m.user_id));
      (data||[]).forEach(p=>brigPlannings[p.user_id]=p.data||{});
    }catch(e){}
  }
  const dates=[0,1,2].map(i=>{ const d=new Date(cycleStartDate); d.setDate(d.getDate()+i); return isoOf(d); });
  try{
    const {data}=await supa.from("cycle_notes").select("*").eq("group_id",cycleSelGid).in("date_iso",dates);
    cycleNotes={}; (data||[]).forEach(n=>cycleNotes[n.date_iso]=n);
  }catch(e){ cycleNotes={}; }

  const g=cycleGroups.find(x=>x.id===cycleSelGid)||{name:"?"};
  const editable=isChef();
  const brigSelHtml=cycleGroups.length>1
    ?`<select id="cycleBrigSel" class="crew-set">${cycleGroups.map(g2=>`<option value="${g2.id}"${g2.id===cycleSelGid?" selected":""}>${escapeHtml(g2.name)}</option>`).join("")}</select>`
    :`<b>${escapeHtml(g.name)}</b>`;
  const d0=new Date(cycleStartDate), dEnd=new Date(cycleStartDate); dEnd.setDate(dEnd.getDate()+2);
  const cycleLabel=capit(d0.toLocaleDateString("fr-FR",{day:"numeric",month:"short"}))+" – "+capit(dEnd.toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"}));

  let daysHtml="";
  for(let i=0;i<3;i++){
    const dt=new Date(cycleStartDate); dt.setDate(dt.getDate()+i);
    const iso=isoOf(dt);
    const note=cycleNotes[iso]||{};
    const dayLabel=capit(dt.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"}));
    const working={Alpha:[],Bravo:[],Charlie:[],none:[]};
    const absent=[];
    brigMems.forEach(mem=>{
      const s=dayStatus(brigPlannings[mem.user_id]||{},iso);
      if(!s.inRange) return;
      if(s.leave) absent.push({mem,code:s.leave.code,color:leaveColor(s.leave.code,brigPlannings[mem.user_id]||{})});
      else if(s.work){ const c=(working[mem.crew||"none"]?mem.crew:"none")||"none"; working[c].push(mem); }
    });
    const allWorking=[...working.Alpha,...working.Bravo,...working.Charlie,...working.none];
    const chefOpts=`<option value="">— Chef de poste —</option>`+allWorking.map(m=>`<option value="${escapeHtml(m.display_name||"?")}"${note.chef_poste===(m.display_name||"")?" selected":""}>${escapeHtml(m.display_name||"?")}</option>`).join("");
    const tvHtml=(lbl,mems)=>`<div class="fc-tv"><div class="fc-tv-hd">${lbl}</div><div class="fc-tv-body">${mems.length?mems.map(m=>`<span class="fc-name">${escapeHtml(m.display_name||"?")}</span>`).join(""):`<span class="fc-empty">—</span>`}</div></div>`;
    let teamsHtml=`<div class="fc-teams">${tvHtml("TV Alpha",working.Alpha)}${tvHtml("TV Bravo",working.Bravo)}`;
    if(working.Charlie.length) teamsHtml+=tvHtml("TV Charlie",working.Charlie);
    if(working.none.length) teamsHtml+=tvHtml("En service",working.none);
    teamsHtml+=`</div>`;
    const absentHtml=absent.length?absent.map(a=>`<span class="fc-absent-item"><span class="fc-name">${escapeHtml(a.mem.display_name||"?")}</span><span class="fc-lbadge" style="background:${a.color}">${escapeHtml(a.code)}</span></span>`).join(""):`<span class="fc-empty">Aucun absent</span>`;
    daysHtml+=`<div class="fc-day" data-fiso="${iso}">
      <div class="fc-day-hd">
        <span class="fc-day-label">${dayLabel}</span>
        ${editable?`<select class="fc-chef-sel" data-fiso="${iso}">${chefOpts}</select>`:note.chef_poste?`<span class="fc-chef-badge">Chef : ${escapeHtml(note.chef_poste)}</span>`:""}
      </div>
      ${teamsHtml}
      <div class="fc-section"><div class="fc-section-lbl">Absents</div><div class="fc-absent">${absentHtml}</div></div>
      <div class="fc-section"><div class="fc-section-lbl">Sport / Notes</div>
        ${editable?`<textarea class="fc-notes" data-fiso="${iso}" placeholder="Ex : Sport 19h-21h TVA au complet…" rows="2">${escapeHtml(note.notes||"")}</textarea>`
          :note.notes?`<p class="fc-notes-ro">${escapeHtml(note.notes)}</p>`:`<p class="fc-empty">—</p>`}
      </div>
    </div>`;
  }

  root.innerHTML=`<div class="card" style="margin-bottom:14px">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
      ${brigSelHtml}
      <div class="month-nav">
        <button class="btn small" id="cyclePrev">‹ 3j</button>
        <span style="font-size:.8rem;font-weight:700;color:var(--muted)">${escapeHtml(cycleLabel)}</span>
        <button class="btn small" id="cycleNext">3j ›</button>
      </div>
    </div>
  </div>
  <div id="fcDays">${daysHtml}</div>`;

  $("#cycleBrigSel")?.addEventListener("change",e=>{ cycleSelGid=e.target.value; renderCycle(); });
  $("#cyclePrev")?.addEventListener("click",()=>{ const d=new Date(cycleStartDate); d.setDate(d.getDate()-3); cycleStartDate=d; renderCycle(); });
  $("#cycleNext")?.addEventListener("click",()=>{ const d=new Date(cycleStartDate); d.setDate(d.getDate()+3); cycleStartDate=d; renderCycle(); });
  if(editable){
    $$(".fc-chef-sel").forEach(sel=>sel.addEventListener("change",()=>{
      const iso=sel.dataset.fiso;
      saveCycleNote(iso,sel.value,document.querySelector(`.fc-notes[data-fiso="${iso}"]`)?.value||cycleNotes[iso]?.notes||"");
    }));
    $$(".fc-notes").forEach(ta=>{
      let t; ta.addEventListener("input",()=>{ clearTimeout(t); t=setTimeout(()=>{
        const iso=ta.dataset.fiso;
        saveCycleNote(iso,document.querySelector(`.fc-chef-sel[data-fiso="${iso}"]`)?.value||cycleNotes[iso]?.chef_poste||"",ta.value);
      },900); });
    });
  }
}

async function saveCycleNote(iso,chef,notes){
  try{
    await supa.rpc("save_cycle_note",{p_group_id:cycleSelGid,p_date_iso:iso,p_chef:chef,p_notes:notes});
    if(!cycleNotes[iso]) cycleNotes[iso]={};
    cycleNotes[iso].chef_poste=chef; cycleNotes[iso].notes=notes;
  }catch(e){ console.warn("cycle_note:",e.message); }
}

/* ===================== Go ===================== */
init();