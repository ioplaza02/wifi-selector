// Wi-Fiセレクター 商品データ自動更新スクリプト
//
// 方針：
//  ・仕様（○×の判定に使う値）は data/products.json に手でまとめた内容を正とする
//    （仕様表の文言から○×を機械判定すると誤判定しやすいため）
//  ・このスクリプトが自動で更新するのは「変わりやすい情報」だけ
//      - 販売中／生産終了（公式の一覧ページに載っているか、商品ページの「生産終了」表記）
//      - JANコード、価格（税込・税抜）、商品画像の有無
//      - IPv6（IPoE）対応状況（公式の対応表）
//  ・一覧ページに新しい型番が出てきたら data/scrape-report.json に記録し、
//    健全性チェック（health-check.mjs）で人に知らせる（自動では追加しない）
//
// 外部ライブラリなし（Node.js 18以上の fetch のみ）。1件ずつ2秒間隔でアクセスする。

import { readFile, writeFile } from 'node:fs/promises';

const BASE = 'https://www.iodata.jp';
const UA = 'WifiSelectorBot/1.0 (+https://ioplaza02.github.io/wifi-selector/)';
const WAIT_MS = +(process.env.SCRAPE_WAIT_MS || 2000);
const DATA_PATH = new URL('../data/products.json', import.meta.url);
const REPORT_PATH = new URL('../data/scrape-report.json', import.meta.url);

// 現行品の一覧ページ（ここに載っている型番＝販売中）
const LIST_PAGES = [
  { url: `${BASE}/product/network/wnlan/`, category: 'router' },
  { url: `${BASE}/product/network/biznw/`, category: 'ap' },
  { url: `${BASE}/product/tsushin/m2m/`, category: 'lte' }
];
// 対象にする型番（オプション品 UD-ANT2／UD-DIN などは対象外）
const MODEL_RE = /^(wn-[a-z0-9]+|whg-[a-z0-9]+|ud-lt[a-z0-9]*|ud-usc[a-z0-9]*)$/i;
// 法人向けネットワークのページにはスイッチ等も載っているため、APはwhg-のみ拾う
const CATEGORY_PREFIX = { router: /^wn-/i, ap: /^whg-/i, lte: /^ud-/i };

const IPV6_URL = `${BASE}/pio/io/network/ipv6.htm`;
// 対応表の列の並び（2026年9月時点）。見出しの文言で並びが変わっていないか確認してから使う
const IPV6_COLUMNS = ['v6plus', 'v6plus_fixed', 'transix', 'transix_fixed', 'ipv6option', 'ocnvc', 'xpass', 'v6connect', 'v6connect_fixed', 'ocx'];
const IPV6_HEADER_ORDER = ['v6プラス', 'transix', 'IPv6', 'OCN', 'クロスパス', 'v6', 'OCX'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = { startedAt: new Date().toISOString(), changes: [], anomalies: [], newModels: [], counts: {} };

async function get(url) {
  await sleep(WAIT_MS);
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja' }, redirect: 'follow' });
  if (!res.ok) { const e = new Error(`HTTP ${res.status} ${url}`); e.status = res.status; throw e; }
  const buf = Buffer.from(await res.arrayBuffer());
  // iodata.jp は UTF-8 / Shift_JIS が混在しているため、metaのcharsetを見て切り替える
  const head = buf.subarray(0, 2048).toString('latin1');
  const m = head.match(/charset=["']?([\w-]+)/i);
  const enc = m && /shift_jis|sjis|x-sjis/i.test(m[1]) ? 'shift_jis' : 'utf-8';
  return new TextDecoder(enc).decode(buf);
}

// HTMLの文字参照（&times; &#215; &#xD7; など）を文字に戻す
const NAMED_ENTITIES = {
  nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  yen: '￥', times: '×', divide: '÷', minus: '−', ndash: '–', mdash: '—', hellip: '…', middot: '・',
  circ: '○', cir: '○', bull: '•', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™', deg: '°',
  plusmn: '±', check: '✓', cross: '✗', rarr: '→', larr: '←', uarr: '↑', darr: '↓', sup2: '²', sup3: '³'
};
export const decodeEntities = s => s
  .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);?/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&([a-z][a-z0-9]*);/gi, (m, name) => NAMED_ENTITIES[name] ?? NAMED_ENTITIES[name.toLowerCase()] ?? m);

export const toText = html => decodeEntities(html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, ' '))
  .replace(/[ \t\r\f\v\u00A0]+/g, ' ')
  .replace(/\n\s+/g, '\n')
  .trim();

