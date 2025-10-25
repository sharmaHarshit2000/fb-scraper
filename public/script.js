const form = document.getElementById("scrapeForm");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const startBtn = document.getElementById("startBtn");
const cancelBtn = document.getElementById("cancelBtn");

let es = null;
let currentJobId = null;

// Log messages with timestamps
function logLine(msg) {
  const ts = new Date().toLocaleTimeString();
  logEl.textContent = `[${ts}] ${msg}\n` + logEl.textContent;
}

// Detect backend base URL
const backendBase =
  window.location.port === "5500"
    ? "http://localhost:3000"
    : window.location.origin;

// Encrypt/decrypt for local cookie storage
function encrypt(data) {
  const json = JSON.stringify(data);
  return btoa(
    new TextEncoder()
      .encode(json)
      .reduce((acc, byte) => acc + String.fromCharCode(byte), "")
  );
}

function decrypt(data) {
  try {
    const binary = atob(data);
    const bytes = new Uint8Array([...binary].map((ch) => ch.charCodeAt(0)));
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Simple toast notifications
function showToast(msg, color = "orange") {
  const toast = document.createElement("div");
  toast.textContent = msg;
  toast.style = `
    position:fixed;bottom:10px;right:10px;
    background:${color};color:white;
    padding:8px 12px;border-radius:6px;
    font-size:14px;z-index:9999;`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// Load and validate saved cookies
window.addEventListener("DOMContentLoaded", () => {
  const cookiesInput = document.getElementById("cookies");
  const statusBadge = document.createElement("div");
  statusBadge.style.marginTop = "4px";
  statusBadge.style.fontSize = "13px";
  cookiesInput.parentNode.insertBefore(statusBadge, cookiesInput.nextSibling);

  const saved = localStorage.getItem("fbCookiesEnc");

  function updateCookieStatus(text, color) {
    statusBadge.textContent = text;
    statusBadge.style.color = color;
  }

  if (saved) {
    const parsed = decrypt(saved);
    if (parsed?.cookies) {
      const age = Date.now() - parsed.savedAt;
      const expired = age > 7 * 24 * 3600 * 1000;
      const nearExpiry = age > 3 * 24 * 3600 * 1000;

      if (expired) {
        localStorage.removeItem("fbCookiesEnc");
        updateCookieStatus(
          "Cookies expired — please paste new ones.",
          "orange"
        );
        logLine("Saved cookies expired (older than 7 days). Cleared.");
      } else {
        cookiesInput.value = JSON.stringify(parsed.cookies, null, 2);
        updateCookieStatus("Active Facebook cookies loaded.", "green");
        logLine("Loaded saved Facebook cookies from localStorage.");
        if (nearExpiry) {
          updateCookieStatus("Cookies getting old — refresh soon.", "orange");
        }
      }
    } else {
      updateCookieStatus("Invalid saved cookies.", "red");
    }
  } else {
    updateCookieStatus("No cookies saved.", "gray");
  }

  // Info note
  const note = document.createElement("div");
  note.innerHTML = `<small>Cookies auto-saved locally (encrypted) until they expire or are cleared.</small>`;
  note.style.marginTop = "4px";
  note.style.color = "#555";

  // Clear button
  const clearBtn = document.createElement("button");
  clearBtn.textContent = "Clear Saved Cookies";
  clearBtn.className = "btn secondary";
  clearBtn.style.marginTop = "6px";
  clearBtn.onclick = (e) => {
    e.preventDefault();
    localStorage.removeItem("fbCookiesEnc");
    cookiesInput.value = "";
    updateCookieStatus("No cookies saved.", "gray");
    logLine("Cleared saved cookies from localStorage.");
    showToast("Old cookies cleared — paste new ones when needed.", "gray");
  };

  cookiesInput.parentNode.insertBefore(note, statusBadge.nextSibling);
  cookiesInput.parentNode.insertBefore(clearBtn, note.nextSibling);

  // Live cookie validation
  cookiesInput.addEventListener("input", () => {
    const val = cookiesInput.value.trim();
    if (!val) {
      updateCookieStatus("No cookies entered.", "gray");
      return;
    }

    try {
      const parsed = JSON.parse(val);
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed[0].name &&
        parsed[0].value
      ) {
        const payload = { cookies: parsed, savedAt: Date.now() };
        localStorage.setItem("fbCookiesEnc", encrypt(payload));
        updateCookieStatus("Cookies look valid & saved.", "green");
        logLine("Cookies validated and saved instantly.");
      } else {
        updateCookieStatus(
          "JSON parsed but missing required fields.",
          "orange"
        );
      }
    } catch {
      updateCookieStatus("Invalid JSON format.", "red");
    }
  });
});

// Handle form submission
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const groupUrl = document.getElementById("groupUrl").value.trim();
  const scrollLimit =
    parseInt(document.getElementById("scrollLimit").value, 10) || 50;
  const cookiesInput = document.getElementById("cookies").value.trim();

  if (!groupUrl) {
    statusEl.textContent = "Enter a valid Facebook group URL.";
    statusEl.className = "status error";
    return;
  }

  if (!cookiesInput) {
    showToast("Please paste your Facebook cookies before scraping.");
    return;
  }

  let cookies = [];
  try {
    cookies = JSON.parse(cookiesInput);
    cookies = cookies.filter(
      (c) => c.name && c.value && !String(c.value).includes("deleted")
    );
    if (!cookies.length) throw new Error("No valid cookies found");

    const payload = { cookies, savedAt: Date.now() };
    localStorage.setItem("fbCookiesEnc", encrypt(payload));
    logLine("Cookies saved (encrypted) locally.");
  } catch {
    statusEl.textContent = "Invalid cookies JSON.";
    statusEl.className = "status error";
    return;
  }

  statusEl.textContent = "Starting scraping...";
  statusEl.className = "status loading";
  startBtn.disabled = true;
  cancelBtn.disabled = false;
  logEl.textContent = "";
  logLine(`Starting scrape for ${groupUrl} (Scroll limit: ${scrollLimit})`);

  try {
    const resp = await fetch(`${backendBase}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupUrl, scrollLimit, cookies }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `Server responded with ${resp.status}`);
    }

    const data = await resp.json();
    if (!data.jobId) throw new Error("No jobId returned from server.");

    currentJobId = data.jobId;
    logLine(`Job started: ${data.jobId}`);
    connectSSE(data.jobId);
  } catch (err) {
    console.error("Error starting job:", err);
    statusEl.textContent = "Error: " + err.message;
    statusEl.className = "status error";
    startBtn.disabled = false;
    cancelBtn.disabled = true;
    logLine("Error starting job: " + err.message);
  }
});

// Connect to backend for live progress updates
function connectSSE(jobId) {
  if (es)
    try {
      es.close();
    } catch {}
  es = new EventSource(`${backendBase}/events/${jobId}`);

  es.addEventListener("log", (ev) => {
    const d = JSON.parse(ev.data || "{}");
    if (d.msg) logLine(d.msg);
  });

  es.addEventListener("progress", (ev) => {
    const d = JSON.parse(ev.data || "{}");
    const foundCount = d.found ?? d.foundNumbers ?? 0;
    statusEl.textContent = `Scroll ${d.i ?? "?"}/${
      d.total ?? "?"
    } — found ${foundCount} numbers`;
    statusEl.className = "status loading";
    logLine(`Progress: Scroll ${d.i}/${d.total}, found ${foundCount}`);
  });

  es.addEventListener("done", (ev) => {
    const d = JSON.parse(ev.data || "{}");
    logLine(`Scraping done — preparing download: ${d.downloadUrl}`);
    statusEl.textContent = "Scraping complete. Downloading CSV...";
    statusEl.className = "status success";

    fetch(`${backendBase}${d.downloadUrl}`)
      .then((r) => r.blob())
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = d.file || `facebook_group_${Date.now()}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
        logLine("CSV downloaded successfully.");
      })
      .catch((err) => {
        logLine("Download error: " + err.message);
        statusEl.textContent = "Download failed.";
        statusEl.className = "status error";
      })
      .finally(() => {
        cleanupSSE();
        startBtn.disabled = false;
        cancelBtn.disabled = true;
      });
  });

  es.addEventListener("error", (ev) => {
    let payload = {};
    try {
      payload = JSON.parse(ev.data || "{}");
    } catch {}
    const message = payload.message || "Unknown error";
    logLine("Job error: " + message);
    statusEl.textContent = "Error: " + message;
    statusEl.className = "status error";

    if (/login required|cookies expired|invalid/i.test(message)) {
      localStorage.removeItem("fbCookiesEnc");
      document.getElementById("cookies").value = "";
      logLine("Cookies seem expired — cleared from localStorage.");
      showToast(
        "Facebook cookies expired — please paste fresh ones.",
        "orange"
      );
    }

    cleanupSSE();
    startBtn.disabled = false;
    cancelBtn.disabled = true;
  });

  es.onopen = () => logLine(`Connected to job ${jobId}`);
  es.onerror = () => logLine("SSE connection lost or closed.");
}

// Cleanup SSE safely
function cleanupSSE() {
  if (es) {
    try {
      es.close();
    } catch {}
    es = null;
  }
}

// Cancel running job
cancelBtn.addEventListener("click", async () => {
  if (!currentJobId) {
    showToast("No active job to cancel.", "orange");
    return;
  }

  try {
    logLine(`Sending cancel request for job ${currentJobId}...`);
    await fetch(`${backendBase}/cancel/${currentJobId}`, { method: "POST" });

    logLine("Cancel request sent. Scraper will stop shortly.");
    showToast("Scraper canceled.", "gray");

    cleanupSSE();
    statusEl.textContent = "Canceled by user.";
    statusEl.className = "status error";
  } catch (err) {
    console.error("Cancel failed:", err);
    showToast("Cancel failed: " + err.message, "red");
  } finally {
    startBtn.disabled = false;
    cancelBtn.disabled = true;
  }
});
