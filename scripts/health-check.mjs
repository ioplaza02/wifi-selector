// 健全性チェック：scrape.mjs の結果を、更新前の products.json と比べて確認する
// 使い方： node scripts/health-check.mjs <更新前のproducts.jsonのパス>
// 問題なし → 終了コード0（そのまま本番に反映）
// 問題あり → 終了コード1、data/health-report.md に知らせる内容を書く（PRとIssueを作る）

import { readFile, writeFile } from 'node:fs/promises';

const prevPath = process.argv[2];
const cur = JSON.parse(await readFile(new URL('../data/products.json', import.meta.url), 'utf8'));
const prev = prevPath ? JSON.parse(await readFile(prevPath, 'utf8')) : cur;
let report = { changes: [], anomalies: [], newModels: [] };
try { report = JSON.parse(await readFile(new URL('../data/scrape-report.json', import.meta.url), 'utf8')); } catch { /* なし */ }

const problems = [];
const curCount = cur.products.filter(p => p.status === 'current').length;
const prevCount = prev.products.filter(p => p.status === 'current').length;

if (curCount === 0) problems.push('販売中の商品が0件になりました。公式サイトの構成が変わった可能性があります。');
else if (prevCount > 0 && curCount < prevCount * 0.9) problems.push(`販売中の商品が ${prevCount} 件 → ${curCount} 件に減りました（1割以上の減少）。`);

for (const n of report.newModels || []) {
  problems.push(`新しい型番が見つかりました：**${n.model}**（${n.url}）。仕様を確認して data/products.json に追加してください。`);
}
for (const a of report.anomalies || []) problems.push(`要確認：${a}`);

// IPv6で「対応」→「×」に変わったものは念のため人が確認する
for (const c of report.changes || []) {
  if (c.field !== 'ipv6' || !c.before || !c.after) continue;
  for (const k of Object.keys(c.after)) {
    const was = c.before[k], now = c.after[k];
    if ((was === 'ok' || was === 'ok*' || was === 'plan') && now === 'no') {
      problems.push(`IPv6：${c.model} の ${k} が「${was}」→「×」に変わりました。表の列がずれていないか確認してください。`);
    }
  }
}

const lines = [];
lines.push(`# Wi-Fiセレクター 自動更新の確認（${cur.updatedAt}）`, '');
lines.push(`販売中：${prevCount} 件 → ${curCount} 件`, '');
if (problems.length) {
  lines.push('## 確認が必要なこと', '', ...problems.map(p => `- ${p}`), '');
}
if ((report.changes || []).length) {
  lines.push('## 今回の変更', '', ...report.changes.map(c => `- ${c.model}｜${c.field}：${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`), '');
}
await writeFile(new URL('../data/health-report.md', import.meta.url), lines.join('\n') + '\n');
console.log(lines.join('\n'));
process.exit(problems.length ? 1 : 0);
