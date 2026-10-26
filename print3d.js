// ミニナノ風の組立図（表紙・部品リスト・買い物リスト・組立手順）。naoblock-builder の print.js と同じ作り。
// 各ページを A4 縦の 1 枚の絵（canvas）として描き、「PDF で保存」も「プリンターで印刷」も同じ絵から作る。
import * as THREE from 'three';
import { buildPdf, dataUrlBytes } from './pdf.js';

// A4 縦・150dpi。余白 12mm はページの絵の中に描き込む
const PAGE_W = 1240, PAGE_H = 1754;
const M = Math.round((12 / 25.4) * 150);
const CW = PAGE_W - M * 2;
const BOTTOM = PAGE_H - M;
const GAP = 36, HEAD_H = 64;
const LAYERS_PER_PAGE = 2;
const PRICE = 220;   // 単色部品は 1 袋 220 円（どの形も 1 キャラ分なら 1 袋に収まる）
const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", system-ui, -apple-system, "Yu Gothic", Meiryo, sans-serif';
const JNAME = {black: 'ブラック', red: 'レッド', pink: 'ピンク', skin: 'ベージュ', white: 'ホワイト', yellow: 'イエロー', brown: 'ブラウン', gray: 'グレー', purple: 'パープル', orange: 'オレンジ', green: 'グリーン', blue: 'ブルー', navy: 'ネイビー', lightblue: 'ライトブルー'};
const bent = s => /^[LT]\d$/.test(s);   // L字・T字（数字は向き）
const baseShape = s => bent(s) ? s[0] : s.replace(/[xz]$/, '');
const shapeName = s => s === 'round' ? '丸1×1' : s.startsWith('slope') ? '斜め1×2' : /^[LT]\d?$/.test(s) ? s[0] + '字' : s.replace(/[xz]$/, '').replace('x', '×');
// マスの集まりの外周（角の座標を反時計回り）を、内側へ d だけ寄せて返す。L字・T字を形どおりに描くため
function outline(cells, d = 0) {
  const has = new Set(cells.map(([x, z]) => x + ',' + z)), next = new Map();
  for (const [x, z] of cells) for (const [a, b, c, e, nx, nz] of [[x, z, x + 1, z, x, z - 1], [x + 1, z, x + 1, z + 1, x + 1, z], [x + 1, z + 1, x, z + 1, x, z + 1], [x, z + 1, x, z, x - 1, z]])
    if (!has.has(nx + ',' + nz)) next.set(a + ',' + b, [c, e]);
  const start = next.keys().next().value.split(',').map(Number), pts = [];
  let p = start; do { pts.push(p); p = next.get(p.join()); } while (p.join() !== start.join());
  const v = pts.filter((q, i) => { const a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length]; return (q[0] - a[0]) * (b[1] - q[1]) !== (q[1] - a[1]) * (b[0] - q[0]); });
  return v.map((q, i) => { const a = v[(i + v.length - 1) % v.length], b = v[(i + 1) % v.length], n = (u, w) => [-Math.sign(w[1] - u[1]), Math.sign(w[0] - u[0])];
    const [n1, n2] = [n(a, q), n(q, b)]; return [q[0] + d * (n1[0] + n2[0]), q[1] + d * (n1[1] + n2[1])]; });
}
const yen = n => `${n.toLocaleString('ja-JP')}円`;

