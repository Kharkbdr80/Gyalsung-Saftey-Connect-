import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import Database from "better-sqlite3";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize SQLite for storing Google tokens
const sqlite = new Database("data.db");
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS google_tokens (
    user_id TEXT PRIMARY KEY,
    access_token TEXT,
    refresh_token TEXT,
    expiry_date INTEGER,
    spreadsheet_id TEXT,
    auto_sync INTEGER DEFAULT 0
  )
`);

// Migration: Ensure columns exist if table was created with an older schema
try {
  sqlite.exec("ALTER TABLE google_tokens ADD COLUMN auto_sync INTEGER DEFAULT 0");
} catch (e) {
  // Column already exists or other error we can ignore if it's just "duplicate column"
}

try {
  sqlite.exec("ALTER TABLE google_tokens ADD COLUMN spreadsheet_id TEXT");
} catch (e) {
  // Column already exists
}

const getRedirectUri = (req?: express.Request) => {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI.trim();
  
  // Try to use the current request host first as it's the most accurate
  if (req) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers.host;
    if (host) {
      return `${protocol}://${host}/api/auth/google/callback`;
    }
  }

  // Fallback to APP_URL from env
  if (process.env.APP_URL) {
    const url = process.env.APP_URL.trim().endsWith('/') ? process.env.APP_URL.trim().slice(0, -1) : process.env.APP_URL.trim();
    return `${url}/api/auth/google/callback`;
  }

  return "http://localhost:3000/api/auth/google/callback";
};

