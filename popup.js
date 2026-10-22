// popup.js
const tokenInput = document.getElementById("tokenInput");
const saveBtn    = document.getElementById("saveBtn");
const statusDiv  = document.getElementById("status");
const toggleBtn  = document.getElementById("toggleBtn");

const CLIENT_ID = "38398";
let statusTimer = null;

document.getElementById("loginBtn").addEventListener("click", () => {
  const url = `https://anilist.co/api/v2/oauth/authorize?client_id=${CLIENT_ID}&response_type=token`;
  chrome.tabs.create({ url });
});

// Token laden (mit Migration aus storage.sync)
async function loadToken() {
  const local = await chrome.storage.local.get("anilistToken");
  if (local.anilistToken) return local.anilistToken;
  try {
    const sync = await chrome.storage.sync.get("anilistToken");
    if (sync.anilistToken) {
      await chrome.storage.local.set({ anilistToken: sync.anilistToken });
      await chrome.storage.sync.remove("anilistToken");
      return sync.anilistToken;
    }
  } catch { /* ignorieren */ }
  return "";
}

loadToken().then(t => { if (t) tokenInput.value = t; });

// Token anzeigen/verbergen
toggleBtn.addEventListener("click", () => {
  const hidden = tokenInput.type === "password";
  tokenInput.type = hidden ? "text" : "password";
  toggleBtn.textContent = hidden ? "🙈" : "👁";
});

// Akzeptiert den reinen Token ODER die komplette Redirect-URL (…#access_token=…&…)
function extractToken(raw) {
  const m = String(raw).match(/access_token=([^&\s]+)/);
  return (m ? m[1] : String(raw)).trim();
}

saveBtn.addEventListener("click", async () => {
  const token = extractToken(tokenInput.value);
  if (!token) {
    showStatus("Bitte Token eingeben!", true);
    return;
  }

  showStatus("Prüfe Token…", false, 0);
  try {
    const r = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: "query { Viewer { name } }" }),
    });
    const data = await r.json();
    const name = data?.data?.Viewer?.name;
    if (!name) throw new Error(data?.errors?.[0]?.message || "Token ungültig");

    await chrome.storage.local.set({ anilistToken: token });
    tokenInput.value = token;
    showStatus(`✅ Eingeloggt als ${name}`);
  } catch (e) {
    showStatus(`❌ ${e.message}`, true);
  }
});

function showStatus(msg, isError = false, hideAfterMs = 3500) {
  clearTimeout(statusTimer);
  statusDiv.textContent = msg;
  statusDiv.className = "status" + (isError ? " error" : "");
  if (hideAfterMs > 0) statusTimer = setTimeout(() => (statusDiv.textContent = ""), hideAfterMs);
}