// ---- 文字 ----
const font = (ctx, size, weight = 400) => { ctx.font = `${weight} ${size}px ${FONT}`; };
function text(ctx, str, x, y, { align = 'left', color = '#000' } = {}) {
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillText(str, x, y);
}
function wrap(ctx, str, maxW) {   // 「、」の後ろで切れるならそこで、切れなければ 1 文字ずつ
  const lines = []; let line = '';
  const fits = t => ctx.measureText(t).width <= maxW;
  for (const token of str.split(/(?<=、)/)) {
    if (fits(line + token)) { line += token; continue; }
    if (line && fits(token)) { lines.push(line); line = token; continue; }
    for (const ch of token) { if (line && !fits(line + ch)) { lines.push(line); line = ch; } else line += ch; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}
function fitFont(ctx, str, maxW, size, weight, min) {
  let s = size; font(ctx, s, weight);
  while (s > min && ctx.measureText(str).width > maxW) { s -= 1; font(ctx, s, weight); }
  return s;
}
function swatch(ctx, rgb, x, y, size) {
  ctx.fillStyle = `rgb(${rgb.join(',')})`; ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
}

// ---- ページ ----
class Doc {
  constructor() { this.pages = []; this.ctx = null; this.y = M; }
  newPage() {
    const c = document.createElement('canvas'); c.width = PAGE_W; c.height = PAGE_H;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    this.pages.push(c); this.ctx = ctx; this.y = M; return ctx;
  }
  room() { return BOTTOM - this.y; }
}

// ---- 3D の絵（組んだところまで。今の段は色そのまま、下の段はうすく） ----
function makeShooter(P) {
  const { W, D, H, aspect: A, palette: PAL } = P;
  const col = c => PAL[c] ? c : 'black';
  const ren = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  ren.setPixelRatio(1); ren.setSize(1000, 1000, false);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xffffff);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.5));
  const dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(20, 40, 30); scene.add(dl);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x111111 });
  const fadeLine = new THREE.LineBasicMaterial({ color: 0xbbbbbb });
  const stud = new THREE.CylinderGeometry(0.3, 0.3, 0.22, 14);
  const obj = new Map();
  for (const b of P.bricks) {
    const c = new THREE.Color(...PAL[col(b.col)].map(v => v / 255));
    const mat = new THREE.MeshLambertMaterial({ color: c });
    const fade = new THREE.MeshLambertMaterial({ color: c.clone().lerp(new THREE.Color(0xffffff), .65) });
    const xs = b.cells.map(c => c[0]), zs = b.cells.map(c => c[2]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), g = 0.07;
    let geo;
    if (b.shape === 'round') geo = new THREE.CylinderGeometry(0.46, 0.46, A - g, 20);
    else if (bent(b.shape)) {   // L字・T字は外周を押し出して作る
      const sh = new THREE.Shape(outline(b.cells.map(([x, , z]) => [x, z]), g / 2).map(([x, z]) => new THREE.Vector2(x - .5 - (x0 + x1) / 2, z - .5 - (z0 + z1) / 2)));
      geo = new THREE.ExtrudeGeometry(sh, { depth: A - g, bevelEnabled: false }); geo.translate(0, 0, -(A - g) / 2); geo.rotateX(-Math.PI / 2);
    } else geo = new THREE.BoxGeometry(x1 - x0 + 1 - g, A - g, z1 - z0 + 1 - g);
    const grp = new THREE.Group(); grp.position.set((x0 + x1) / 2 - W / 2, b.y * A, -((z0 + z1) / 2 - D / 2));
    const body = new THREE.Mesh(geo, mat), edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), lineMat);
    grp.add(body, edge);
    const studs = b.cells.map(([x, , z]) => { const s = new THREE.Mesh(stud, mat); s.position.set(x - W / 2 - grp.position.x, A / 2 + 0.08, -(z - D / 2) - grp.position.z); grp.add(s); return s; });
    grp.visible = false; scene.add(grp);
    obj.set(b, { grp, set: faded => { const m = faded ? fade : mat; body.material = m; studs.forEach(s => s.material = m); edge.material = faded ? fadeLine : lineMat; } });
  }
  // カメラは全部の段で同じ（ななめ前の上から、完成形が収まる位置）
  const cells = P.bricks.flatMap(b => b.cells);
  const mx = cells.reduce((s, c) => s + c[0], 0) / cells.length - W / 2, mz = -(cells.reduce((s, c) => s + c[2], 0) / cells.length - D / 2);
  const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 500);
  return function shot(done, current, w, h) {
    for (const [b, o] of obj) { o.grp.visible = done.has(b) || current.has(b); o.set(!current.has(b)); }
    ren.setSize(w, h, false); cam.aspect = w / h;
    const ty = (H * A) / 2 - .5, fit = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)), dist = Math.max(H * A + 3, (Math.max(W, D) + 2) / cam.aspect) / fit * 1.05;   // 完成形が縦にも横にも収まる距離
    cam.position.set(mx + dist * .42, ty + dist * .62, mz + dist * .75); cam.lookAt(mx, ty, mz); cam.updateProjectionMatrix();
    ren.render(scene, cam);
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(ren.domElement, 0, 0);
    return c;
  };
}

