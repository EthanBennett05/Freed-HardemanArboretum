// ---------- Configuration & State ----------
const CAMPUS_BOUNDS = {
  north: 35.4430,
  south: 35.4355,
  east: -88.633480,
  west: -88.641471
};

let map, db, canEdit = false, userEmail = "", currentUser = null;
let AdvancedMarkerElement, PinElement;
let trees = []; // { id, tag, species, notes, lat, lng, marker }
let selected = null;
let adding = false;
let delArmed = false, delTimer = null;

// Helper utilities
const $ = (s) => document.querySelector(s);
const setStatus = (m) => ($("#status").textContent = m);
const num = (v) => (typeof v === "function" ? v() : v);

// ---------- Map Initialization ----------
window.initMap = async function () {
  await customElements.whenDefined("gmp-map");
  map = $("#map").innerMap;
  ({ AdvancedMarkerElement, PinElement } = await google.maps.importLibrary("marker"));

  map.setOptions({
  restriction: { latLngBounds: CAMPUS_BOUNDS, strictBounds: true },
  minZoom: 16,
  maxZoom: 20,
  mapTypeId: "satellite",     // Satellite imagery without road/place labels
  disableDefaultUI: true,     // Removes Map/Satellite dropdown, Street View, and Fullscreen buttons
  zoomControl: true           // (Optional) Keeps simple + / - zoom buttons visible
});

  map.addListener("click", onMapClick);
  wireUi();

  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: key } = window.APP_CONFIG || {};
  if (!url || !key || url.includes("YOUR_")) {
    return setStatus("Add your Supabase URL and anon key to config.js.");
  }
  db = supabase.createClient(url, key);

  const { data } = await db.auth.getSession();
  await applySession(data.session);
  db.auth.onAuthStateChange((_e, session) => setTimeout(() => applySession(session), 0));
  await loadTrees();
};

function wireUi() {
  $("#btnAddTree").addEventListener("click", () => setAdding(!adding));
  $("#btnCancel").addEventListener("click", () => setAdding(false));
  $("#btnSave").addEventListener("click", saveTree);
  $("#btnDelete").addEventListener("click", onDeleteClick);
  $("#btnClose").addEventListener("click", deselect);
  $("#keySearch").addEventListener("input", refreshKey);
  document.addEventListener("keydown", (e) => e.key === "Escape" && setAdding(false));

  // --- Auth Button Handlers ---
  $("#btnShowLogin")?.addEventListener("click", async () => {
    const { error } = await db.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin }
    });
    if (error) setStatus("Sign-in failed: " + error.message);
  });

  $("#btnSignOut")?.addEventListener("click", async () => {
    const { error } = await db.auth.signOut();
    if (error) setStatus("Sign-out failed: " + error.message);
  });
}

// ---------- Authentication UI & Logic ----------
function buildAuthUi() {
  const authContainer = document.querySelector(".user-auth") || document.querySelector("header");

  // Sign In Button
  const login = document.createElement("button");
  login.id = "btnShowLogin";
  login.textContent = "Admin sign in with Google";

  // User Profile Container
  const userProfile = document.createElement("div");
  userProfile.id = "userProfile";
  userProfile.className = "user-profile";
  userProfile.hidden = true;

  // Profile Avatar Image
  const avatar = document.createElement("img");
  avatar.id = "userAvatar";
  avatar.className = "avatar";
  avatar.alt = "Profile Picture";

  // Profile Details Container
  const userDetails = document.createElement("div");
  userDetails.className = "user-details";

  const label = document.createElement("span");
  label.id = "userLabel";

  const out = document.createElement("button");
  out.id = "btnSignOut";
  out.className = "btn-link";
  out.textContent = "Sign out";

  // Assemble Profile Component
  userDetails.append(label, out);
  userProfile.append(avatar, userDetails);

  if (authContainer) {
    authContainer.append(login, userProfile);
  }

  // Auth Event Listeners
  login.addEventListener("click", async () => {
    const { error } = await db.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin }
    });
    if (error) setStatus("Sign-in failed: " + error.message);
  });

  out.addEventListener("click", async () => {
    const { error } = await db.auth.signOut();
    if (error) setStatus("Sign-out failed: " + error.message);
  });
}

