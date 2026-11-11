/* Wi-Fiセレクター（I-O DATA Wi-Fiルーター・アクセスポイント・LTEルーター）
 * 素のJavaScriptのみ。data/products.json を読み込んで左サイドバーの条件で絞り込む。
 */
(() => {
  'use strict';

  // 簡易的な鍵（GitHub Pagesの静的配信のため本物のセキュリティではない）
  const SITE_PASSWORD = 'wifi2026';
  const GATE_KEY = 'wifiSelectorGate';
  const STALE_DAYS = 40;

  // ---------- 表示用の定義 ----------
  const CATEGORY_LABEL = { router: 'Wi-Fiルーター', ap: 'アクセスポイント', lte: 'LTEルーター' };
  const CATEGORY_BADGE = { router: 'b-router', ap: 'b-ap', lte: 'b-lte' };
  const WIFI_LABEL = { 7: 'Wi-Fi 7（IEEE802.11be）', 6: 'Wi-Fi 6（IEEE802.11ax）', 5: 'Wi-Fi 5（IEEE802.11ac）', 4: 'Wi-Fi 4（IEEE802.11n）' };
  const CARRIER_LABEL = { docomo: 'NTTドコモ', au: 'au（KDDI）', softbank: 'ソフトバンク', rakuten: '楽天モバイル' };

  const IPV6_SERVICES = [
    { key: 'v6plus', label: 'v6プラス', group: 'dynamic' },
    { key: 'transix', label: 'transix（DS-Lite）', group: 'dynamic' },
    { key: 'ipv6option', label: 'IPv6オプション', group: 'dynamic' },
    { key: 'ocnvc', label: 'OCNバーチャルコネクト', group: 'dynamic' },
    { key: 'xpass', label: 'クロスパス（Xpass）', group: 'dynamic' },
    { key: 'v6connect', label: 'v6コネクト（DS-Lite）', group: 'dynamic' },
    { key: 'v6plus_fixed', label: 'v6プラス 固定IPサービス', group: 'fixed' },
    { key: 'transix_fixed', label: 'transix（固定IP）', group: 'fixed' },
    { key: 'v6connect_fixed', label: 'v6コネクト（固定IP）', group: 'fixed' },
    { key: 'ocx', label: 'OCX光 インターネット（v6IX）', group: 'fixed' }
  ];
  const IPV6_LABEL = Object.fromEntries(IPV6_SERVICES.map(s => [s.key, s.label]));
  const ipv6Status = (p, key) => (p.ipv6 ? p.ipv6[key] || 'no' : null);
  const ipv6Usable = v => v === 'ok' || v === 'ok*' || v === 'plan';

  const isHome = p => p.category === 'router' || p.category === 'ap';
  const hasLte = p => !!p.lte;

  // ---------- 絞り込み条件の定義 ----------
  // scope: common = 共通 / home = 宅内用 / lte = LTEルーター
  // type: radio = 1つ選ぶ（'' は指定なし） / checks = 複数選択（すべて満たすもの）
  // guide: その条件だけで対象が0件になったときに出す案内
  const FILTER_GROUPS = [
    {
      id: 'g-env', scope: 'common', title: '設置環境・台数', open: true,
      items: [
        {
          key: 'place', label: '設置する場所', type: 'radio',
          options: [
            { value: 'indoor', label: '屋内', test: () => true },
            { value: 'outdoor', label: '屋外', test: () => false,
              guide: '当社のWi-Fiルーター・アクセスポイント・LTEルーターに、屋外設置に対応したモデルはありません。（UD-USC1は防塵・防水IP56相当ですが、屋外での使用を保証するものではありません）' }
          ]
        },
        {
          key: 'temp', label: '使用温度', type: 'radio',
          options: [
            { value: 'normal', label: '一般的な室内（0〜40℃）', test: p => p.tempMin <= 0 && p.tempMax >= 40 },
            { value: 'wide', label: '-20〜60℃が必要（工場・倉庫・設備内など）', test: p => p.tempMin <= -20 && p.tempMax >= 60 }
          ]
        },
        {
          key: 'devices', label: 'Wi-Fiでつなぐ機器の台数', type: 'radio',
          help: '推奨接続台数で判定します。推奨台数の記載がない商品は外れます。',
          options: [10, 20, 30, 40, 60, 100].map(n => ({
            value: String(n), label: `${n}台以上`, test: p => (p.recommendedDevices || 0) >= n,
            guide: `推奨接続台数が${n}台以上の商品はありません。台数が多い場合は、アクセスポイントを複数台に分けて設置する構成をご相談ください。`
          }))
        },
        {
          key: 'power', label: '電源の取り方', type: 'radio',
          options: [
            { value: 'ac', label: 'コンセント（ACアダプター）', test: p => p.power.includes('AC') },
            { value: 'poe', label: 'PoE（LANケーブルで給電）', test: p => p.poe,
              guide: 'PoE受電に対応しているのは、法人向けアクセスポイント（WHG-DAX1800A）のみです。' },
            { value: 'usb', label: 'USBバスパワー', test: p => p.power.includes('USB') }
          ]
        },
        {
          key: 'common', label: 'その他', type: 'checks',
          options: [
            { value: 'vpn', label: 'VPNサーバー機能（社外から拠点につなぐ）', test: p => p.vpnServer,
              guide: '宅内用のWi-Fiルーター・アクセスポイントにはVPNサーバー機能がありません。VPNが必要な場合は、LTEルーター（UD-LTA／UD-LT2。いずれも固定回線のWANでも使えます）をご確認ください。' },
            { value: 'w3', label: '保証期間 3年以上', test: p => p.warrantyYears >= 3 },
            { value: 'iss', label: '有償保守サービス（ISS）に対応', test: p => !!p.iss }
          ]
        }
      ]
    },
    {
      id: 'g-type', scope: 'home', title: '機器の種類', open: true,
      items: [
        {
          key: 'kind', label: '使い方', type: 'radio',
          options: [
            { value: 'router', label: 'Wi-Fiルーター（ルーター機能あり）', test: p => p.category === 'router' },
            { value: 'ap', label: 'アクセスポイント（既存のルーターにつなぐ法人向け）', test: p => p.category === 'ap' }
          ]
        }
      ]
    },
    {
      id: 'g-line', scope: 'home', title: '回線・IPv6', open: true,
      items: [
        {
          key: 'ipv6', label: 'IPv6（IPoE）のサービス名', type: 'radio',
          help: 'プロバイダーの契約書類や、プロバイダーのWebページで確認できます。',
          options: [
            ...IPV6_SERVICES.map((s, i) => ({
              value: s.key, label: s.label,
              sep: i === 0 ? '通常（動的IP）のサービス' : (s.key === 'v6plus_fixed' ? '固定IP・IPIP接続のサービス' : null),
              test: p => (p.category === 'ap' ? true : ipv6Usable(ipv6Status(p, s.key)))
            })),
            { value: 'unknown', label: 'わからない', test: () => true,
              sep: '—',
              tip: '現行のWi-Fiルーターは、通常（動的IP）のIPv6サービスすべてに対応しています。固定IPのサービスを使う場合は、サービス名を確認してから選んでください。' }
          ]
        },
        {
          key: 'wan', label: '回線の速度（インターネットポート）', type: 'radio',
          help: '契約している回線の最大速度に合わせて選びます。',
          options: [
            { value: '1', label: '1Gbps', test: p => (p.wanGbps || 0) >= 1 && p.category === 'router' },
            { value: '2.5', label: '2.5Gbps以上', test: p => (p.wanGbps || 0) >= 2.5 && p.category === 'router' },
            { value: '10', label: '10Gbps', test: p => (p.wanGbps || 0) >= 10 && p.category === 'router' }
          ]
        },
        {
          key: 'pppoe', label: 'PPPoE', type: 'checks',
          options: [
            { value: 'multi', label: 'PPPoEを2セッション以上使う（マルチセッション）', test: p => (p.pppoeSessions || 0) >= 2,
              guide: '当社のWi-Fiルーターは、いずれもPPPoEは1セッションのみの対応です（マルチセッションには対応していません）。' }
          ]
        }
      ]
    },
    {
      id: 'g-wifi', scope: 'home', title: 'Wi-Fi', open: false,
      items: [
        {
          key: 'wifi', label: 'Wi-Fi規格', type: 'radio',
          options: [
            { value: '7', label: 'Wi-Fi 7', test: p => (p.wifiGen || 0) >= 7 },
            { value: '6', label: 'Wi-Fi 6以上', test: p => (p.wifiGen || 0) >= 6 }
          ]
        },
        {
          key: 'wfeat', label: 'Wi-Fiの機能', type: 'checks',
          options: [
            { value: 'band6', label: '6GHz帯（トライバンド）', test: p => p.bands.includes('6') },
            { value: 'mlo', label: 'MLO（複数の周波数帯を同時に使う）', test: p => p.mlo },
            { value: 'mesh', label: 'メッシュ（親機になれる）', test: p => !!(p.mesh && p.mesh.parent) },
            { value: 'repeater', label: '中継機（リピーター）として使える', test: p => p.modes.repeater },
            { value: 'apmode', label: 'APモード（ブリッジ）で使える', test: p => p.modes.ap },
            { value: 'bandsteer', label: 'バンドステアリング', test: p => p.bandSteering },
            { value: 'multissid', label: 'マルチSSID', test: p => p.multiSsid },
            { value: 'guest', label: 'ゲスト用SSID（端末どうしを分離）', test: p => p.guestSeparate }
          ]
        }
      ]
    },
    {
      id: 'g-lan', scope: 'home', title: '有線LAN', open: false,
      items: [
        {
          key: 'lan', label: '有線LANポートの数', type: 'radio',
          options: [
            { value: '1', label: '1つ以上', test: p => p.lan.count >= 1 },
            { value: '2', label: '2つ以上', test: p => p.lan.count >= 2 },
            { value: '4', label: '4つ以上', test: p => p.lan.count >= 4 }
          ]
        },
        {
          key: 'lanspeed', label: 'LANポートの速度', type: 'checks',
          options: [
            { value: 'lan25', label: '2.5Gbps以上のLANポートがある', test: p => p.lan.maxGbps >= 2.5 },
            { value: 'lan10', label: '10GbpsのLANポートがある', test: p => p.lan.maxGbps >= 10 }
          ]
        }
      ]
    },
    {
      id: 'g-sec', scope: 'home', title: 'セキュリティ・法人向け機能', open: false,
      items: [
        {
          key: 'sec', label: '家庭・店舗向け', type: 'checks',
          options: [
            { value: 'netfilter', label: 'ネットフィルタリング（有害サイトのブロック）', test: p => p.netFilter },
            { value: 'parental', label: 'ペアレンタルコントロール（時間帯で制限）', test: p => p.parental }
          ]
        },
        {
          key: 'biz', label: '法人向け', type: 'checks',
          options: [
            { value: 'dot1x', label: 'IEEE802.1X／RADIUS認証（WPA3エンタープライズ）', test: p => p.enterpriseAuth },
            { value: 'vlan', label: 'タグVLAN', test: p => p.vlan },
            { value: 'snmp', label: 'SNMPで監視したい', test: p => p.snmp },
            { value: 'roaming', label: '高速ローミング（802.11r／k）', test: p => !!p.roaming }
          ]
        }
      ]
    },
    {
      id: 'g-place', scope: 'home', title: '置き方', open: false,
      items: [
        {
          key: 'mount', label: '置き方', type: 'radio',
          options: [
            { value: 'horizontal', label: '横置きしたい', test: p => p.placement.includes('横置き'),
              guide: '現行のWi-Fiルーターは、いずれも縦置き専用です。' },
            { value: 'ceiling', label: '天井に取り付けたい', test: p => p.ceiling },
            { value: 'outlet', label: 'コンセントに直挿ししたい', test: p => p.placement.includes('コンセント直挿し') }
          ]
        }
      ]
    },
    {
      id: 'g-lte', scope: 'lte', title: 'LTEルーター', open: true,
      items: [
        {
          key: 'form', label: '形', type: 'radio',
          options: [
            { value: 'router', label: 'Wi-Fiルーター型（SIMを挿して複数の機器をつなぐ）', test: p => hasLte(p) && p.lte.form === 'router' },
            { value: 'usb', label: 'USBドングル型（パソコン等に直接挿す）', test: p => hasLte(p) && p.lte.form === 'usb' }
          ]
        },
        {
          key: 'sim', label: 'SIMカードのサイズ', type: 'radio',
          options: [
            { value: 'nanoSIM', label: 'nanoSIM', test: p => hasLte(p) && p.lte.sim === 'nanoSIM' },
            { value: '標準SIM', label: '標準SIM', test: p => hasLte(p) && p.lte.sim === '標準SIM' }
          ]
        },
        {
          key: 'carrier', label: '使う回線の会社', type: 'checks',
          help: 'MVNO（格安SIM）は、元になっている回線の会社を選んでください。',
          options: Object.keys(CARRIER_LABEL).map(c => ({
            value: c, label: CARRIER_LABEL[c], test: p => hasLte(p) && p.lte.carriers.includes(c)
          }))
        },
        {
          key: 'ltefeat', label: '必要な機能', type: 'checks',
          options: [
            { value: 'fixedwan', label: '固定回線（有線WAN）も使いたい', test: p => hasLte(p) && p.lte.fixedWan },
            { value: 'failover', label: '回線が切れたら自動で切り替えたい（バックアップ）', test: p => hasLte(p) && p.lte.failover },
            { value: 'recovery', label: '無人拠点で自動復旧させたい（死活監視・定期リブート）', test: p => hasLte(p) && !!p.lte.autoRecovery },
            { value: 'wifi5g', label: 'Wi-Fiの5GHz帯を使いたい', test: p => hasLte(p) && p.bands.includes('5') },
            { value: 'lanport', label: '有線LANで機器をつなぎたい', test: p => hasLte(p) && p.lan.count >= 1 },
            { value: 'extant', label: '外付けの延長アンテナを使いたい', test: p => hasLte(p) && p.lte.extAntenna },
            { value: 'wall', label: '壁に取り付けたい', test: p => hasLte(p) && p.lte.wallMount },
            { value: 'din', label: 'DINレールに取り付けたい', test: p => hasLte(p) && p.lte.din },
            { value: 'water', label: '防塵・防水が必要', test: p => hasLte(p) && !!p.lte.waterproof },
            { value: 'ddns', label: 'ダイナミックDNS', test: p => hasLte(p) && p.lte.ddns }
          ]
        }
      ]
    }
  ];

  const ALL_ITEMS = FILTER_GROUPS.flatMap(g => g.items.map(it => ({ ...it, scope: g.scope, groupId: g.id })));
  const ITEM_BY_KEY = Object.fromEntries(ALL_ITEMS.map(it => [it.key, it]));

  // ---------- 状態 ----------
  const state = { cat: 'all', discon: false, values: {}, compare: [] };
  let DATA = { products: [] };

  const emptyValue = it => (it.type === 'radio' ? '' : []);
  function resetValues() { ALL_ITEMS.forEach(it => { state.values[it.key] = emptyValue(it); }); }
  resetValues();

  const itemVisible = it => it.scope === 'common' || state.cat === 'all' || state.cat === it.scope;

  // ---------- 判定 ----------
  function baseList() {
    return DATA.products.filter(p => {
      if (!state.discon && p.status === 'discontinued') return false;
      if (state.cat === 'home' && !isHome(p)) return false;
      if (state.cat === 'lte' && p.category !== 'lte') return false;
      return true;
    });
  }
  function passItem(p, it, value) {
    if (it.type === 'radio') {
      if (!value) return true;
      const opt = it.options.find(o => o.value === value);
      return opt ? opt.test(p) : true;
    }
    return (value || []).every(v => {
      const opt = it.options.find(o => o.value === v);
      return opt ? opt.test(p) : true;
    });
  }
  function passAll(p, values) {
    return ALL_ITEMS.every(it => !itemVisible(it) || passItem(p, it, values[it.key]));
  }
  function filtered() { return baseList().filter(p => passAll(p, state.values)); }

  // 選択肢ごとの件数（ほかの条件はそのまま、この選択肢を選んだ場合）
  function optionCount(it, opt) {
    const v = { ...state.values };
    if (it.type === 'radio') v[it.key] = opt.value;
    else v[it.key] = Array.from(new Set([...(v[it.key] || []), opt.value]));
    return baseList().filter(p => passAll(p, v)).length;
  }
  // この選択肢だけで0件になるか（＝そもそも対象の商品がない）
  function optionAloneCount(it, opt) {
    const v = {}; ALL_ITEMS.forEach(i => { v[i.key] = emptyValue(i); });
    v[it.key] = it.type === 'radio' ? opt.value : [opt.value];
    return baseList().filter(p => passAll(p, v)).length;
  }

  // ---------- 描画：絞り込み ----------
  const $ = sel => document.querySelector(sel);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const openState = {};

  function renderFilters() {
    const wrap = $('#filters');
    const cats = [
      { v: 'all', label: 'すべて', sub: 'Wi-Fiルーター・アクセスポイント・LTEルーター' },
      { v: 'home', label: '宅内用', sub: 'Wi-Fiルーター・アクセスポイント（固定回線につなぐ）' },
      { v: 'lte', label: 'LTEルーター', sub: 'SIMで通信する（モバイル回線）' }
    ];
    let html = `<div class="cat-switch"><div class="cat-switch-label">どちらをお探しですか？</div><div class="cat-options">` +
      cats.map(c => `<label class="cat-option ${state.cat === c.v ? 'is-on' : ''}">
        <input type="radio" name="cat" value="${c.v}" ${state.cat === c.v ? 'checked' : ''}>
        <span>${esc(c.label)}<span class="opt-sub">${esc(c.sub)}</span></span></label>`).join('') +
      `</div></div>`;

    FILTER_GROUPS.forEach(g => {
      if (!(g.scope === 'common' || state.cat === 'all' || state.cat === g.scope)) return;
      const open = openState[g.id] != null ? openState[g.id] : g.open;
      const active = g.items.some(it => isActive(it));
      const tag = g.scope === 'home' ? '<span class="fgroup-tag tag-home">宅内用</span>'
        : g.scope === 'lte' ? '<span class="fgroup-tag tag-lte">LTE</span>'
          : '<span class="fgroup-tag tag-common">共通</span>';
      html += `<details class="fgroup" data-group="${g.id}" ${open ? 'open' : ''}>
        <summary>${esc(g.title)} ${tag} ${active ? '<span class="fgroup-active" title="条件を指定中"></span>' : ''}</summary>
        <div class="fgroup-body">${g.items.map(renderItem).join('')}</div></details>`;
    });
    wrap.innerHTML = html;
  }

  function isActive(it) {
    const v = state.values[it.key];
    return it.type === 'radio' ? !!v : (v && v.length > 0);
  }

  function renderItem(it) {
    const cur = state.values[it.key];
    let h = `<div class="fitem"><div class="fitem-label">${esc(it.label)}</div>`;
    if (it.help) h += `<div class="fitem-help">${esc(it.help)}</div>`;
    if (it.type === 'radio') {
      h += `<label class="fopt"><input type="radio" name="f-${it.key}" data-key="${it.key}" value="" ${!cur ? 'checked' : ''}><span class="fopt-text">指定なし</span></label>`;
    }
    it.options.forEach(o => {
      if (o.sep) h += o.sep === '—' ? '<div class="fopt-sep"></div>' : `<div class="fopt-sep">${esc(o.sep)}</div>`;
      const checked = it.type === 'radio' ? cur === o.value : (cur || []).includes(o.value);
      const n = optionCount(it, o);
      h += `<label class="fopt ${n === 0 ? 'zero' : ''}">
        <input type="${it.type === 'radio' ? 'radio' : 'checkbox'}" name="f-${it.key}" data-key="${it.key}" value="${esc(o.value)}" ${checked ? 'checked' : ''}>
        <span class="fopt-text">${esc(o.label)}</span><span class="fopt-count">${n === 0 ? '対象商品0件' : n + '件'}</span></label>`;
      if (checked && o.tip) h += `<div class="tip">${esc(o.tip)}</div>`;
    });
    return h + '</div>';
  }

  // ---------- 描画：選択中の条件 ----------
  function renderChips() {
    const chips = [];
    ALL_ITEMS.forEach(it => {
      if (!itemVisible(it) || !isActive(it)) return;
      const v = state.values[it.key];
      const vals = it.type === 'radio' ? [v] : v;
      vals.forEach(val => {
        const o = it.options.find(x => x.value === val);
        if (o) chips.push(`<span class="chip">${esc(it.label)}：${esc(o.label)}<button type="button" data-chip-key="${it.key}" data-chip-val="${esc(val)}" aria-label="この条件を外す">×</button></span>`);
      });
    });
    $('#activeChips').innerHTML = chips.join('');
  }

  // ---------- 描画：案内（そもそも対象がない条件） ----------
  function renderGuide(count) {
    const msgs = [];
    ALL_ITEMS.forEach(it => {
      if (!itemVisible(it) || !isActive(it)) return;
      const v = state.values[it.key];
      (it.type === 'radio' ? [v] : v).forEach(val => {
        const o = it.options.find(x => x.value === val);
        if (o && optionAloneCount(it, o) === 0) {
          msgs.push(o.guide || `「${it.label}：${o.label}」に当てはまる商品はありません。`);
        }
      });
    });
    const g = $('#guide');
    if (msgs.length) {
      g.innerHTML = `<div class="guide-title">この条件に当てはまる商品はありません</div><ul>${msgs.map(m => `<li>${esc(m)}</li>`).join('')}</ul>`;
      g.hidden = false;
    } else if (count === 0) {
      g.innerHTML = `<div class="guide-title">条件をすべて満たす商品はありません</div>条件の組み合わせを見直してください。左の各選択肢の件数（「対象商品0件」）が目安になります。`;
      g.hidden = false;
    } else {
      g.hidden = true; g.innerHTML = '';
    }
  }

  // ---------- 描画：商品カード ----------
  const fmtYen = n => '¥' + Number(n).toLocaleString('ja-JP');
  function speedText(p) {
    const parts = [];
    ['6', '5', '2.4'].forEach(b => { if (p.speed && p.speed[b]) parts.push(`${b}GHz ${p.speed[b].toLocaleString('ja-JP')}Mbps`); });
    return parts.join(' ／ ') || '—';
  }
  const gbpsText = g => (g == null ? '—' : g >= 1 ? `${g}Gbps` : `${Math.round(g * 1000)}Mbps`);
  function priceHtml(p) {
    if (p.price && p.price.taxIn) return `<div class="price">${fmtYen(p.price.taxIn)}（税込）<small>税抜 ${fmtYen(p.price.taxEx)}</small></div>`;
    return '<div class="price">オープン価格</div>';
  }

  function cardNotes(p) {
    const n = [];
    const ipv6 = state.values.ipv6;
    if (p.noWifi) n.push(['strong', 'Wi-Fi機能はありません。パソコンやRaspberry PiなどのUSBポートに挿して使います。']);
    if (p.category === 'ap') n.push(['info', 'ルーター機能はありません。既存のルーターの配下に接続して使います。']);
    if (ipv6 && ipv6 !== 'unknown') {
      if (p.category === 'ap') n.push(['info', 'IPv6への対応は接続するルーター側で決まります。']);
      else if (p.ipv6) {
        const s = p.ipv6[ipv6];
        if (s === 'plan') n.push(['warn', `「${IPV6_LABEL[ipv6]}」は対応予定です（現時点では使えません）。`]);
        if (s === 'ok*') n.push(['warn', `「${IPV6_LABEL[ipv6]}」で接続している間は、ポート開放が使えません。`]);
      }
    }
    if (p.lte) n.push(['info', 'SIMカードは付属しません（別途ご契約・ご用意ください）。']);
    if ((state.values.ltefeat || []).includes('din') && p.lte && p.lte.din) n.push(['info', 'DINレールへの取り付けには、別売の取付用アダプターが必要です。']);
    if ((state.values.wfeat || []).includes('mesh') && p.mesh && p.mesh.note) n.push(['info', `メッシュ：${p.mesh.note}`]);
    if (p.warrantyNote) n.push(['info', `保証：${p.warrantyNote}`]);
    if (p.netFilterNote) n.push(['info', `ネットフィルタリング：${p.netFilterNote}`]);
    return n;
  }

  function cardSpecs(p) {
    const rows = [];
    if (p.wifiGen) rows.push(['Wi-Fi規格', WIFI_LABEL[p.wifiGen]]);
    if (p.wifiGen) rows.push(['最大速度', speedText(p)]);
    if (p.recommendedDevices) rows.push(['推奨接続台数', `${p.recommendedDevices}台`]);
    if (p.category === 'router') rows.push(['インターネット', `${gbpsText(p.wanGbps)}ポート×1`]);
    rows.push(['有線LAN', p.lan.detail]);
    if (p.lte) {
      rows.push(['対応回線', p.lte.carriers.map(c => CARRIER_LABEL[c]).join('、')]);
      rows.push(['SIM', p.lte.sim]);
      rows.push(['LTE速度', `下り最大${p.lte.down}Mbps／上り最大${p.lte.up}Mbps`]);
      rows.push(['対応バンド', p.lte.bands]);
      if (p.lte.os) rows.push(['対応OS', p.lte.os]);
    }
    if (p.vpnDetail) rows.push(['VPN', p.vpnDetail]);
    rows.push(['設置', p.placement]);
    rows.push(['電源', p.power.map(x => (x === 'AC' ? 'ACアダプター' : x === 'PoE' ? 'PoE受電' : 'USBバスパワー')).join('／')]);
    rows.push(['使用温度', `${p.tempMin}〜${p.tempMax}℃`]);
    rows.push(['保証期間', `${p.warrantyYears}年`]);
    return rows;
  }

  function renderResults() {
    const list = filtered();
    $('#resultCount').textContent = list.length;
    renderGuide(list.length);
    const ipv6 = state.values.ipv6;
    if (!list.length) { $('#results').innerHTML = ''; return; }
    $('#results').innerHTML = list.map(p => {
      const badges = [`<span class="badge ${CATEGORY_BADGE[p.category]}">${p.lte && p.lte.form === 'usb' ? 'LTE USBドングル' : CATEGORY_LABEL[p.category]}</span>`];
      if (p.status === 'discontinued') badges.push(`<span class="badge b-discon">生産終了${p.discontinuedDate ? '（' + esc(p.discontinuedDate) + '）' : ''}</span>`);
      if (p.status === 'limited') badges.push('<span class="badge b-discon">在庫限り</span>');
      if (ipv6 && ipv6 !== 'unknown' && p.ipv6) {
        const s = p.ipv6[ipv6];
        if (s === 'plan') badges.push('<span class="badge b-plan">IPv6：対応予定</span>');
        else if (s === 'ok' || s === 'ok*') badges.push('<span class="badge b-ok">IPv6：対応</span>');
      }
      const selected = state.compare.includes(p.model);
      const variants = p.variants ? `<div class="variants">${p.variants.map(v => `<span class="variant">${esc(v.label)}：${esc(v.model)}${v.jan ? '（JAN ' + esc(v.jan) + '）' : ''}</span>`).join('')}</div>` : '';
      const notes = cardNotes(p).map(([t, m]) => `<div class="note note-${t}">${esc(m)}</div>`).join('');
      return `<article class="card ${selected ? 'is-selected' : ''} ${p.status === 'discontinued' ? 'is-discon' : ''}" data-model="${esc(p.model)}">
        <div class="card-top">
          <div class="card-img">${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.model)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'noimg',textContent:'画像なし'}))">` : '<span class="noimg">画像なし</span>'}</div>
          <div class="card-head">
            <div class="badges">${badges.join('')}</div>
            <h3 class="card-model">${esc(p.model)}</h3>
            <p class="card-name">${esc(p.name)}</p>
            ${priceHtml(p)}
            ${!p.variants ? `<div class="jan">JAN：${p.jan ? esc(p.jan) : '—'}</div>` : variants}
          </div>
        </div>
        ${notes ? `<div class="card-notes">${notes}</div>` : ''}
        <dl class="specs">${cardSpecs(p).map(([k, v]) => `<div class="spec-row"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
        <div class="features">${(p.features || []).map(f => `<span class="feature">${esc(f)}</span>`).join('')}</div>
        <div class="card-actions">
          <label class="compare-check"><input type="checkbox" data-compare="${esc(p.model)}" ${selected ? 'checked' : ''}> 比較する</label>
          <button type="button" class="btn btn-secondary btn-sm" data-print="${esc(p.model)}">PDFで保存</button>
          <a class="btn btn-primary btn-sm" href="${esc(p.url)}" target="_blank" rel="noopener">商品ページ</a>
        </div>
      </article>`;
    }).join('');
  }

  // ---------- 比較 ----------
  function renderCompareBar() {
    const n = state.compare.length;
    $('#compareCount').textContent = n;
    $('#compareBar').hidden = n === 0;
  }

  const mark = b => (b ? '<span class="mk-ok">○</span>' : '<span class="mk-no">×</span>');
  function ipv6Mark(p, key) {
    if (p.category === 'ap') return 'ルーター側で決まります';
    if (!p.ipv6) return '—';
    const s = p.ipv6[key];
    if (s === 'ok') return '<span class="mk-ok">○</span>';
    if (s === 'ok*') return '<span class="mk-ok">○</span>（ポート開放は非対応）';
    if (s === 'plan') return '<span class="mk-plan">対応予定</span>';
    return '<span class="mk-no">×</span>';
  }

  function compareRows() {
    const R = [];
    const sec = t => R.push({ sec: t });
    const row = (label, fn) => R.push({ label, fn });
    sec('基本');
    row('種類', p => (p.lte && p.lte.form === 'usb' ? 'LTE USBドングル' : CATEGORY_LABEL[p.category]));
    row('状態', p => (p.status === 'discontinued' ? `生産終了${p.discontinuedDate ? '（' + p.discontinuedDate + '）' : ''}` : '販売中'));
    row('価格', p => (p.price && p.price.taxIn ? `${fmtYen(p.price.taxIn)}（税込）<br>税抜 ${fmtYen(p.price.taxEx)}` : 'オープン価格'));
    row('JAN', p => (p.variants ? p.variants.map(v => `${v.label}：${v.jan}`).join('<br>') : p.jan || '—'));
    sec('Wi-Fi');
    row('Wi-Fi規格', p => (p.wifiGen ? WIFI_LABEL[p.wifiGen] : 'なし'));
    row('最大速度', p => speedText(p));
    row('6GHz帯', p => mark(p.bands.includes('6')));
    row('MLO', p => mark(p.mlo));
    row('推奨接続台数', p => (p.recommendedDevices ? `${p.recommendedDevices}台` : '記載なし'));
    row('メッシュ', p => (p.mesh ? `${p.mesh.type}` : '<span class="mk-no">×</span>'));
    row('中継機（リピーター）', p => mark(p.modes.repeater));
    row('APモード', p => mark(p.modes.ap));
    row('バンドステアリング', p => mark(p.bandSteering));
    row('マルチSSID', p => mark(p.multiSsid));
    row('ゲスト用SSID', p => mark(p.guestSeparate));
    sec('有線・回線');
    row('インターネットポート', p => (p.category === 'router' ? gbpsText(p.wanGbps) : p.category === 'lte' && p.lte.fixedWan ? `${gbpsText(p.wanGbps)}（LTEと併用）` : '—'));
    row('有線LAN', p => esc(p.lan.detail));
    row('PPPoE', p => (p.pppoeSessions ? `${p.pppoeSessions}セッション` : '—'));
    sec('IPv6（IPoE）');
    IPV6_SERVICES.forEach(s => row(s.label, p => ipv6Mark(p, s.key)));
    sec('セキュリティ・法人向け');
    row('ネットフィルタリング', p => mark(p.netFilter));
    row('ペアレンタルコントロール', p => mark(p.parental));
    row('VPNサーバー', p => mark(p.vpnServer));
    row('IEEE802.1X／RADIUS', p => mark(p.enterpriseAuth));
    row('タグVLAN', p => mark(p.vlan));
    row('SNMP', p => mark(p.snmp));
    sec('LTE');
    row('対応回線', p => (p.lte ? p.lte.carriers.map(c => CARRIER_LABEL[c]).join('、') : '—'));
    row('SIM', p => (p.lte ? p.lte.sim : '—'));
    row('LTE速度', p => (p.lte ? `下り${p.lte.down}／上り${p.lte.up}Mbps` : '—'));
    row('対応バンド', p => (p.lte ? p.lte.bands : '—'));
    row('回線の自動切替', p => (p.lte ? mark(p.lte.failover) : '—'));
    row('延長アンテナ', p => (p.lte ? mark(p.lte.extAntenna) : '—'));
    sec('一般');
    row('設置', p => esc(p.placement));
    row('電源', p => p.power.join('／'));
    row('アンテナ', p => esc(p.antenna || '—'));
    row('使用温度', p => `${p.tempMin}〜${p.tempMax}℃`);
    row('外形寸法', p => esc(p.size || '—'));
    row('質量', p => esc(p.weight || '—'));
    row('保証期間', p => `${p.warrantyYears}年${p.warrantyNote ? '（' + esc(p.warrantyNote) + '）' : ''}`);
    row('有償保守（ISS）', p => mark(!!p.iss));
    return R;
  }

  function renderCompare() {
    const items = state.compare.map(m => DATA.products.find(p => p.model === m)).filter(Boolean);
    const diffOnly = $('#diffOnly').checked;
    let h = '<table class="ctable"><thead><tr><th></th>' + items.map(p => `<th class="cm">${esc(p.model)}</th>`).join('') + '</tr></thead><tbody>';
    compareRows().forEach(r => {
      if (r.sec) { h += `<tr class="sec"><th colspan="${items.length + 1}">${esc(r.sec)}</th></tr>`; return; }
      const cells = items.map(p => { try { return String(r.fn(p)); } catch (e) { return '—'; } });
      const diff = items.length > 1 && new Set(cells).size > 1;
      if (diffOnly && !diff) return;
      h += `<tr class="${diff ? 'diff' : ''}"><th>${esc(r.label)}</th>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
    });
    $('#compareTable').innerHTML = h + '</tbody></table>';
  }

  // ---------- URL（結果の共有） ----------
  function writeUrl() {
    const q = new URLSearchParams();
    if (state.cat !== 'all') q.set('cat', state.cat);
    if (state.discon) q.set('d', '1');
    ALL_ITEMS.forEach(it => {
      const v = state.values[it.key];
      if (it.type === 'radio' ? v : (v && v.length)) q.set(it.key, it.type === 'radio' ? v : v.join(','));
    });
    if (state.compare.length) q.set('c', state.compare.join(','));
    const s = q.toString();
    history.replaceState(null, '', location.pathname + (s ? '?' + s : ''));
  }
  function readUrl() {
    const q = new URLSearchParams(location.search);
    const cat = q.get('cat');
    if (['home', 'lte'].includes(cat)) state.cat = cat;
    state.discon = q.get('d') === '1';
    ALL_ITEMS.forEach(it => {
      const raw = q.get(it.key);
      if (!raw) return;
      const valid = new Set(it.options.map(o => o.value));
      if (it.type === 'radio') { if (valid.has(raw)) state.values[it.key] = raw; }
      else state.values[it.key] = raw.split(',').filter(v => valid.has(v));
    });
    const c = q.get('c');
    if (c) state.compare = c.split(',').filter(m => DATA.products.some(p => p.model === m));
  }

  // ---------- 全体の再描画 ----------
  function render() {
    renderFilters();
    renderChips();
    renderResults();
    renderCompareBar();
    $('#toggleDiscon').checked = state.discon;
    writeUrl();
  }

  // ---------- 便利機能 ----------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }
  async function copyUrl() {
    const url = location.href;
    try { await navigator.clipboard.writeText(url); toast('結果のURLをコピーしました'); return; } catch (e) { /* 下の方法で再試行 */ }
    const ta = document.createElement('textarea');
    ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    toast(ok ? '結果のURLをコピーしました' : 'コピーできませんでした。アドレスバーのURLをコピーしてください');
  }
  const ymd = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
  function printAs(fileBase, bodyClass, targetEl) {
    const prevTitle = document.title;
    document.title = `${fileBase}_${ymd()}`;          // 保存時のファイル名になる
    if (bodyClass) document.body.classList.add(bodyClass);
    if (targetEl) targetEl.classList.add('print-target');
    const cleanup = () => {
      document.title = prevTitle;
      if (bodyClass) document.body.classList.remove(bodyClass);
      if (targetEl) targetEl.classList.remove('print-target');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    setTimeout(cleanup, 1500); // afterprintが来ない環境向け
  }

  function showUpdatedAt() {
    const el = $('#updatedAt');
    if (!DATA.updatedAt) { el.textContent = ''; return; }
    const d = new Date(DATA.updatedAt + 'T00:00:00+09:00');
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    el.textContent = `データ最終更新日：${DATA.updatedAt.replace(/-/g, '/')}` + (days >= STALE_DAYS ? `（${days}日間更新されていません）` : '');
    el.classList.toggle('stale', days >= STALE_DAYS);
    if (DATA.sources) {
      $('#ipv6AsOf').textContent = DATA.sources.ipv6AsOf || '';
      if (DATA.sources.ipv6) $('#ipv6Src').href = DATA.sources.ipv6;
    }
  }

  // ---------- イベント ----------
  function bindEvents() {
    $('#filters').addEventListener('change', e => {
      const t = e.target;
      if (t.name === 'cat') {
        state.cat = t.value;
        ALL_ITEMS.forEach(it => { if (!itemVisible(it)) state.values[it.key] = emptyValue(it); });
        render(); return;
      }
      const key = t.dataset.key; if (!key) return;
      const it = ITEM_BY_KEY[key];
      if (it.type === 'radio') state.values[key] = t.value;
      else {
        const set = new Set(state.values[key]);
        t.checked ? set.add(t.value) : set.delete(t.value);
        state.values[key] = Array.from(set);
      }
      render();
    });
    $('#filters').addEventListener('toggle', e => {
      const d = e.target.closest && e.target.closest('details[data-group]');
      if (d) openState[d.dataset.group] = d.open;
    }, true);
    $('#activeChips').addEventListener('click', e => {
      const b = e.target.closest('button[data-chip-key]'); if (!b) return;
      const it = ITEM_BY_KEY[b.dataset.chipKey];
      if (it.type === 'radio') state.values[it.key] = '';
      else state.values[it.key] = state.values[it.key].filter(v => v !== b.dataset.chipVal);
      render();
    });
    $('#resetBtn').addEventListener('click', () => { state.cat = 'all'; resetValues(); render(); });
    $('#toggleDiscon').addEventListener('change', e => { state.discon = e.target.checked; render(); });
    $('#results').addEventListener('change', e => {
      const m = e.target.dataset.compare; if (!m) return;
      state.compare = e.target.checked ? [...new Set([...state.compare, m])] : state.compare.filter(x => x !== m);
      renderResults(); renderCompareBar(); writeUrl();
    });
    $('#results').addEventListener('click', e => {
      const b = e.target.closest('button[data-print]'); if (!b) return;
      printAs(b.dataset.print, 'print-single', b.closest('.card'));
    });
    $('#compareClear').addEventListener('click', () => { state.compare = []; render(); });
    $('#compareOpen').addEventListener('click', () => { renderCompare(); $('#compareModal').hidden = false; document.body.style.overflow = 'hidden'; });
    const closeModal = () => { $('#compareModal').hidden = true; document.body.style.overflow = ''; };
    $('#compareClose').addEventListener('click', closeModal);
    $('#compareModal').addEventListener('click', e => { if (e.target.id === 'compareModal') closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#compareModal').hidden) closeModal(); });
    $('#diffOnly').addEventListener('change', renderCompare);
    $('#comparePdf').addEventListener('click', () => printAs(`比較_${state.compare.join('_')}`, 'print-compare'));
    $('#copyUrlBtn').addEventListener('click', copyUrl);
    $('#printListBtn').addEventListener('click', () => printAs('Wi-Fiセレクター', null));
    $('#openSidebar').addEventListener('click', () => $('#sidebar').classList.add('is-open'));
    $('#closeSidebar').addEventListener('click', () => $('#sidebar').classList.remove('is-open'));
  }

  // ---------- 起動 ----------
  async function start() {
    try {
      const res = await fetch('data/products.json', { cache: 'no-cache' });
      DATA = await res.json();
    } catch (e) {
      $('#results').innerHTML = '<div class="empty">商品データを読み込めませんでした。時間をおいて再度お試しください。</div>';
      return;
    }
    readUrl();
    showUpdatedAt();
    bindEvents();
    render();
  }

  function gate() {
    let passed = false;
    try { passed = sessionStorage.getItem(GATE_KEY) === '1'; } catch (e) { passed = false; }
    const open = () => { $('#gate').hidden = true; $('#app').hidden = false; start(); };
    if (passed) { open(); return; }
    $('#gateForm').addEventListener('submit', e => {
      e.preventDefault();
      if ($('#gateInput').value === SITE_PASSWORD) {
        try { sessionStorage.setItem(GATE_KEY, '1'); } catch (err) { /* 保存できなくても表示は続ける */ }
        open();
      } else {
        $('#gateError').hidden = false;
      }
    });
    $('#gateInput').focus();
  }

  gate();
})();
