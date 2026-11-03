// ファイルから読み込んだ作品（1回きり。サーバーにも端末にも残さない。いま開いているタブの sessionStorage にだけ置く）
// 読める形は 4 つ（AI に頼むときは 0 の箱。書き方は ai_prompt.txt。40_Skills の naoblock-3d-file スキルも同じ中身）
//   0. 箱の組み合わせ：{ "name", "boxes": [{ "part", "at": [x, y, z], "size": [横, 高さ, 奥行き], "color" }, ...] }（あとの箱が上書き。color "none" はくり抜き）
//   1. 段の絵：{ "name", "colors": { "K": "black", ... }, "layers": [ ["..K..", ...], ... ] }（下の段から。各段の 1 行目が奥、最後の行が手前）
//   2. 立方体：{ "name", "cubes": [[x, y, z, "black"], ...] }（y が段、z=0 が手前）
//   3. 組立データ：plan_*.js と同じ { H, W, D, palette, bricks }（先頭の window.PLAN= はあってもよい）
// 1・2 は、ブラウザの中で部品に分ける（段ごとに向きを互い違いにして、大きい部品から詰める）
(() => {
  const KEY = 'nbUpload';
  // 使える色（カワダ公式ストアで単色部品を買える色。組立ガイドの JNAME と同じ）
  const COLORS = { black: [35, 35, 40], red: [200, 35, 50], pink: [230, 95, 145], skin: [222, 196, 150], white: [245, 245, 245], yellow: [235, 185, 50], brown: [120, 75, 40],
    gray: [150, 150, 155], purple: [110, 60, 160], orange: [240, 130, 40], green: [60, 160, 70], blue: [50, 100, 200], navy: [35, 45, 95], lightblue: [120, 200, 235],
    darkgray: [90, 90, 90], lightgray: [200, 200, 200], peach: [246, 199, 164], beige: [217, 196, 154], yelloworange: [255, 179, 0], lightgreen: [139, 195, 74], clear: [225, 238, 245] };
  const MAX = 40, MAX_CUBES = 6000;
  // 大きい部品から。[短い辺, 長い辺]
  const RECTS = [[2, 4], [2, 3], [1, 4], [2, 2], [1, 3], [1, 2], [1, 1]];

  const fail = msg => { throw new Error(msg); };
  const colorOf = (c, where) => {
    const k = String(c).trim().toLowerCase();
    if (!COLORS[k]) fail(`${where}の色「${c}」は使えません。使える色：${Object.keys(COLORS).join(' ')}`);
    return k;
  };

  // AI の返事をそのまま貼っても読めるように、```json の囲みや window.PLAN= を外す
  function toJson(text) {
    let t = String(text).trim();
    const fence = t.match(/```(?:json|js|javascript)?\s*([\s\S]*?)```/);
    if (fence) t = fence[1].trim();
    t = t.replace(/^window\.PLAN\s*=\s*/, '').replace(/;\s*$/, '');
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b < a) fail('中身が JSON の形になっていません（{ から } までが見つかりません）');
    try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { fail(`JSON として読めませんでした（${e.message}）`); }
  }

  // 箱の組み合わせ → 立方体。あとに書いた箱が前の箱を上書きする（顔や模様を手前に貼れる）。"none" はそこを空ける
  function cubesFromBoxes(boxes) {
    if (!boxes.length) fail('boxes が空です');
    const at = new Map();
    boxes.forEach((b, i) => {
      const where = `${i + 1}個目の箱${b.part ? `（${b.part}）` : ''}`;
      const p = b.at, sz = b.size;
      if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isInteger)) fail(`${where}の at が [横, 高さ, 奥行き] の整数 3 つになっていません`);
      if (!Array.isArray(sz) || sz.length !== 3 || !sz.every(n => Number.isInteger(n) && n >= 1 && n <= MAX)) fail(`${where}の size が 1〜${MAX} の整数 3 つになっていません`);
      const none = String(b.color).trim().toLowerCase() === 'none', col = none ? null : colorOf(b.color, where);
      for (let x = p[0]; x < p[0] + sz[0]; x++) for (let y = p[1]; y < p[1] + sz[1]; y++) for (let z = p[2]; z < p[2] + sz[2]; z++) {
        if (none) at.delete(`${x},${y},${z}`); else at.set(`${x},${y},${z}`, col);
      }
      if (at.size > MAX_CUBES) fail(`ブロックが多すぎます（${MAX_CUBES}個まで）`);
    });
    return [...at].map(([k, c]) => [...k.split(',').map(Number), c]);
  }

  // 段の絵 → 立方体
  function cubesFromLayers(d) {
    const map = d.colors || {};
    if (!Array.isArray(d.layers) || !d.layers.length) fail('layers（段の絵）が空です');
    const out = [];
    d.layers.forEach((rows, y) => {
      if (!Array.isArray(rows)) fail(`${y + 1}段目が行の並び（["..", ".."]）になっていません`);
      rows.forEach((row, r) => {
        [...String(row)].forEach((ch, x) => {
          if (ch === '.' || ch === ' ' || ch === '_') return;
          if (!(ch in map)) fail(`${y + 1}段目 ${r + 1}行目の「${ch}」が colors にありません`);
          out.push([x, y, rows.length - 1 - r, map[ch]]);   // 1 行目が奥、最後の行が手前（z=0）
        });
      });
    });
    return out;
  }

  // 立方体 → 部品。段ごとに、偶数段は横（x）長、奇数段は奥行き（z）長を先に試す
  function bricksFromCubes(cubes) {
    const at = new Map();
    for (const [x, y, z, c] of cubes) at.set(`${x},${y},${z}`, c);
    const ys = [...new Set(cubes.map(c => c[1]))].sort((a, b) => a - b), bricks = [];
    for (const y of ys) {
      const cells = cubes.filter(c => c[1] === y).sort((a, b) => a[2] - b[2] || a[0] - b[0]);
      const used = new Set();
      for (const [x, , z, c] of cells) {
        if (used.has(`${x},${z}`)) continue;
        const tries = [];
        for (const [s, l] of RECTS) {
          const along = [[l, s, 'x'], [s, l, 'z']];   // [x の幅, z の幅, 長い向き]
          tries.push(...(y % 2 ? along.reverse() : along));
        }
        for (const [w, d, dir] of tries) {
          const part = [];
          for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) part.push([x + dx, z + dz]);
          if (!part.every(([px, pz]) => at.get(`${px},${y},${pz}`) === c && !used.has(`${px},${pz}`))) continue;
          part.forEach(([px, pz]) => used.add(`${px},${pz}`));
          const s = Math.min(w, d), l = Math.max(w, d);
          bricks.push({ y, shape: s === l ? `${s}x${l}` : `${s}x${l}${dir}`, col: c, cells: part.map(([px, pz]) => [px, y, pz]) });
          break;
        }
      }
    }
    return bricks;
  }

  // 位置を 0 始まりにそろえて、大きさを測る
  function normalize(cubes) {
    if (!cubes.length) fail('ブロックが 1 個もありません');
    if (cubes.length > MAX_CUBES) fail(`ブロックが多すぎます（${cubes.length}個。${MAX_CUBES}個まで）`);
    const min = i => Math.min(...cubes.map(c => c[i]));
    const [mx, my, mz] = [min(0), min(1), min(2)];
    const seen = new Set(), out = [];
    cubes.forEach((c, i) => {
      const [x, y, z] = [c[0] - mx, c[1] - my, c[2] - mz].map(Number);
      if (![x, y, z].every(Number.isInteger)) fail(`${i + 1}個目の位置が整数になっていません`);
      const k = `${x},${y},${z}`;
      if (seen.has(k)) return;   // 同じ場所に 2 個あったら、先のほうだけ
      seen.add(k);
      out.push([x, y, z, colorOf(c[3], `${i + 1}個目`)]);
    });
    return out;
  }

  function size(list) {
    const W = Math.max(...list.map(c => c[0])) + 1, H = Math.max(...list.map(c => c[1])) + 1, D = Math.max(...list.map(c => c[2])) + 1;
    if (W > MAX || H > MAX || D > MAX) fail(`大きすぎます（横${W}×奥行き${D}×高さ${H}。どれも${MAX}まで）`);
    return { W, H, D };
  }

  function parse(text) {
    const d = toJson(text);
    const name = String(d.name || '読み込んだ作品').slice(0, 30);
    let bricks, cubes;
    if (Array.isArray(d.bricks)) {
      // 組立データ：そのまま使う（形と色だけ確かめる）
      if (!d.bricks.length) fail('bricks が空です');
      cubes = [];
      bricks = d.bricks.map((b, i) => {
        if (!Array.isArray(b.cells) || !b.cells.length || typeof b.shape !== 'string') fail(`${i + 1}個目の部品に shape か cells がありません`);
        const col = colorOf(b.col, `${i + 1}個目の部品`);
        b.cells.forEach(c => cubes.push([c[0], c[1], c[2], col]));
        return { y: b.cells[0][1], shape: b.shape, col, cells: b.cells };
      });
      size(cubes.map(c => c.map(Number)));
      if (cubes.length > MAX_CUBES) fail(`ブロックが多すぎます（${cubes.length}個。${MAX_CUBES}個まで）`);
    } else {
      cubes = normalize(Array.isArray(d.boxes) ? cubesFromBoxes(d.boxes) : Array.isArray(d.cubes) ? d.cubes : cubesFromLayers(d));
      bricks = bricksFromCubes(cubes);
    }
    const { W, H, D } = size(bricks.flatMap(b => b.cells));
    const palette = Object.fromEntries([...new Set(bricks.map(b => b.col))].map(c => [c, COLORS[c]]));
    // 下に何もないブロック（宙に浮いたところ）を数える。組立ガイドでは下から差し込む手順になる
    const occ = new Set(bricks.flatMap(b => b.cells.map(c => c.join())));
    const floating = bricks.filter(b => b.y > 0 && !b.cells.some(([x, y, z]) => occ.has([x, y - 1, z].join()))).length;
    return { name, plan: { H, W, D, aspect: 1.0, palette, bricks }, floating };
  }

  // 読み込んだ作品をこのタブに置く／取り出す（タブを閉じたら消える）
  const keep = r => sessionStorage.setItem(KEY, JSON.stringify(r));
  const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } };

  // 作品ファイルとして保存する（3D 組立ガイドでも投稿サイトでも読める形＝組立データ）
  function save(name, plan) {
    const file = { name, H: plan.H, W: plan.W, D: plan.D, aspect: 1.0, palette: plan.palette, bricks: plan.bricks };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
    a.download = `${name}_naoblock.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---- 投稿サイト（post.naoblock.jp）の作品：?post=12 ----
  // GAS から JSONP で読む（<script> で読むので、組立ガイドのほかの部分より先に作品がそろう）
  const POST = {
    GAS_URL: '',   // 投稿サイトの GAS（…/exec）。投稿サイトの config.js と同じ URL
    SITE: 'https://post.naoblock.jp/',
  };
  function writePosted(id, CH) {
    window.NB_POSTED = j => {
      if (!j || !j.ok) return failPosted(j && j.error);
      const d = j.work.data;
      window.PLAN = { H: d.H, W: d.W, D: d.D, aspect: 1.0, palette: Object.fromEntries(d.colors.map(c => [c, COLORS[c]])), bricks: d.bricks };
      CH.name = j.work.name; CH.author = j.work.author;
    };
    window.NB_POSTED_FAIL = () => failPosted();
    if (!POST.GAS_URL) return failPosted('投稿サイトの準備中です');
    document.write(`<script src="${POST.GAS_URL}?action=get&id=${id}&callback=NB_POSTED" onerror="NB_POSTED_FAIL()"><\/script>`);
  }
  function failPosted(msg) {
    alert(`投稿作品を開けませんでした${msg ? `：${msg}` : ''}`);
    location.replace(POST.SITE);
  }

  window.NB_UPLOAD = { parse, keep, load, save, writePosted, POST, COLORS };
})();
