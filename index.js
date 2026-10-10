// ---------- Configuration & State ----------
const CAMPUS_BOUNDS = {
   north: 35.441250,
   south: 35.437061,
   east: -88.633618,
   west: -88.640962
};

let map, db, canEdit = false, userEmail = "", currentUser = null;
let trees = []; // { id, tag, species, notes, photos, lat, lng, marker }
let selected = null;
let adding = false;
let delArmed = false, delTimer = null;
const PHOTO_BUCKET = "tree-photos"; // Supabase Storage bucket for tree photos

// Helper utilities
const $ = (s) => document.querySelector(s);
const setStatus = (m) => ($("#status").textContent = m);

// ---------- Map Initialization ----------
window.initMap = async function () {
  map = L.map("map", {
    center: [35.439257, -88.637518], 
     zoom: 18.25,
     minZoom: 17.5,
     maxZoom: 19,
    maxBounds: [
      [CAMPUS_BOUNDS.south, CAMPUS_BOUNDS.west],
      [CAMPUS_BOUNDS.north, CAMPUS_BOUNDS.east]
    ],
    maxBoundsViscosity: 1.0, // Strict bounds: can't pan outside campus
    zoomControl: false       // Added below so it can sit bottom-right, clear of the sidebar
  });

  L.control.zoom({ position: "bottomright" }).addTo(map); // Simple + / - zoom buttons

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxNativeZoom: 19,       // OSM tiles stop at 19; zoom 20 upscales them
    maxZoom: 20,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  map.on("click", onMapClick);
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
  $("#fSpecies").addEventListener("input", updateGoogleLinks);
  $("#btnMenu").addEventListener("click", toggleMenu);
  $("#btnAddPhoto").addEventListener("click", () => $("#photoInput").click());
  $("#photoInput").addEventListener("change", (e) => {
    const files = [...e.target.files];
    e.target.value = ""; // lets the same file be picked again later
    if (files.length) addPhotos(files);
  });
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

  trees.forEach((t) => setDraggable(t.marker, canEdit && t === selected));

  if ($("#btnAddPhoto")) $("#btnAddPhoto").hidden = !canEdit;
  if (selected) renderPhotos(selected); // remove buttons depend on canEdit
}

// ---------- Database & Tree Operations ----------
async function loadTrees() {
  const { data, error } = await db.from("trees").select("*").order("tag");
  if (error) return setStatus("Could not load trees: " + error.message);
  
  trees.forEach((t) => t.marker.remove());
  trees = [];
  data.forEach(addTree);
  refreshKey();
}