// ---- 手順：組立ガイドと同じ順（奥から手前、左から右。宙づりのパーツは 1 つ上の段のあとに下から差し込む） ----
function layerSteps(P) {
  const occ = new Set(P.bricks.flatMap(b => b.cells.map(c => c.join())));
  const hanging = b => b.y > 0 && !b.cells.some(([x, y, z]) => occ.has([x, y - 1, z].join()));
  const out = [];
  for (let y = 0; y < P.H; y++) {
    const layer = P.bricks.filter(b => b.y === y && !hanging(b));
    layer.sort((a, b) => Math.max(...b.cells.map(c => c[2])) - Math.max(...a.cells.map(c => c[2])) || Math.min(...a.cells.map(c => c[0])) - Math.min(...b.cells.map(c => c[0])));
    out.push({ y, pieces: layer, under: P.bricks.filter(b => b.y === y - 1 && hanging(b)) });
  }
  return out;
}

// 色と形ごとの数
function countParts(P, list) {
  const col = c => P.palette[c] ? c : 'black';
  const m = new Map();
  for (const b of list) { const k = col(b.col) + '|' + baseShape(b.shape); m.set(k, (m.get(k) || 0) + 1); }
  return [...m].map(([k, n]) => { const [c, s] = k.split('|'); return { c, s, n, rgb: P.palette[c] }; })
    .sort((a, b) => a.c.localeCompare(b.c) || a.s.localeCompare(b.s));
}

// ---- 表紙 ----
function coverPage(doc, { P, label, url, shot }) {
  const ctx = doc.newPage(), cx = PAGE_W / 2;
  font(ctx, 28);
  text(ctx, 'ナオブロック（naoblock）ミニナノ風組立図', cx, M + 28, { align: 'center', color: '#444' });
  const titleSize = fitFont(ctx, label, CW, 64, 700, 32);
  text(ctx, label, cx, M + 28 + 18 + titleSize, { align: 'center' });
  const top = M + 28 + 18 + titleSize + 36;
  const cells = P.bricks.flatMap(b => b.cells), span = i => Math.max(...cells.map(c => c[i])) - Math.min(...cells.map(c => c[i])) + 1;
  const rows = countParts(P, P.bricks);
  const facts = [
    ['大きさ', `横 ${span(0)} × 奥行き ${span(2)} ポッチ、高さ ${P.H} 段（ミニナノのケースに入る大きさ。プレートなし）`],
    ['パーツの総数', `${P.bricks.length} 個（${rows.length} 種類）`],
    ['合計金額', `約 ${yen(rows.length * PRICE)}（税込。単色部品 ${rows.length} 袋）`],
    ['アプリ', url],
  ];
  const thW = 210, tdW = CW - thW - 40, line = 40;
  font(ctx, 26);
  const factLines = facts.map(([, v]) => wrap(ctx, v, tdW));
  const factsH = factLines.reduce((n, ls) => n + ls.length * line + 10, 0);
  const legalText = 'nanoblock（ナノブロック）は株式会社カワダの登録商標です。本アプリは非公式のファン作品です。';
  const legalSize = fitFont(ctx, legalText, CW, 20, 400, 14);
  const legal = wrap(ctx, legalText, CW), legalH = legal.length * 30;

  const size = Math.min(CW - 120, BOTTOM - top - 40 - factsH - 40 - legalH);
  ctx.drawImage(shot(new Set(), new Set(P.bricks), size * 2, size * 2), cx - size / 2, top, size, size);
  let y = top + size + 40;
  facts.forEach(([k], i) => {
    font(ctx, 26, 700); text(ctx, k, M + 20, y + 28, { color: '#333' });
    font(ctx, 26); factLines[i].forEach((l, j) => text(ctx, l, M + 20 + thW, y + 28 + j * line));
    y += factLines[i].length * line + 10;
  });
  font(ctx, legalSize);
  legal.forEach((l, j) => text(ctx, l, M, BOTTOM - legalH + 22 + j * 30, { color: '#555' }));
}