async function applySession(session) {
  currentUser = session?.user ?? null;
  userEmail = currentUser?.email ?? "";
  canEdit = false;

  if (session) {
    const { data, error } = await db.rpc("is_admin");
    canEdit = !error && data === true;
  }
  renderAuth();
}

function renderAuth() {
  const loginBtn = $("#btnShowLogin");
  const userProfile = $("#userProfile");
  const userLabel = $("#userLabel");
  const avatar = $("#userAvatar");

  if (currentUser) {
    if (loginBtn) loginBtn.hidden = true;
    if (userProfile) userProfile.hidden = false;
    if (userLabel) userLabel.textContent = `${userEmail} (${canEdit ? "admin" : "view only"})`;

    const avatarUrl = currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture;
    if (avatar && avatarUrl) {
      avatar.src = avatarUrl;
    }
  } else {
    if (loginBtn) loginBtn.hidden = false;
    if (userProfile) userProfile.hidden = true;
    if (userLabel) userLabel.textContent = "";
  }

  // Update editing permissions across controls
  if ($("#btnAddTree")) $("#btnAddTree").hidden = !canEdit;
  if (!canEdit) setAdding(false);

  ["#fTag", "#fSpecies", "#fNotes"].forEach((s) => {
    const el = $(s);
    if (el) el.disabled = !canEdit;
  });

  if ($("#btnSave")) $("#btnSave").hidden = !canEdit;
  if ($("#btnDelete")) $("#btnDelete").hidden = !canEdit;
  if ($("#dragTip")) $("#dragTip").hidden = !canEdit;

  trees.forEach((t) => (t.marker.gmpDraggable = canEdit && t === selected));
}

// ---------- Database & Tree Operations ----------
async function loadTrees() {
  const { data, error } = await db.from("trees").select("*").order("tag");
  if (error) return setStatus("Could not load trees: " + error.message);
  
  trees.forEach((t) => (t.marker.map = null));
  trees = [];
  data.forEach(addTree);
  refreshKey();
}

function addTree(row) {
  const t = { id: row.id, tag: row.tag, species: row.species, notes: row.notes, lat: row.lat, lng: row.lng };
  t.marker = new AdvancedMarkerElement({
    map,
    position: { lat: t.lat, lng: t.lng },
    title: label(t),
    content: pin(false),
    gmpClickable: true,
    gmpDraggable: false
  });

  t.marker.addEventListener("gmp-click", () => select(t));
  t.marker.addEventListener("dragend", async () => {
    t.lat = num(t.marker.position.lat);
    t.lng = num(t.marker.position.lng);
    if (selected === t) showCoords(t);
    const { error } = await db.from("trees").update({ lat: t.lat, lng: t.lng }).eq("id", t.id);
    if (error) setStatus("Could not save new position: " + error.message);
  });

  trees.push(t);
  return t;
}

async function onMapClick(e) {
  if (!adding || !canEdit) return;
  setAdding(false);

  const row = { tag: nextTag(), species: "", notes: "", lat: e.latLng.lat(), lng: e.latLng.lng() };
  const { data, error } = await db.from("trees").insert(row).select().single();
  if (error) return setStatus("Could not add tree: " + error.message);

  const t = addTree(data);
  select(t);
  setStatus(`Added ${t.tag}. Fill in details and click Save.`);
}

function nextTag() {
  let n = 1;
  while (trees.some((t) => t.tag === `T-${String(n).padStart(3, "0")}`)) n++;
  return `T-${String(n).padStart(3, "0")}`;
}

async function saveTree() {
  if (!selected || !canEdit) return;
  const tag = $("#fTag").value.trim();
  if (!tag) return showError("ID can't be empty.");
  if (trees.some((t) => t !== selected && t.tag.toLowerCase() === tag.toLowerCase())) {
    return showError(`ID "${tag}" is already used.`);
  }

  const fields = { tag, species: $("#fSpecies").value.trim(), notes: $("#fNotes").value };
  const { error } = await db.from("trees").update(fields).eq("id", selected.id).select().single();
  if (error) return showError(error.code === "23505" ? `ID "${tag}" is already used.` : error.message);

  Object.assign(selected, fields);
  selected.marker.title = label(selected);
  showError("");
  refreshKey();
  setStatus(`Saved ${tag}.`);
}