function addTree(row) {
  const t = { id: row.id, tag: row.tag, species: row.species, notes: row.notes, photos: row.photos || [], lat: row.lat, lng: row.lng };
  t.marker = L.marker([t.lat, t.lng], {
    title: label(t),
    icon: pin(t, false),
    draggable: false
  }).addTo(map);

  t.marker.on("click", () => select(t));
  t.marker.on("dragend", async () => {
    const pos = t.marker.getLatLng();
    t.lat = pos.lat;
    t.lng = pos.lng;
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

  const row = { tag: nextTag(), species: "", notes: "", lat: e.latlng.lat, lng: e.latlng.lng };
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
  setMarkerTitle(selected);
  selected.marker.setIcon(pin(selected, true)); // refresh the ID label
  setDraggable(selected.marker, canEdit);
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

  t.marker.remove();
  trees = trees.filter((x) => x !== t);
  removePhotoFiles(t.photos); // best-effort cleanup of the tree's stored photos
  deselect();
  setStatus(`Deleted ${t.tag}.`);
}

// ---------- Selection & Editor Panel ----------
function label(t) {
  return t.species ? `${t.tag}\n${t.species}` : t.tag;
}

function setMarkerTitle(t) {
  t.marker.options.title = label(t);
  const el = t.marker.getElement();
  if (el) el.title = label(t);
}

function setDraggable(marker, on) {
  if (!marker.dragging) return;
  if (on) marker.dragging.enable();
  else marker.dragging.disable();
}

// Tree marker: 🌳 emoji with the tree's ID underneath. Selected trees are larger
// and highlighted gold (see styles.css). Built with DOM nodes + textContent so
// a tag containing HTML characters can't inject markup.
function pin(t, sel) {
  const wrap = document.createElement("div");
  wrap.className = "tree-marker" + (sel ? " selected" : "");

  const emoji = document.createElement("div");
  emoji.className = "tree-emoji";
  emoji.textContent = "🌳";

  const tag = document.createElement("div");
  tag.className = "tree-tag";
  tag.textContent = t.tag;

  wrap.append(emoji, tag);
  return L.divIcon({
    className: "tree-icon",
    html: wrap,
    iconSize: [64, 48],
    iconAnchor: [32, 28] // bottom-center of the emoji = the tree's location
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
  renderPhotos(t);
  updateGoogleLinks();

  $("#editor").hidden = false;
  $("#hint").hidden = true;

  trees.forEach((x) => {
    x.marker.setIcon(pin(x, x === t));
    setDraggable(x.marker, canEdit && x === t);
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
    x.marker.setIcon(pin(x, false));
    setDraggable(x.marker, false);
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

// ---------- Menu Tab ----------
// Collapses/opens the sidebar (CSS handles the slide for desktop and phone layouts).
function toggleMenu() {
  const closed = document.body.classList.toggle("menu-closed");
  $("#btnMenu").setAttribute("aria-expanded", String(!closed));
}

// ---------- Google Search ----------
// Builds Google links from whatever is in the species field (works while typing, too)
function updateGoogleLinks() {
  const name = $("#fSpecies").value.trim();
  const links = [$("#linkGoogle"), $("#linkImages")];
  links.forEach((a) => (a.hidden = !name));
  if (!name) return;

  const q = encodeURIComponent(`${name} tree`);
  $("#linkGoogle").href = `https://www.google.com/search?q=${q}`;
  $("#linkImages").href = `https://www.google.com/search?q=${q}&tbm=isch`;
}

// ---------- Photos ----------
function renderPhotos(t) {
  const strip = $("#photoStrip");
  strip.replaceChildren();

  const photos = (t.photos || []).filter((u) => /^https?:\/\//.test(u));
  strip.hidden = !photos.length;

  photos.forEach((url) => {
    const item = document.createElement("div");
    item.className = "photo";

    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const img = document.createElement("img");
    img.src = url;
    img.loading = "lazy";
    img.alt = `${t.species || "Tree"} ${t.tag}`;

    link.append(img);
    item.append(link);

    if (canEdit) {
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "photo-remove";
      rm.textContent = "×";
      rm.title = "Remove photo";
      rm.setAttribute("aria-label", "Remove photo");
      rm.addEventListener("click", () => removePhoto(t, url));
      item.append(rm);
    }

    strip.append(item);
  });
}

// Shrinks big phone photos to max 1280px JPEG before upload
async function resizeImage(file, max = 1280) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not process image"))), "image/jpeg", 0.85)
  );
}

async function addPhotos(files) {
  if (!selected || !canEdit) return;
  const t = selected;
  showError("");
  setStatus(`Uploading ${files.length} photo${files.length > 1 ? "s" : ""}...`);

  const photos = [...(t.photos || [])];
  let failed = 0;
  for (const file of files) {
    try {
      const blob = await resizeImage(file);
      const path = `${t.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { error } = await db.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg" });
      if (error) throw error;
      photos.push(db.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl);
    } catch (err) {
      failed++;
      if (selected === t) showError("Upload failed: " + err.message);
    }
  }

  if (photos.length === (t.photos || []).length) return setStatus("No photos were added.");

  const { error } = await db.from("trees").update({ photos }).eq("id", t.id);
  if (error) return showError("Could not save photos: " + error.message);

  t.photos = photos;
  if (selected === t) renderPhotos(t);
  setStatus(failed ? `Added photos to ${t.tag} (${failed} failed).` : `Added photos to ${t.tag}.`);
}

async function removePhoto(t, url) {
  if (!canEdit || !confirm("Remove this photo?")) return;
  const photos = (t.photos || []).filter((u) => u !== url);
  const { error } = await db.from("trees").update({ photos }).eq("id", t.id);
  if (error) return showError("Could not remove photo: " + error.message);

  t.photos = photos;
  if (selected === t) renderPhotos(t);
  removePhotoFiles([url]);
  setStatus(`Removed photo from ${t.tag}.`);
}

// Storage path = everything after "/tree-photos/" in the public URL
function photoPath(url) {
  const marker = `/${PHOTO_BUCKET}/`;
  const i = url.indexOf(marker);
  return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length).split("?")[0]);
}

function removePhotoFiles(urls) {
  const paths = (urls || []).map(photoPath).filter(Boolean);
  if (paths.length) db.storage.from(PHOTO_BUCKET).remove(paths); // best-effort
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
      map.setView([t.lat, t.lng], Math.max(map.getZoom(), 19));
      select(t);
    });

    list.append(chip);
  });
}

// ---------- Start ----------
// Google Maps used to call initMap via a script callback; Leaflet has no callback, so start on page load.
document.addEventListener("DOMContentLoaded", () => window.initMap());