// ---- 部品リスト・買い物リスト（表。入りきらない行は次のページへ） ----
const ROW_H = 36, TABLE_FONT = 22;
function table(doc, { title, notes = [], columns, rows, footer, after = [] }) {
  const fixed = columns.reduce((n, c) => n + (c.w || 0), 0);
  const cols = columns.map(c => ({ ...c, w: c.w || CW - fixed }));
  const xs = []; cols.reduce((x, c) => { xs.push(x); return x + c.w; }, M);
  const heading = cont => {
    const ctx = doc.ctx; font(ctx, 34, 700);
    text(ctx, cont ? `${title}（つづき）` : title, M, doc.y + 36);
    ctx.fillStyle = '#000'; ctx.fillRect(M, doc.y + 48, CW, 3); doc.y += 64;
  };
  const header = () => {
    const ctx = doc.ctx; font(ctx, TABLE_FONT - 2, 700);
    cols.forEach((c, i) => text(ctx, c.label, c.align === 'right' ? xs[i] + c.w - 8 : xs[i] + 8, doc.y + 26, { align: c.align === 'right' ? 'right' : 'left', color: '#333' }));
    ctx.fillStyle = '#000'; ctx.fillRect(M, doc.y + ROW_H - 2, CW, 2); doc.y += ROW_H;
  };
  const row = (cells, bold = false) => {
    const ctx = doc.ctx; font(ctx, TABLE_FONT, bold ? 700 : 400);
    cells.forEach((cell, i) => {
      if (!cell) return;
      const c = cols[i]; let x = c.align === 'right' ? xs[i] + c.w - 8 : xs[i] + 8;
      if (cell.swatch) { swatch(ctx, cell.swatch, x, doc.y + 9, 18); x += 28; }
      if (cell.text) text(ctx, cell.text, x, doc.y + 26, { align: c.align === 'right' ? 'right' : 'left' });
    });
    ctx.fillStyle = '#bbb'; ctx.fillRect(M, doc.y + ROW_H - 1, CW, 1); doc.y += ROW_H;
  };
  const noteLines = list => {
    font(doc.ctx, 22);
    for (const n of list) for (const l of wrap(doc.ctx, n, CW)) {
      if (doc.room() < 34) doc.newPage();
      text(doc.ctx, l, M, doc.y + 22, { color: '#333' }); doc.y += 34;
    }
  };
  if (doc.room() < 64 + 80 + ROW_H * 3) doc.newPage();
  heading(false); noteLines(notes); header();
  const all = [...rows.map(r => [r, false]), ...(footer ? [[footer, true]] : [])];
  for (const [k, [r, bold]] of all.entries()) {
    const need = all.length - k === 2 && footer ? ROW_H * 2 : ROW_H;   // 合計の行は、ひとつ前の行と同じページに
    if (doc.room() < need) { doc.newPage(); heading(true); header(); }
    row(r, bold);
  }
  doc.y += 10; noteLines(after);
}
function listPages(doc, { P }) {
  doc.newPage();
  const rows = countParts(P, P.bricks);
  table(doc, {
    title: '部品リスト',
    notes: ['袋から出した部品を数えたら、□ に印を付けてください。見えない中身は、どれもブラックで組みます。'],
    columns: [{ label: '✓', w: 70 }, { label: '色', w: null }, { label: '形', w: 200 }, { label: '個数', w: 160, align: 'right' }],
    rows: rows.map(r => [{ text: '□' }, { swatch: r.rgb, text: JNAME[r.c] }, { text: shapeName(r.s) }, { text: `${r.n}` }]),
    footer: [null, { text: '合計' }, null, { text: `${P.bricks.length}` }],
  });
  doc.y += 40;
  table(doc, {
    title: '買い物リスト',
    columns: [{ label: '部品', w: null }, { label: '必要数', w: 220, align: 'right' }, { label: '袋数', w: 140, align: 'right' }, { label: '金額', w: 200, align: 'right' }],
    rows: rows.map(r => [{ swatch: r.rgb, text: `${JNAME[r.c]} ${shapeName(r.s)}` }, { text: `${r.n}個` }, { text: '1袋' }, { text: yen(PRICE) }]),
    footer: [{ text: `合計（単色部品 ${rows.length}袋）` }, null, null, { text: yen(rows.length * PRICE) }],
    after: ['値段は税込。どれもカワダ公式ストアの単色部品（1袋220円）です。1袋の入り数は形によってちがうので、買う前に確かめてください。'],
  });
}

