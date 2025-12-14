// cleanup.js
const db = require('./db');
const THRESHOLD_DAYS = 7; // 保留 7 天内的数据
const cutoff = Date.now() - THRESHOLD_DAYS * 24 * 3600 * 1000;

db.serialize(() => {
  console.log('🧹 清理 7 天前的数据...');
  db.run(`DELETE FROM coins WHERE timestamp < ?`, [cutoff], function (err) {
    if (err) return console.error('清理失败:', err.message);
    console.log(`✅ 已删除 ${this.changes} 条旧记录`);
    db.run('VACUUM;', () => {
      console.log('✅ 数据库已压缩整理完成');
      process.exit(0);
    });
  });
});
