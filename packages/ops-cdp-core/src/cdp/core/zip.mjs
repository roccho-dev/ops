// 最小 ZIP read/write(node zlib ベース、stdlib のみ)。
// 脱python: chromium-cdp-{inspect,recover}-artifact の zipfile 依存を置換する。
// バイト一致ではなく機能等価(同一 entry 名・同一内容)を保証する。
import * as fs from "node:fs";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// --- READ ---
function findEocd(buf) {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error("zip: EOCD not found");
}

// 中央ディレクトリを解析して entry メタ一覧を返す。
export function entries(zipPath) {
  const buf = fs.readFileSync(zipPath);
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const list = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error("zip: bad central dir");
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const uncompSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const externalAttr = buf.readUInt32LE(off + 38);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    list.push({ name, method, compSize, uncompSize, localOff, externalAttr });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return list;
}

export function namelist(zipPath) {
  return entries(zipPath).map((e) => e.name);
}

// size マップ(inspect 用): { name, size }
export function entrySizes(zipPath) {
  return entries(zipPath).map((e) => ({ name: e.name, size: e.uncompSize }));
}

// 指定 entry の生バイトを返す。
export function readEntry(zipPath, name) {
  const buf = fs.readFileSync(zipPath);
  const meta = entries(zipPath).find((e) => e.name === name);
  if (!meta) return null;
  // local header から実データ位置を求める(local header の name/extra 長を使う)
  const lo = meta.localOff;
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error("zip: bad local header");
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const dataStart = lo + 30 + nameLen + extraLen;
  const comp = buf.subarray(dataStart, dataStart + meta.compSize);
  if (meta.method === 0) return Buffer.from(comp);
  if (meta.method === 8) return inflateRawSync(comp);
  throw new Error(`zip: unsupported method ${meta.method}`);
}

export function has(zipPath, name) {
  return entries(zipPath).some((e) => e.name === name);
}

// --- WRITE ---
// items: [{ name, data(Buffer|string), externalAttr? }]
// date_time は決定的に 1980-01-01 00:00:00(python の date_time=(1980,1,1,...) 相当)。
const DOS_DATE = (1 << 5) | 1; // year 1980, month 1, day 1
const DOS_TIME = 0;

export function writeZip(outPath, items) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const it of items) {
    const data = Buffer.isBuffer(it.data) ? it.data : Buffer.from(String(it.data), "utf8");
    const nameBuf = Buffer.from(it.name, "utf8");
    const crc = crc32(data);
    const comp = deflateRawSync(data);
    const method = 8;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);          // version needed
    lh.writeUInt16LE(0, 6);           // flags
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);          // extra len
    locals.push(lh, nameBuf, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);          // version made by
    ch.writeUInt16LE(20, 6);          // version needed
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);          // extra
    ch.writeUInt16LE(0, 32);          // comment
    ch.writeUInt16LE(0, 34);          // disk
    ch.writeUInt16LE(0, 36);          // internal attr
    ch.writeUInt32LE(it.externalAttr >>> 0 || 0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + comp.length;
  }
  const localBlob = Buffer.concat(locals);
  const centralBlob = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(items.length, 8);
  eocd.writeUInt16LE(items.length, 10);
  eocd.writeUInt32LE(centralBlob.length, 12);
  eocd.writeUInt32LE(localBlob.length, 16);
  fs.writeFileSync(outPath, Buffer.concat([localBlob, centralBlob, eocd]));
}

export default { entries, namelist, entrySizes, readEntry, has, writeZip };