// ---- 組立手順（1ページに2段。左に3D、右に上から見た図） ----
function topView(ctx, { P, layer, prev, x, y, w, h }) {
  const col = c => P.palette[c] ? c : 'black';
  const cells = P.bricks.flatMap(b => b.cells);
  const X0 = Math.min(...cells.map(c => c[0])), X1 = Math.max(...cells.map(c => c[0])), Z0 = Math.min(...cells.map(c => c[2])), Z1 = Math.max(...cells.map(c => c[2]));
  const gw = X1 - X0 + 1, gd = Z1 - Z0 + 1, s = Math.floor(Math.min(w / gw, (h - 40) / gd));
  const ox = x + (w - gw * s) / 2, oy = y;
  const at = (cx, cz) => [ox + (cx - X0) * s, oy + (Z1 - cz) * s];
  ctx.strokeStyle = '#e4e4e4'; ctx.lineWidth = 1;
  for (let k = 0; k <= gw; k++) { ctx.beginPath(); ctx.moveTo(ox + k * s, oy); ctx.lineTo(ox + k * s, oy + gd * s); ctx.stroke(); }
  for (let k = 0; k <= gd; k++) { ctx.beginPath(); ctx.moveTo(ox, oy + k * s); ctx.lineTo(ox + gw * s, oy + k * s); ctx.stroke(); }
  ctx.strokeStyle = '#b5b5b5'; ctx.lineWidth = 2;   // 1つ下の段
  for (const b of prev) for (const [cx, , cz] of b.cells) { const [X, Y] = at(cx, cz); ctx.strokeRect(X + s * .15, Y + s * .15, s * .7, s * .7); }
  const rect = b => { const xs = b.cells.map(c => c[0]), zs = b.cells.map(c => c[2]); const [X, Y] = at(Math.min(...xs), Math.max(...zs)); return [X + 2, Y + 2, (Math.max(...xs) - Math.min(...xs) + 1) * s - 4, (Math.max(...zs) - Math.min(...zs) + 1) * s - 4]; };
  const path = (b, X, Y, bw, bh) => {
    ctx.beginPath();
    if (b.shape === 'round') ctx.ellipse(X + bw / 2, Y + bh / 2, bw / 2, bh / 2, 0, 0, 7);
    else if (bent(b.shape)) { outline(b.cells.map(([x, , z]) => [x, z]), 2 / s).forEach(([gx, gz], i) => ctx[i ? 'lineTo' : 'moveTo'](ox + (gx - X0) * s, oy + (Z1 + 1 - gz) * s)); ctx.closePath(); }
    else ctx.roundRect(X, Y, bw, bh, 5);
  };
  // 番号を書く場所。L字・T字は外枠の真ん中が穴や縁になるので、となりの多いマス（角・T の真ん中）の中心に書く
  const mid = (b, X, Y, bw, bh) => {
    if (!bent(b.shape)) return [X + bw / 2, Y + bh / 2];
    const has = new Set(b.cells.map(([x, , z]) => x + ',' + z)), nb = ([x, , z]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => has.has((x + dx) + ',' + (z + dz))).length;
    const c = b.cells.reduce((m, c) => nb(c) > nb(m) ? c : m), [cx, cy] = at(c[0], c[2]);
    return [cx + s / 2, cy + s / 2];
  };
  // 下から差し込むパーツは上の段の下に隠れるので、先に塗って、点線と番号はいちばん上に描く
  const order = [...layer.map((p, i) => ({ ...p, i })).filter(p => p.under), ...layer.map((p, i) => ({ ...p, i })).filter(p => !p.under)];
  for (const { b, under } of order) {
    const [X, Y, bw, bh] = rect(b), rgb = P.palette[col(b.col)];
    path(b, X, Y, bw, bh); ctx.fillStyle = `rgb(${rgb.join(',')})`; ctx.fill();
    if (!under) { ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.stroke(); }
  }
  for (const { b, under, i } of order) {
    const [X, Y, bw, bh] = rect(b), rgb = P.palette[col(b.col)];
    font(ctx, Math.round(s * .42), 700);
    if (under) {   // ピンクの点線と、ピンクの丸に白い番号（下の段のパーツに重なっても読めるように）
      path(b, X, Y, bw, bh); ctx.setLineDash([8, 6]); ctx.strokeStyle = '#e65f91'; ctx.lineWidth = 4; ctx.stroke(); ctx.setLineDash([]);
      const r = s * .34, cx = mid(b, X, Y, bw, bh)[0], cy = bent(b.shape) ? mid(b, X, Y, bw, bh)[1] : Y + bh - r * .2;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fillStyle = '#e65f91'; ctx.fill();
      text(ctx, `${i + 1}`, cx, cy + s * .15, { align: 'center', color: '#fff' });
      continue;
    }
    const dark = rgb[0] * .3 + rgb[1] * .59 + rgb[2] * .11 < 140;   // 番号は、濃い色には白、うすい色には黒
    const [mx, my] = mid(b, X, Y, bw, bh);
    text(ctx, `${i + 1}`, mx, my + s * .15, { align: 'center', color: dark ? '#fff' : '#000' });
  }
  font(ctx, 20); text(ctx, '上から見た図（下が正面）。灰色の枠は1つ下の段', x + w / 2, oy + gd * s + 30, { align: 'center', color: '#555' });
}
function layerBox(ctx, { P, L, prevLayer, done, shot, x, y, w, h }) {
  ctx.strokeStyle = '#999'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  const pad = 18, iw = w - pad * 2;
  const head = `${L.y + 1}段目 / ${P.H}段`;
  font(ctx, 34, 700); text(ctx, head, x + pad, y + pad + 34); const headW = ctx.measureText(head).width;
  const n = L.pieces.length + L.under.length;
  font(ctx, 24); text(ctx, `${n}個${L.under.length ? `（うち${L.under.length}個は1つ下の段に下から差し込む）` : ''}`, x + pad + headW + 24, y + pad + 32, { color: '#333' });

  // 下：使うパーツ
  const list = countParts(P, [...L.pieces, ...L.under]).map(r => `${JNAME[r.c]} ${shapeName(r.s)} ×${r.n}`).join('、');
  font(ctx, 24); const usage = wrap(ctx, `使うパーツ：${list}`, iw);
  const notes = L.under.length ? wrap(ctx, 'ピンクの点線のパーツは、この段を組んだあと、1つ下の段に下から差し込みます。', iw) : [];
  const footH = (usage.length + notes.length) * 34 + 10;
  const figTop = y + pad + 34 + 24, figH = y + h - pad - footH - figTop;
  const half = (iw - 20) / 2;
  const current = new Set([...L.pieces, ...L.under]);
  ctx.drawImage(shot(done, current, Math.round(half * 2), Math.round(figH * 2)), x + pad, figTop, half, figH);
  topView(ctx, { P, layer: [...L.pieces.map(b => ({ b })), ...L.under.map(b => ({ b, under: true }))], prev: prevLayer, x: x + pad + half + 20, y: figTop + 10, w: half, h: figH - 10 });
  let fy = figTop + figH + 10;
  usage.forEach(l => { text(ctx, l, x + pad, fy + 26); fy += 34; });
  notes.forEach(l => { text(ctx, l, x + pad, fy + 26, { color: '#c2185b' }); fy += 34; });
}
function stepPages(doc, { P, shot }) {
  const layers = layerSteps(P), done = new Set();
  const boxH = (PAGE_H - M * 2 - HEAD_H - GAP) / 2;
  for (let i = 0; i < layers.length; i += LAYERS_PER_PAGE) {
    const ctx = doc.newPage();
    font(ctx, 34, 700); text(ctx, i === 0 ? '組立手順' : '組立手順（つづき）', M, M + 36);
    ctx.fillStyle = '#000'; ctx.fillRect(M, M + 48, CW, 3);
    for (let k = i; k < Math.min(i + LAYERS_PER_PAGE, layers.length); k++) {
      const L = layers[k];
      layerBox(ctx, { P, L, prevLayer: P.bricks.filter(b => b.y === L.y - 1), done: new Set(done), shot, x: M, y: M + HEAD_H + (k - i) * (boxH + GAP), w: CW, h: boxH });
      for (const b of [...L.pieces, ...L.under]) done.add(b);
    }
  }
}