// 一覧ページから型番とURLを拾う
export function parseListPage(html, category, pageUrl = BASE + '/') {
  const found = new Map();
  const re = /href=["']((?:[^"']*\/)?([a-z0-9-]+)\/(?:index\.htm)?)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[2].toLowerCase();
    if (!MODEL_RE.test(slug) || !CATEGORY_PREFIX[category].test(slug)) continue;
    let href = m[1];
    if (!/index\.htm$/.test(href)) href = href.replace(/\/?$/, '/index.htm');
    const url = new URL(href, pageUrl).href;
    if (!/\/product\//.test(url)) continue;
    found.set(slug.toUpperCase(), url);
  }
  return found;
}

// 商品ページからJAN・価格・生産終了を読む
export function parseProductPage(html, model) {
  const text = toText(html);
  const out = {};
  // JANコード（当社は4957180から始まる）。型番の近くを優先する
  const jans = [...text.matchAll(/(4957180\d{6})/g)].map(x => x[1]);
  if (jans.length) {
    const near = text.indexOf(model);
    out.jan = near >= 0
      ? jans.map(j => ({ j, d: Math.abs(text.indexOf(j) - near) })).sort((a, b) => a.d - b.d)[0].j
      : jans[0];
  }
  // 生産終了日（例：2025/4/1生産終了）
  const dis = text.match(/(\d{4}\/\d{1,2}\/\d{1,2})\s*生産終了/);
  if (dis) out.discontinuedDate = dis[1];
  else if (/生産終了品|生産終了しました/.test(text)) out.discontinuedFlag = true;
  // 価格
  if (/オープン価格/.test(text) && !/￥\s?[\d,]+\s*[（(]?\s*税込/.test(text)) {
    out.price = null;
  } else {
    const p = text.match(/￥\s?([\d,]+)\s*[（(]\s*税抜\s*￥\s?([\d,]+)\s*[）)]/) ||
              text.match(/([\d,]+)\s*円\s*[（(]\s*税抜\s*([\d,]+)\s*円\s*[）)]/);
    if (p) out.price = { taxIn: +p[1].replace(/,/g, ''), taxEx: +p[2].replace(/,/g, '') };
  }
  return out;
}

// 表のHTMLを、セルの文字列の配列（行ごと）にする。colspanは展開する
export function parseTableRows(tableHtml) {
  const rows = [];
  const trRe = /<tr[\s\S]*?<\/tr>/gi;
  let tr;
  while ((tr = trRe.exec(tableHtml))) {
    const cells = [];
    const cRe = /<t([hd])([^>]*)>([\s\S]*?)<\/t\1>/gi;
    let c;
    while ((c = cRe.exec(tr[0]))) {
      const span = +(c[2].match(/colspan=["']?(\d+)/i) || [0, 1])[1];
      const t = toText(c[3]).replace(/\s+/g, '');
      for (let i = 0; i < span; i++) cells.push(t);
    }
    rows.push(cells);
  }
  return rows;
}

export function ipv6Symbol(cell) {
  const c = String(cell).trim();
  if (/対応予定|後日対応/.test(c)) return 'plan';
  // 〇 は環境によって ○ ◯ ⭕ などの別の文字のこともある
  if (/^[〇○◯⭕◎]/.test(c)) return /※\s*3/.test(c) ? 'ok*' : 'ok';
  // × も × ✕ ✖ ✗ ✘ ╳ ｘ Ｘ x X などの別の文字のことがある。「－」「-」「非対応」も×扱い
  if (/^[\u00D7\u2715\u2716\u2717\u2718\u2573\u2A2F\u274C\uFF58\uFF38xX]/.test(c)) return 'no';
  if (/^[-\u2010-\u2015\u2212\uFF0D\u30FC]$/.test(c) || /非対応|未対応/.test(c)) return 'no';
  return null;
}

// IPv6対応表を読む。戻り値 { asOf, models: { 'WN-7T94XR': {v6plus:'ok', ...} } }
export function parseIpv6Page(html) {
  const text = toText(html);
  const asOf = (text.match(/(\d{4}年\d{1,2}月\d{1,2}日)\s*現在/) || [])[1] || null;
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  const table = tables.find(t => /WN-[A-Z0-9]/i.test(t) && /v6プラス/.test(t) && /transix/.test(t));
  if (!table) return { asOf, models: {}, error: '対応表（型番とv6プラス・transixを含む表）が見つかりません' };

  // 見出しの並びが想定どおりか確認（列がずれていたら更新しない）
  const headText = toText(table.split(/WN-[A-Z0-9]/i)[0]).replace(/\s+/g, '');
  let pos = -1;
  for (const word of IPV6_HEADER_ORDER) {
    const i = headText.indexOf(word, pos + 1);
    if (i < 0) return { asOf, models: {}, error: `見出しに「${word}」が見つからないか、並びが変わっています` };
    pos = i;
  }

  const models = {};
  for (const cells of parseTableRows(table)) {
    const idx = cells.findIndex(c => /^(WN|WHG|UD)-[A-Z0-9/-]+$/i.test(c));
    if (idx < 0) continue;
    const model = cells[idx].toUpperCase();
    const vals = cells.slice(idx + 1);
    if (vals.length !== IPV6_COLUMNS.length) {
      models[model] = { error: `列の数が${vals.length}（想定${IPV6_COLUMNS.length}）` };
      continue;
    }
    const row = {};
    let bad = false;
    IPV6_COLUMNS.forEach((k, i) => { const s = ipv6Symbol(vals[i]); if (!s) bad = true; row[k] = s; });
    models[model] = bad ? { error: `読めない記号があります：${vals.map(v => ipv6Symbol(v) ? v : `${v}［${[...v].slice(0, 2).map(ch => 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ')}］`).join(' | ')}` } : row;
  }
  return { asOf, models };
}

function jstToday() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function change(model, field, before, after) {
  if (JSON.stringify(before) === JSON.stringify(after)) return false;
  report.changes.push({ model, field, before, after });
  return true;
}

export async function main() {
  const data = JSON.parse(await readFile(DATA_PATH, 'utf8'));
  const products = data.products;
  const known = new Set(products.flatMap(p => [p.model, ...(p.variants || []).map(v => v.model)]));

  // 1) 一覧ページ → 現行品の型番
  const listed = new Map();
  let listOk = true;
  for (const lp of LIST_PAGES) {
    try {
      const html = await get(lp.url);
      const found = parseListPage(html, lp.category, lp.url);
      report.counts[lp.category] = found.size;
      if (found.size === 0) { listOk = false; report.anomalies.push(`一覧ページから型番を1件も読み取れませんでした：${lp.url}`); }
      for (const [model, url] of found) listed.set(model, { url, category: lp.category });
    } catch (e) {
      listOk = false;
      report.anomalies.push(`一覧ページを取得できませんでした：${e.message}`);
    }
  }
  for (const [model, info] of listed) {
    if (!known.has(model)) report.newModels.push({ model, category: info.category, url: info.url });
  }

  // 2) 商品ごとのページ
  for (const p of products) {
    let page = {};
    try {
      page = parseProductPage(await get(p.url), p.model);
    } catch (e) {
      if (e.status === 404) page = { notFound: true };
      else { report.anomalies.push(`${p.model}：商品ページを取得できませんでした（${e.message}）`); continue; }
    }
    // 販売状況：一覧に載っていれば販売中。載っていなければ生産終了（一覧の取得に失敗したときは変えない）
    if (listOk) {
      const isListed = listed.has(p.model) || (p.variants || []).some(v => listed.has(v.model));
      const status = isListed && !page.discontinuedDate ? 'current' : 'discontinued';
      if (change(p.model, 'status', p.status, status)) p.status = status;
    }
    if (page.discontinuedDate && change(p.model, 'discontinuedDate', p.discontinuedDate, page.discontinuedDate)) p.discontinuedDate = page.discontinuedDate;
    if (page.jan && !p.variants && change(p.model, 'jan', p.jan, page.jan)) p.jan = page.jan;
    if (page.price !== undefined && p.status === 'current' && change(p.model, 'price', p.price, page.price)) p.price = page.price;
    if (listed.has(p.model) && listed.get(p.model).url !== p.url && !page.notFound) {
      // URLの移動は報告だけにとどめる（誤検知でリンク切れにしないため）
      report.anomalies.push(`${p.model}：一覧ページのリンク先が変わっています（${listed.get(p.model).url}）。確認してください`);
    }
    if (page.notFound && p.status === 'current') report.anomalies.push(`${p.model}：商品ページが見つかりません（404）`);
  }

  // 3) IPv6対応表
  try {
    const v6 = parseIpv6Page(await get(IPV6_URL));
    if (v6.error) report.anomalies.push(`IPv6対応表：${v6.error}（IPv6のデータは更新していません）`);
    else {
      if (v6.asOf && data.sources) data.sources.ipv6AsOf = `${v6.asOf}現在`;
      for (const p of products) {
        if (!p.ipv6) continue;
        const row = v6.models[p.model];
        if (!row) { if (p.status === 'current') report.anomalies.push(`IPv6対応表に ${p.model} が見つかりません`); continue; }
        if (row.error) { report.anomalies.push(`IPv6対応表 ${p.model}：${row.error}`); continue; }
        if (change(p.model, 'ipv6', p.ipv6, row)) p.ipv6 = row;
      }
    }
  } catch (e) {
    report.anomalies.push(`IPv6対応表を取得できませんでした：${e.message}`);
  }

  data.updatedAt = jstToday();
  report.finishedAt = new Date().toISOString();
  report.currentCount = products.filter(p => p.status === 'current').length;
  await writeFile(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  console.log(`完了：変更 ${report.changes.length} 件／要確認 ${report.anomalies.length} 件／新しい型番 ${report.newModels.length} 件`);
  report.changes.forEach(c => console.log(`  変更 ${c.model} ${c.field}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`));
  report.anomalies.forEach(a => console.log(`  要確認 ${a}`));
  report.newModels.forEach(n => console.log(`  新しい型番 ${n.model}（${n.url}）`));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error(e); process.exit(1); });
}
