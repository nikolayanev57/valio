const { Resend } = require("resend");
const { google } = require("googleapis");

function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Google Sheets treats values written with valueInputOption "USER_ENTERED"
// as if a person typed them — a leading =, +, -, @ (or tab/CR) turns the
// cell into a formula (e.g. =HYPERLINK(...) or =IMPORTXML(...)). Prefixing
// such values with an apostrophe forces Sheets to keep them as plain text.
function sanitizeForSheets(str) {
  const s = String(str);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SHORT = 200;
const MAX_MESSAGE = 2000;

function validateAndNormalize(body) {
  const clean = (v, max) => String(v ?? "").trim().slice(0, max);

  const name = clean(body.name, MAX_SHORT);
  const restaurant = clean(body.restaurant, MAX_SHORT);
  const email = clean(body.email, MAX_SHORT);
  const currentMenuUrl = clean(body.currentMenuUrl, MAX_SHORT);
  const preferredStyle = clean(body.preferredStyle, MAX_SHORT);
  const message = clean(body.message, MAX_MESSAGE);

  if (!name || !restaurant || !email) return { error: "Missing required fields" };
  if (!EMAIL_RE.test(email)) return { error: "Invalid email" };

  return { data: { name, restaurant, email, currentMenuUrl, preferredStyle, message } };
}

// Simple in-memory per-IP rate limit: 5 requests / 10 minutes. Resets on
// cold start, which is fine for a low-traffic contact form — it only needs
// to blunt scripted abuse, not survive a distributed attack.
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const requestLog = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (requestLog.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT_MAX;
}

async function sendNotificationEmail({ name, restaurant, email, currentMenuUrl, preferredStyle, message }) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.INQUIRY_NOTIFICATION_EMAIL;
  if (!apiKey || !to) {
    console.warn("[email] RESEND_API_KEY or INQUIRY_NOTIFICATION_EMAIL not set — skipping.");
    return;
  }

  const resend = new Resend(apiKey);
  const html = `
    <div style="font-family: sans-serif; max-width: 480px;">
      <h2>Ново запитване от VALIO сайта</h2>
      <table cellpadding="6" style="border-collapse: collapse; width: 100%;">
        <tr><td style="color:#666;border-bottom:1px solid #eee;">Име</td><td style="border-bottom:1px solid #eee;">${escapeHtml(name)}</td></tr>
        <tr><td style="color:#666;border-bottom:1px solid #eee;">Ресторант</td><td style="border-bottom:1px solid #eee;">${escapeHtml(restaurant)}</td></tr>
        <tr><td style="color:#666;border-bottom:1px solid #eee;">Email</td><td style="border-bottom:1px solid #eee;">${escapeHtml(email)}</td></tr>
        <tr><td style="color:#666;border-bottom:1px solid #eee;">Текущо меню/сайт</td><td style="border-bottom:1px solid #eee;">${escapeHtml(currentMenuUrl || "—")}</td></tr>
        <tr><td style="color:#666;border-bottom:1px solid #eee;">Предпочитан стил</td><td style="border-bottom:1px solid #eee;">${escapeHtml(preferredStyle || "—")}</td></tr>
      </table>
      ${message ? `<p><strong>Съобщение:</strong><br/>${escapeHtml(message)}</p>` : ""}
    </div>
  `;

  const { error } = await resend.emails.send({
    from: "MenuFrame Studio <onboarding@resend.dev>",
    to,
    subject: `Ново запитване (VALIO): ${restaurant}`,
    html,
  });
  // The Resend SDK resolves with { data, error } instead of throwing on
  // API-level failures (invalid key, unverified domain, etc.) — without
  // this check, a rejected send looks identical to a successful one to
  // Promise.allSettled, and the failure never gets logged.
  if (error) throw new Error(`Resend API error: ${error.message || JSON.stringify(error)}`);
}

async function appendSheetRow({ name, restaurant, email, currentMenuUrl, preferredStyle, message }) {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

  if (!clientEmail || !privateKey || !spreadsheetId) {
    console.warn("[sheets] Google Sheets env vars not set — skipping.");
    return;
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    // .env stores the key with literal "\n" sequences; convert them to
    // real newlines, otherwise the PEM key fails to parse.
    key: privateKey.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  // Same spreadsheet + column layout (A:I) as the main MenuFrame Studio
  // product's inquiries sheet, so both sources land in one shared table:
  // Дата | Заведение | Контакт | Email | Текущо меню/сайт | Предпочитан
  // стил | Съобщение | Статус | id. This form has no DB-backed inquiry id,
  // so that column is left blank.
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "A:I",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          new Date().toLocaleString("bg-BG", {
            timeZone: "Europe/Sofia",
            dateStyle: "short",
            timeStyle: "short",
          }),
          sanitizeForSheets(restaurant),
          sanitizeForSheets(name),
          sanitizeForSheets(email),
          sanitizeForSheets(currentMenuUrl || ""),
          sanitizeForSheets(preferredStyle || ""),
          sanitizeForSheets(message || ""),
          "Ново",
          "",
        ],
      ],
    },
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
  if (isRateLimited(ip)) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  const { data, error } = validateAndNormalize(req.body || {});
  if (error) {
    res.status(400).json({ error });
    return;
  }

  const failures = [];

  const results = await Promise.allSettled([sendNotificationEmail(data), appendSheetRow(data)]);
  if (results[0].status === "rejected") {
    console.error("[email] Failed to send inquiry notification:", results[0].reason);
    failures.push("email");
  }
  if (results[1].status === "rejected") {
    console.error("[sheets] Failed to append inquiry row:", results[1].reason);
    failures.push("sheets");
  }

  if (failures.length === 2) {
    res.status(502).json({ error: "Failed to deliver inquiry" });
    return;
  }

  res.status(200).json({ ok: true });
};