// ---- まとめ ----
// opts: { P（PLAN）, label（「シャオランミニナノ風」）, url }。戻り値：[{ dataUrl（JPEG）, width, height }]
export function renderPages(opts) {
  const shot = makeShooter(opts.P), doc = new Doc(), o = { ...opts, shot };
  coverPage(doc, o); listPages(doc, o); stepPages(doc, o);
  return doc.pages.map(c => ({ dataUrl: c.toDataURL('image/jpeg', 0.9), width: c.width, height: c.height }));
}
export function pagesToPdf(pages) {
  return new Blob([buildPdf(pages.map(p => ({ jpeg: dataUrlBytes(p.dataUrl), width: p.width, height: p.height })))], { type: 'application/pdf' });
}
export function downloadBlob(blob, filename) {   // iPhone では PDF のプレビューが開き、共有ボタンから「ファイルに保存」できる
  const url = URL.createObjectURL(blob), a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function fillPrintRoot(pages) {
  let root = document.getElementById('print-root');
  if (!root) { root = Object.assign(document.createElement('div'), { id: 'print-root' }); root.style.display = 'none'; document.body.append(root); }
  const imgs = pages.map((p, i) => Object.assign(document.createElement('img'), { src: p.dataUrl, alt: `組立図 ${i + 1} / ${pages.length} ページ` }));
  root.replaceChildren(...imgs);
  await Promise.all(imgs.map(img => img.decode().catch(() => {})));
}

// ボタンをつなぐ。作ったページは使い回す
export function wirePrint({ P, CH, pdfBtn, printBtn, status }) {
  let pages = null;
  const opts = { P, label: `${CH.name}ミニナノ風`, url: `${location.origin}${location.pathname.replace(/[^/]*$/, '')}?plan=${CH.key}` };
  const prepare = () => (pages ??= renderPages(opts));
  const say = m => { if (status) { status.hidden = !m; status.textContent = m || ''; } };
  const busy = (btn, msg, work) => {
    btn.disabled = true; say(msg);
    setTimeout(async () => {   // 「作っています…」を先に出してから描く
      try { await work(); say(''); } catch (e) { console.error(e); say(`うまくいきませんでした：${e.message}`); } finally { btn.disabled = false; }
    }, 30);
  };
  pdfBtn.onclick = () => busy(pdfBtn, '組立図の PDF を作っています…', () => downloadBlob(pagesToPdf(prepare()), `${CH.name}ミニナノ風_naoblock.pdf`));
  printBtn.onclick = () => busy(printBtn, '印刷の準備をしています…', async () => { await fillPrintRoot(prepare()); window.print(); });
  window.onbeforeprint = () => { if (!document.getElementById('print-root')?.childElementCount) fillPrintRoot(prepare()); };
  return { renderPages: () => prepare(), pagesToPdf };
}
