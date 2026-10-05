// ============================================================
// Elden Earth — Access Control Server
// Run on your iMac 24/7 to serve the allowed player list.
// No one can see these emails in client-side source code.
//
// Usage:
//   node server/access-control.js
//
// Endpoints:
//   GET /allowed-emails  → returns { allowed: ["email1", "email2"] }
//   POST /check-email    → body: { email } → returns { allowed: true/false }
// ============================================================
const http = require("http");
const crypto = require("crypto");

// --- YOUR ALLOWED EMAILS (ONLY VISIBLE HERE ON THE SERVER) ---
// EMPTY ARRAY = GAME OPEN TO THE WORLD (banned emails are still blocked).
// Add emails back any time to re-enable friends-only mode.
const ALLOWED_EMAILS = [
];

// --- BANNED EMAILS ---
const BANNED_EMAILS = [
  "carsonwood00@gmail.com",
  "terraminesofmoria@gmail.com",
  "esmeraldaanimefan@gmail.com",
  "cwood@",
  "anthoneysidra1983@gmail.com",
  "maxelvijs@gmail.com",
  "chrissyrn27@gmail.com",
  "rwhittaker2018@gmail.com",
  "kim.prentice@gmail.com",
  "alain.recuze@gmail.com",
  "hellomotogone@gmail.com",
  "710jdc710@gmail.com",
  "amalott84@gmail.com",
  "fzgeld2000@gmail.com",
  "eyemgoing2killamil@gmail.com"
];

// --- CONFIG ---
const PORT = 8877;
const ALLOWED_ORIGINS = [
  "https://vicsanity623.github.io",
  "https://elden-earth-main.pages.dev",
  "http://localhost:8001",
  "http://127.0.0.1:8001"
];

function hashEmail(email) {
  return crypto.createHash("sha256").update(email.toLowerCase().trim()).digest("hex").slice(0, 12);
}

function handleRequest(req, res) {
  // CORS headers
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /allowed-emails — returns the hashed list (never raw emails)
  if (req.method === "GET" && req.url === "/allowed-emails") {
    const hashed = ALLOWED_EMAILS.map(e => hashEmail(e));
    res.writeHead(200);
    res.end(JSON.stringify({ allowed: hashed }));
    return;
  }

  // POST /check-email — validates an email server-side
  if (req.method === "POST" && req.url === "/check-email") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const { email } = JSON.parse(body);
        const emailLower = String(email || "").toLowerCase().trim();

        // Check banned list first
        for (const banned of BANNED_EMAILS) {
          if (emailLower === banned || emailLower.startsWith(banned)) {
            console.log(`[BLOCKED] ${emailLower} (banned)`);
            res.writeHead(200);
            res.end(JSON.stringify({ allowed: false, reason: "banned" }));
            return;
          }
        }

        // Check whitelist — an EMPTY whitelist means open to the world.
        if (ALLOWED_EMAILS.length === 0) {
          console.log(`[ALLOWED] ${emailLower} (open access)`);
          res.writeHead(200);
          res.end(JSON.stringify({ allowed: true }));
          return;
        }
        const isAllowed = ALLOWED_EMAILS.some(allowed => emailLower === allowed);
        if (isAllowed) {
          console.log(`[ALLOWED] ${emailLower}`);
          res.writeHead(200);
          res.end(JSON.stringify({ allowed: true }));
        } else {
          console.log(`[BLOCKED] ${emailLower} (not on whitelist)`);
          res.writeHead(200);
          res.end(JSON.stringify({ allowed: false, reason: "not_whitelisted" }));
        }
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid request body" }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
}

const server = http.createServer(handleRequest);
server.listen(PORT, () => {
  console.log(`[Elden Earth Access Control] Running on port ${PORT}`);
  console.log(`  GET  http://localhost:${PORT}/allowed-emails`);
  console.log(`  POST http://localhost:${PORT}/check-email`);
  console.log(`  Allowed: ${ALLOWED_EMAILS.length === 0 ? "OPEN TO THE WORLD" : ALLOWED_EMAILS.length + " emails"}`);
});
