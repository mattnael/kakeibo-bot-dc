const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const volumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH;
if (volumePath && !fs.existsSync(volumePath)) {
    fs.mkdirSync(volumePath, { recursive: true });
}

const dbPath = volumePath ? path.join(volumePath, 'kakeibo.db') : path.join(__dirname, 'kakeibo.db');
console.log('📍 Lokasi Database Aktif:', dbPath);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// 1. Buat Tabel Jika Belum Ada
db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        guild_id TEXT,
        type TEXT NOT NULL,
        pillar TEXT,
        item TEXT,
        amount INTEGER NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS budgets (
        user_id TEXT PRIMARY KEY,
        monthly_income INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS item_limits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        pillar TEXT,
        item TEXT,
        limit_amount INTEGER,
        UNIQUE(user_id, pillar, item)
    );

    CREATE TABLE IF NOT EXISTS custom_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        pillar TEXT,
        item_name TEXT,
        UNIQUE(user_id, pillar, item_name)
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

// 2. PERBAIKAN OTOMATIS: Deteksi dan hapus kolom 'category' lama jika masih tersisa
try {
    const columns = db.prepare("PRAGMA table_info(transactions)").all();
    const hasCategory = columns.some(col => col.name === 'category');
    if (hasCategory) {
        db.exec("ALTER TABLE transactions DROP COLUMN category;");
        console.log('✅ Kolom category lama berhasil dibuang!');
    }
} catch (err) {
    db.exec("DROP TABLE IF EXISTS transactions;");
    db.exec(`
        CREATE TABLE transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            guild_id TEXT,
            type TEXT NOT NULL,
            pillar TEXT,
            item TEXT,
            amount INTEGER NOT NULL,
            description TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    console.log('🔄 Tabel transactions berhasil di-reset!');
}

module.exports = db;