function onDeleteClick() {
  if (!selected || !canEdit) return;
  if (!delArmed) {
    delArmed = true;
    $("#btnDelete").textContent = "Confirm Delete";
    delTimer = setTimeout(disarmDelete, 3000);
    return;
  }
  disarmDelete();
  deleteTree();
}

function disarmDelete() {
  clearTimeout(delTimer);
  delArmed = false;
  $("#btnDelete").textContent = "Delete";
}

async function deleteTree() {
  const t = selected;
  const { data, error } = await db.from("trees").delete().eq("id", t.id).select();
  if (error || !data.length) return showError(error ? error.message : "Not allowed to delete.");

  t.marker.map = null;
  trees = trees.filter((x) => x !== t);
  deselect();
  setStatus(`Deleted ${t.tag}.`);
}

// ---------- Selection & Editor Panel ----------
function label(t) {
  return t.species ? `${t.tag}\n${t.species}` : t.tag;
}

function pin(sel) {
  return new PinElement({
    background: sel ? "#c59b27" : "#701422", // FHU Gold for selected, FHU Maroon for markers
    borderColor: "#ffffff",
    glyphColor: "#ffffff",
    scale: sel ? 1.3 : 1
  });
}

function select(t) {
  disarmDelete();
  selected = t;
  $("#fTag").value = t.tag;
  $("#fSpecies").value = t.species;
  $("#fNotes").value = t.notes;
  showError("");
  showCoords(t);

  $("#editor").hidden = false;
  $("#hint").hidden = true;

  trees.forEach((x) => {
    x.marker.content = pin(x === t);
    x.marker.gmpDraggable = canEdit && x === t;
  });

  refreshKey();
  $("#keyList .chip.active")?.scrollIntoView({ block: "nearest" });
}

function deselect() {
  disarmDelete();
  selected = null;
  $("#editor").hidden = true;
  $("#hint").hidden = false;

  trees.forEach((x) => {
    x.marker.content = pin(false);
    x.marker.gmpDraggable = false;
  });

  refreshKey();
}

function showCoords(t) {
  $("#fCoords").textContent = `Location: ${t.lat.toFixed(6)}, ${t.lng.toFixed(6)}`;
}

function showError(msg) {
  $("#editorError").textContent = msg;
}

function setAdding(v) {
  adding = v;
  $("#btnAddTree").classList.toggle("active", v);
  $("#btnCancel").hidden = !v;
  if (v) setStatus("Click the map where the tree is located.");
}

// ---------- Interactive Species Key ----------
// ---------- Interactive Species Key ----------
function refreshKey() {
  const q = $("#keySearch").value.trim().toLowerCase();
  
  // Filter and sort by Species Name first, then Tag ID
  const shown = trees
    .filter((t) => !q || `${t.tag} ${t.species} ${t.notes}`.toLowerCase().includes(q))
    .sort((a, b) => {
      const nameA = a.species || "Unknown Species";
      const nameB = b.species || "Unknown Species";
      return nameA.localeCompare(nameB) || a.tag.localeCompare(b.tag, undefined, { numeric: true });
    });

  $("#keyCount").textContent = q ? `(${shown.length} of ${trees.length})` : `(${trees.length})`;

  const list = $("#keyList");
  list.replaceChildren();

  if (!shown.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = trees.length ? "No matches." : "No trees yet.";
    list.append(p);
  }

  shown.forEach((t) => {
    const chip = document.createElement("button");
    chip.className = "chip" + (t === selected ? " active" : "");

    const name = document.createElement("strong");
    name.textContent = t.species || "Unknown Species";

    const tag = document.createElement("span");
    tag.textContent = t.tag;

    chip.append(name, tag);
    chip.addEventListener("click", () => {
      map.panTo({ lat: t.lat, lng: t.lng });
      if (map.getZoom() < 19) map.setZoom(19);
      select(t);
    });

    list.append(chip);
  });
}