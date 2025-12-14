// db.js
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'coins.db');
const db = new sqlite3.Database(dbPath);

// 初始化表结构
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS coins (
      symbol TEXT PRIMARY KEY,
      name TEXT,
      price REAL,
      change24h REAL,
      fundingRate REAL,
      market_cap REAL,
      fdv REAL,
      timestamp INTEGER
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_market_cap ON coins(market_cap)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_fdv ON coins(fdv)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_price ON coins(price)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_fundingRate ON coins(fundingRate)`);

  console.log('✅ SQLite initialized at:', dbPath);
});

module.exports = db;
