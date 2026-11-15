#!/usr/bin/env node
/**
 * 零依赖 ZIP 写入器（只用 Node 内置 zlib）
 * ================================================================
 * 为什么需要它
 * ----------
 * 本工作区路径 `D:\新建文件夹\...` 含中文。用外部进程压缩时，
 * `powershell.exe -Command` 的参数会按系统 ANSI 代码页（GBK）解码，
 * 中文路径变成 mojibake，Node 侧再用 UTF-8 路径 statSync 就 ENOENT；
 * 且 `Compress-Archive -LiteralPath 'dir\*'` 不展开通配符。
 *
 * 这里直接把文件读进内存，用 Node 内置 zlib 写标准 ZIP：
 *   · 全程不 spawn 任何进程 → 无任何编码/引号/代码页问题
 *   · 文件名以 UTF-8 写入并置 general purpose bit 11 (0x0800)
 *     → Windows 资源管理器 / 7-Zip / Python zipfile 解压均不乱码
 *   · deflate(level 9)，对已压缩资源自动退化为 store，避免越压越大
 *   · 标准 Local Header + Central Directory + EOCD，CRC-32 逐条计算
 *
 * 用法：const { createZip } = require('./lib/zip_writer');
 *       fs.writeFileSync(out, createZip([{ name, data, mtime }]));
 */
'use strict';

const zlib = require('zlib');

/* ---------------- CRC-32 (IEEE 802.3) ---------------- */
let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}
function crc32(buf) {
  const t = crcTable();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* ---------------- MS-DOS 时间戳 ---------------- */
function dosDateTime(d) {
  const dt = (d instanceof Date && !isNaN(d.getTime())) ? d : new Date();
  const year = Math.min(2107, Math.max(1980, dt.getFullYear()));
  const time = (dt.getHours() << 11) | (dt.getMinutes() << 5) | (dt.getSeconds() >> 1);
  const date = ((year - 1980) << 9) | ((dt.getMonth() + 1) << 5) | dt.getDate();
  return { time, date };
}

/**
 * @param {Array<{name:string, data:Buffer|string, mtime?:Date}>} entries
 *        name 用 `/` 或 `\` 分隔均可，内部统一为 `/`
 * @returns {Buffer} 一份完整的 ZIP 文件字节
 */
function createZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(String(e.name).split('\\').join('/'), 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useStore = deflated.length >= raw.length;
    const payload = useStore ? raw : deflated;
    const method = useStore ? 0 : 8;
    const crc = crc32(raw);
    const { time, date } = dosDateTime(e.mtime);

    /* --- Local file header (30 bytes) --- */
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);   // signature
    lh.writeUInt16LE(20, 4);           // version needed to extract (2.0)
    lh.writeUInt16LE(0x0800, 6);       // flags: UTF-8 filenames
    lh.writeUInt16LE(method, 8);       // 0=store, 8=deflate
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(payload.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);           // extra field length
    locals.push(lh, nameBuf, payload);

    /* --- Central directory file header (46 bytes) --- */
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);   // signature
    ch.writeUInt16LE(0x031E, 4);        // made by: UNIX / ZIP 3.0
    ch.writeUInt16LE(20, 6);            // needed: 2.0
    ch.writeUInt16LE(0x0800, 8);        // flags: UTF-8 filenames
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(payload.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);            // extra
    ch.writeUInt16LE(0, 32);            // comment
    ch.writeUInt16LE(0, 34);            // disk number start
    ch.writeUInt16LE(0, 36);            // internal attrs
    ch.writeUInt32LE(0, 38);            // external attrs
    ch.writeUInt32LE(offset, 42);       // relative offset of local header
    centrals.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(centrals);

  /* --- End of central directory record (22 bytes) --- */
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);                    // number of this disk
  eocd.writeUInt16LE(0, 6);                    // disk with CD
  eocd.writeUInt16LE(entries.length, 8);       // entries on this disk
  eocd.writeUInt16LE(entries.length, 10);      // total entries
  eocd.writeUInt32LE(centralBuf.length, 12);   // size of CD
  eocd.writeUInt32LE(offset, 16);              // offset of CD
  eocd.writeUInt16LE(0, 20);                   // comment length

  return Buffer.concat([...locals, centralBuf, eocd]);
}

module.exports = { createZip, crc32 };
