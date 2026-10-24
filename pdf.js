// JPEG の絵を 1 ページに 1 枚ずつ入れた PDF を組み立てる（外部ライブラリなし）。
// PDF は JPEG をそのまま埋め込める（/DCTDecode）ので、絵のバイト列をそのまま入れるだけ。
// pages: [{ jpeg: Uint8Array, width, height }]（width・height は絵のピクセル数）
// 用紙は A4 縦（595.28 × 841.89 pt）。絵を用紙いっぱいに置く
const A4_W = 595.28, A4_H = 841.89;

export function buildPdf(pages) {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (data) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n, body) => { offsets[n] = length; push(`${n} 0 obj\n`); for (const b of body) push(b); push('\nendobj\n'); };

  push('%PDF-1.4\n');
  // 1: カタログ、2: ページの一覧、ページ k は 3 + 3k（ページ）・4 + 3k（中身）・5 + 3k（絵）
  const kids = pages.map((_, k) => `${3 + 3 * k} 0 R`).join(' ');
  obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  obj(2, [`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`]);
  pages.forEach((p, k) => {
    const page = 3 + 3 * k, content = page + 1, image = page + 2;
    obj(page, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W} ${A4_H}] /Resources << /XObject << /Im${k} ${image} 0 R >> >> /Contents ${content} 0 R >>`]);
    const draw = `q ${A4_W} 0 0 ${A4_H} 0 0 cm /Im${k} Do Q`;
    obj(content, [`<< /Length ${draw.length} >>\nstream\n`, draw, '\nendstream']);
    obj(image, [
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      p.jpeg,
      '\nendstream',
    ]);
  });
  const count = 3 + 3 * pages.length;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

// data URL（base64）→ バイト列
export function dataUrlBytes(dataUrl) {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
