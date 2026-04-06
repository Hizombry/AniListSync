// popup.js
const tokenInput = document.getElementById("tokenInput");
const saveBtn    = document.getElementById("saveBtn");
const statusDiv  = document.getElementById("status");
const toggleBtn  = document.getElementById("toggleBtn");

const CLIENT_ID = "38398";

document.getElementById("loginBtn").addEventListener("click", () => {
  const url = `https://anilist.co/api/v2/oauth/authorize?client_id=${CLIENT_ID}&response_type=token`;

  // Öffnet Login Fenster
  chrome.tabs.create({ url });
});

// Gespeicherten Token laden
chrome.storage.sync.get("anilistToken", ({ anilistToken }) => {
  if (anilistToken) tokenInput.value = anilistToken;
});

// Token anzeigen/verbergen
toggleBtn.addEventListener("click", () => {
  if (tokenInput.type === "password") {
    tokenInput.type = "text";
    toggleBtn.textContent = "🙈";
  } else {
    tokenInput.type = "password";
    toggleBtn.textContent = "👁";
  }
});

// Token speichern
saveBtn.addEventListener("click", () => {
  const token = tokenInput.value.trim();

  if (!token) {
    showStatus("Bitte Token eingeben!", true);
    return;
  }

  chrome.storage.sync.set({ anilistToken: token }, () => {
    showStatus("✅ Token gespeichert!");
  });
});

function showStatus(msg, isError = false) {
  statusDiv.textContent = msg;
  statusDiv.className = "status" + (isError ? " error" : "");
  setTimeout(() => (statusDiv.textContent = ""), 3000);
}
