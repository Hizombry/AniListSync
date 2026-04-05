const STORAGE_KEYS = {
  token: "anilistToken",
  userName: "anilistUserName",
  clientId: "anilistClientId",
};

const authDebugLog = [];

function addAuthDebugLog(message, extra = null) {
  const timestamp = new Date().toISOString();
  const details =
      extra === null
          ? ""
          : ` | ${typeof extra === "string" ? extra : JSON.stringify(extra)}`;

  authDebugLog.unshift(`[${timestamp}] ${message}${details}`);
  if (authDebugLog.length > 30) authDebugLog.length = 30;
}

function getRedirectUri() {
  // Der Redirect wird für launchWebAuthFlow verwendet
  return chrome.identity.getRedirectURL("anilist-auth");
}

async function getAuthState() {
  const data = await chrome.storage.sync.get([
    STORAGE_KEYS.token,
    STORAGE_KEYS.userName,
    STORAGE_KEYS.clientId,
  ]);

  return {
    clientId: data[STORAGE_KEYS.clientId] || "",
    token: data[STORAGE_KEYS.token] || "",
    userName: data[STORAGE_KEYS.userName] || "",
    redirectUri: getRedirectUri(),
  };
}

async function saveClientId(clientId) {
  const normalized = String(clientId || "").trim();
  if (normalized) {
    await chrome.storage.sync.set({ [STORAGE_KEYS.clientId]: normalized });
  }
  return getAuthState();
}

async function clearAuthSession() {
  // Beim Logout die Client ID behalten, nur Token + Username löschen
  await chrome.storage.sync.remove([
    STORAGE_KEYS.token,
    STORAGE_KEYS.userName,
  ]);
  return getAuthState();
}

async function resetClientId() {
  await chrome.storage.sync.remove([STORAGE_KEYS.clientId]);
  return getAuthState();
}

async function fetchViewer(token) {
  addAuthDebugLog("Prüfe Viewer mit Token");

  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: "query { Viewer { id name } }",
    }),
  });

  const data = await response.json();

  if (data.errors?.length) {
    throw new Error(data.errors[0].message || "AniList hat den Token abgelehnt.");
  }

  if (!data?.data?.Viewer?.name) {
    throw new Error("AniList hat keinen gültigen Benutzer zurückgegeben.");
  }

  return data.data.Viewer;
}

async function persistAuthSession(token) {
  addAuthDebugLog("Speichere Auth-Session");
  const viewer = await fetchViewer(token);

  await chrome.storage.sync.set({
    [STORAGE_KEYS.token]: token,
    [STORAGE_KEYS.userName]: viewer.name,
  });

  chrome.runtime.sendMessage({
    type: "AUTH_SUCCESS",
    payload: { userName: viewer.name },
  });

  return viewer;
}

function buildAuthUrl(clientId) {
  const authUrl = new URL("https://anilist.co/api/v2/oauth/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "token");
  authUrl.searchParams.set("redirect_uri", getRedirectUri());

  addAuthDebugLog("Baue AniList Auth-URL", authUrl.toString());
  return authUrl;
}

function extractTokenFromUrl(redirectUrl) {
  addAuthDebugLog("Verarbeite Callback-URL", redirectUrl);

  const url = new URL(redirectUrl);
  const fragment = url.hash?.startsWith("#") ? url.hash.slice(1) : "";
  const params = new URLSearchParams(fragment || url.search);

  const token = params.get("access_token") || params.get("token");

  if (!token) {
    addAuthDebugLog("Kein Token gefunden in URL", redirectUrl);
    throw new Error(
        "Kein Access Token gefunden. Prüfe die Redirect-URI und die AniList-App-Konfiguration."
    );
  }

  addAuthDebugLog("Token erfolgreich extrahiert");
  return token;
}

async function startAniListAuth() {
  const { clientId } = await getAuthState();
  addAuthDebugLog("Starte AniList Auth", { clientId, redirectUri: getRedirectUri() });

  if (!clientId) {
    throw new Error("AniList Client ID fehlt. Bitte im Popup eintragen.");
  }

  const authUrl = buildAuthUrl(clientId);

  // Chrome liefert hier die finale Redirect-URL zurück
  const redirectUrl = await chrome.identity.launchWebAuthFlow({
    interactive: true,
    url: authUrl.toString(),
  });

  if (!redirectUrl) {
    throw new Error("AniList-Anmeldung wurde abgebrochen oder ist fehlgeschlagen.");
  }

  const token = extractTokenFromUrl(redirectUrl);
  const viewer = await persistAuthSession(token);

  addAuthDebugLog("AniList Auth erfolgreich", { userName: viewer.name });

  return {
    token,
    userName: viewer.name,
    redirectUri: getRedirectUri(),
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case "GET_AUTH_DEBUG":
        return { success: true, log: [...authDebugLog] };

      case "CLEAR_AUTH_DEBUG":
        authDebugLog.length = 0;
        return { success: true };

      case "GET_AUTH_STATE":
        return { success: true, state: await getAuthState() };

      case "SAVE_AUTH_SETTINGS":
        return {
          success: true,
          state: await saveClientId(message.payload?.clientId),
        };

      case "START_AUTH":
        return {
          success: true,
          ...(await startAniListAuth()),
        };

      case "LOGOUT_AUTH":
        return {
          success: true,
          state: await clearAuthSession(),
        };

      case "RESET_CLIENT_ID":
        return {
          success: true,
          state: await resetClientId(),
        };

      default:
        return { success: false, error: `Unbekannte Nachricht: ${message.type}` };
    }
  })()
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          success: false,
          error: error?.message || String(error),
        });
      });

  return true;
});