const getOAuthClient = (req?: express.Request) => {
  const clientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
  
  if (!clientId || !clientSecret) {
    throw new Error("Google credentials not configured");
  }
  
  return new OAuth2Client(
    clientId,
    clientSecret,
    getRedirectUri(req)
  );
};

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use(cookieParser());

  // API Routes
  app.get("/api/health", (req, res) => {
    const googleConfigured = !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
    const currentRedirectUri = getRedirectUri(req);
    
    res.json({ 
      status: "ok", 
      time: new Date().toISOString(),
      googleConfigured,
      redirectUri: currentRedirectUri
    });
  });

  // Google OAuth Routes
  app.get("/api/auth/google/url", (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: "User ID required" });

    try {
      const redirectUri = getRedirectUri(req);
      const client = getOAuthClient(req);
      console.log(`Generating Auth URL with redirect_uri: ${redirectUri}`);

      const url = client.generateAuthUrl({
        access_type: "offline",
        scope: [
          "https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/drive.file"
        ],
        state: userId,
        prompt: "consent",
        redirect_uri: redirectUri
      });
      res.json({ url });
    } catch (error) {
      console.error("Auth URL error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to generate auth URL" });
    }
  });

  app.get("/api/auth/google/callback", async (req, res) => {
    const { code, state: userId } = req.query;
    if (!code || !userId) return res.status(400).send("Missing code or state");

    const redirectUri = getRedirectUri(req);
    const client = getOAuthClient(req);
    console.log(`Handling Callback with redirect_uri: ${redirectUri}`);

    try {
      const { tokens } = await client.getToken({
        code: code as string,
        redirect_uri: redirectUri
      });
      
      const upsert = sqlite.prepare(`
        INSERT INTO google_tokens (user_id, access_token, refresh_token, expiry_date, auto_sync)
        VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(user_id) DO UPDATE SET
          access_token = excluded.access_token,
          refresh_token = COALESCE(excluded.refresh_token, google_tokens.refresh_token),
          expiry_date = excluded.expiry_date,
          auto_sync = 1
      `);
      
      upsert.run(
        userId as string,
        tokens.access_token,
        tokens.refresh_token || null,
        tokens.expiry_date
      );

      res.send(`
        <html>
          <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc;">
            <div style="text-align: center; padding: 2rem; background: white; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);">
              <h1 style="color: #059669; margin-bottom: 0.5rem;">Authentication Successful!</h1>
              <p style="color: #475569;">You can close this window now. Your data will now sync automatically.</p>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS' }, '*');
                  setTimeout(() => window.close(), 2000);
                }
              </script>
            </div>
          </body>
        </html>
      `);
    } catch (error) {
      console.error("Google OAuth Error:", error);
      res.status(500).send("Authentication failed: " + (error as Error).message);
    }
  });

  app.get("/api/auth/google/status", (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: "User ID required" });

    const token: any = sqlite.prepare("SELECT user_id, auto_sync FROM google_tokens WHERE user_id = ?").get(userId);
    res.json({ 
      connected: !!token,
      autoSync: token ? !!token.auto_sync : false
    });
  });

  app.patch("/api/auth/google/settings", (req, res) => {
    const { userId, autoSync } = req.body;
    if (!userId) return res.status(400).json({ error: "User ID required" });

    sqlite.prepare("UPDATE google_tokens SET auto_sync = ? WHERE user_id = ?").run(autoSync ? 1 : 0, userId);
    res.json({ success: true });
  });

  app.delete("/api/auth/google/disconnect", (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: "User ID required" });

    sqlite.prepare("DELETE FROM google_tokens WHERE user_id = ?").run(userId);
    res.json({ success: true });
  });

  app.post("/api/incidents/sync", async (req, res) => {
    const { userId, incident } = req.body;
    if (!userId || !incident) return res.status(400).json({ error: "Missing data" });

    const tokenData: any = sqlite.prepare("SELECT * FROM google_tokens WHERE user_id = ?").get(userId);
    if (!tokenData || !tokenData.auto_sync) return res.json({ success: false, message: "Auto-sync disabled" });

    try {
      const client = getOAuthClient(req);
      client.setCredentials({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expiry_date: tokenData.expiry_date
      });

      // Refresh token listener
      client.on('tokens', (tokens) => {
        if (tokens.refresh_token) {
          sqlite.prepare("UPDATE google_tokens SET refresh_token = ? WHERE user_id = ?").run(tokens.refresh_token, userId);
        }
        sqlite.prepare("UPDATE google_tokens SET access_token = ?, expiry_date = ? WHERE user_id = ?").run(tokens.access_token, tokens.expiry_date, userId);
      });

      const sheets = google.sheets({ version: "v4", auth: client });
      let spreadsheetId = tokenData.spreadsheet_id;

      if (!spreadsheetId) {
        // Create a new "Safety Log" spreadsheet
        const spreadsheet = await sheets.spreadsheets.create({
          requestBody: {
            properties: {
              title: `Gyalsung Safety Log`
            }
          }
        });
        spreadsheetId = spreadsheet.data.spreadsheetId;
        sqlite.prepare("UPDATE google_tokens SET spreadsheet_id = ? WHERE user_id = ?").run(spreadsheetId, userId);
        
        // Add header row
        const header = ["ID", "Type", "Severity", "Status", "Academy", "Location", "Date", "Description", "GA Rec", "GHQ Rec"];
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: "Sheet1!A1",
          valueInputOption: "RAW",
          requestBody: { values: [header] }
        });
      }

      // Append the incident
      const row = [
        incident.id,
        incident.type,
        incident.severity,
        incident.status,
        incident.academy_name || incident.academy_id,
        incident.location,
        incident.created_at ? new Date(incident.created_at.seconds * 1000).toLocaleString() : new Date().toLocaleString(),
        incident.description,
        incident.ga_recommendation || "",
        incident.ghq_recommendation || ""
      ];

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "Sheet1!A1",
        valueInputOption: "RAW",
        requestBody: { values: [row] }
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Sync Error:", error);
      res.status(500).json({ error: "Sync failed" });
    }
  });

  app.post("/api/incidents/sync-all", async (req, res) => {
    const { userId, incidents } = req.body;
    if (!userId || !incidents) return res.status(400).json({ error: "Missing data" });

    const tokenData: any = sqlite.prepare("SELECT * FROM google_tokens WHERE user_id = ?").get(userId);
    if (!tokenData) return res.status(401).json({ error: "Not connected to Google" });

    try {
      const client = getOAuthClient(req);
      client.setCredentials({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expiry_date: tokenData.expiry_date
      });

      // Refresh token listener
      client.on('tokens', (tokens) => {
        if (tokens.refresh_token) {
          sqlite.prepare("UPDATE google_tokens SET refresh_token = ? WHERE user_id = ?").run(tokens.refresh_token, userId);
        }
        sqlite.prepare("UPDATE google_tokens SET access_token = ?, expiry_date = ? WHERE user_id = ?").run(tokens.access_token, tokens.expiry_date, userId);
      });

      const sheets = google.sheets({ version: "v4", auth: client });
      let spreadsheetId = tokenData.spreadsheet_id;

      if (!spreadsheetId) {
        const spreadsheet = await sheets.spreadsheets.create({
          requestBody: {
            properties: {
              title: `Gyalsung Safety Log`
            }
          }
        });
        spreadsheetId = spreadsheet.data.spreadsheetId;
        sqlite.prepare("UPDATE google_tokens SET spreadsheet_id = ? WHERE user_id = ?").run(spreadsheetId, userId);
      }

      // Prepare rows
      const header = ["ID", "Type", "Severity", "Status", "Academy", "Location", "Date", "Description", "GA Rec", "GHQ Rec"];
      const rows = incidents.map((incident: any) => [
        incident.id,
        incident.type,
        incident.severity,
        incident.status,
        incident.academy_name || incident.academy_id,
        incident.location,
        incident.created_at ? new Date(incident.created_at.seconds * 1000).toLocaleString() : new Date().toLocaleString(),
        incident.description,
        incident.ga_recommendation || "",
        incident.ghq_recommendation || ""
      ]);

      // Overwrite/Update the sheet
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "Sheet1!A1",
        valueInputOption: "RAW",
        requestBody: { values: [header, ...rows] }
      });

      res.json({ success: true, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}` });
    } catch (error) {
      console.error("Sync All Error:", error);
      res.status(500).json({ error: "Sync all failed" });
    }
  });

  app.post("/api/incidents/export", async (req, res) => {
    const { userId, incidents } = req.body;
    if (!userId || !incidents) return res.status(400).json({ error: "Missing data" });

    const tokenData: any = sqlite.prepare("SELECT * FROM google_tokens WHERE user_id = ?").get(userId);
    if (!tokenData) return res.status(401).json({ error: "Not connected to Google" });

    try {
      const client = getOAuthClient(req);
      client.setCredentials({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expiry_date: tokenData.expiry_date
      });

      // Refresh token listener
      client.on('tokens', (tokens) => {
        if (tokens.refresh_token) {
          sqlite.prepare("UPDATE google_tokens SET refresh_token = ? WHERE user_id = ?").run(tokens.refresh_token, userId);
        }
        sqlite.prepare("UPDATE google_tokens SET access_token = ?, expiry_date = ? WHERE user_id = ?").run(tokens.access_token, tokens.expiry_date, userId);
      });

      const sheets = google.sheets({ version: "v4", auth: client });
      
      // Create a new spreadsheet
      const spreadsheet = await sheets.spreadsheets.create({
        requestBody: {
          properties: {
            title: `Gyalsung Safety Incidents Export - ${new Date().toLocaleDateString()}`
          }
        }
      });

      const spreadsheetId = spreadsheet.data.spreadsheetId;
      if (!spreadsheetId) throw new Error("Failed to create spreadsheet");

      // Prepare data
      const header = ["ID", "Type", "Severity", "Status", "Academy", "Location", "Date", "Description", "GA Rec", "GHQ Rec"];
      const rows = incidents.map((inc: any) => [
        inc.id,
        inc.type,
        inc.severity,
        inc.status,
        inc.academy_name || inc.academy_id,
        inc.location,
        inc.created_at ? new Date(inc.created_at.seconds * 1000).toLocaleString() : "N/A",
        inc.description,
        inc.ga_recommendation || "",
        inc.ghq_recommendation || ""
      ]);

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "Sheet1!A1",
        valueInputOption: "RAW",
        requestBody: {
          values: [header, ...rows]
        }
      });

      res.json({ success: true, url: spreadsheet.data.spreadsheetUrl });
    } catch (error) {
      console.error("Export Error:", error);
      res.status(500).json({ error: "Export failed" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const PORT = 3000;
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
