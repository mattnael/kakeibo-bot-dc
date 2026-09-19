const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const volumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH;
if (volumePath && !fs.existsSync(volumePath)) {
    fs.mkdirSync(volumePath, { recursive: true });
}

const dbPath = volumePath ? path.join(volumePath, 'kakeibo.db') : path.join(__dirname, 'kakeibo.db');
const db = new Database(dbPath);

// Inisialisasi Seluruh Tabel
db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        guild_id TEXT,
        type TEXT NOT NULL,
        category TEXT NOT NULL,
        amount INTEGER NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS budgets (
        user_id TEXT PRIMARY KEY,
        wants_limit INTEGER DEFAULT 0,
        monthly_income INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
        guild_id TEXT PRIMARY KEY,
        recap_weekly_channel_id TEXT,
        recap_weekly_day INTEGER DEFAULT 0,
        recap_weekly_time TEXT DEFAULT '23:59',
        recap_monthly_channel_id TEXT,
        recap_monthly_date INTEGER DEFAULT 1,
        recap_monthly_time TEXT DEFAULT '08:00',
        timezone TEXT DEFAULT 'Asia/Jakarta'
    );
`);

// Migrasi Otomatis (Tambah kolom timezone)
try {
    const columns = db.prepare(`PRAGMA table_info(settings)`).all().map(c => c.name);
    if (!columns.includes('recap_weekly_channel_id')) db.exec(`ALTER TABLE settings ADD COLUMN recap_weekly_channel_id TEXT;`);
    if (!columns.includes('recap_monthly_channel_id')) db.exec(`ALTER TABLE settings ADD COLUMN recap_monthly_channel_id TEXT;`);
    if (!columns.includes('timezone')) db.exec(`ALTER TABLE settings ADD COLUMN timezone TEXT DEFAULT 'Asia/Jakarta';`);
} catch (err) {
    console.error('Error migrasi database:', err.message);
}

module.exports = db;