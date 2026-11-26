// The CLI's own ZIP reader (RELEASE_FORMAT 15.3 D1–D3, E1; SECURITY_MODEL 11 V3–V5). fflate's unzip API does not
// expose external attributes, so the End of Central Directory and the central directory are parsed here, every local
// header is cross-checked against its central record, and each entry is inflated with fflate's streaming `Inflate`
// under a hard byte cap (the declared size), so an archive bomb is stopped while inflating. Pure (no file system).
import { MAX_COMPRESSION_RATIO } from '@aymu/domain/limits';
import { Inflate } from 'fflate';
import { crc32 } from './crc32';

export interface ZipEntry {
  readonly name: string;
  readonly method: 0 | 8;
  readonly flags: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  /** High byte of "version made by" (3 = Unix). */
  readonly hostOs: number;
  readonly externalAttributes: number;
}

export class ZipFormatError extends Error {}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;

function u16(b: Uint8Array, o: number): number {
  if (o + 2 > b.length) throw new ZipFormatError('truncated archive');
  return (b[o] as number) | ((b[o + 1] as number) << 8);
}
function u32(b: Uint8Array, o: number): number {
  if (o + 4 > b.length) throw new ZipFormatError('truncated archive');
  return (
    ((b[o] as number) | ((b[o + 1] as number) << 8) | ((b[o + 2] as number) << 16) | ((b[o + 3] as number) << 24)) >>> 0
  );
}

const decoder = new TextDecoder('utf-8', { fatal: true });

/** D1: EOCD and the central directory. Rejects ZIP64, multi-disk, encryption and unknown methods. */
export function readCentralDirectory(zip: Uint8Array): ZipEntry[] {
  if (zip.length < 22) throw new ZipFormatError('too small to be a ZIP archive');
  // The EOCD is the last 22 bytes when there is no archive comment (we never write one); search the max comment span.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i -= 1) {
    if (u32(zip, i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipFormatError('no end of central directory');
  if (u16(zip, eocd + 20) !== 0 || eocd + 22 !== zip.length)
    throw new ZipFormatError('archive comment or trailing data');
  if (eocd >= 20 && u32(zip, eocd - 20) === ZIP64_LOCATOR_SIG) throw new ZipFormatError('ZIP64 is not accepted');
  const disk = u16(zip, eocd + 4);
  const cdDisk = u16(zip, eocd + 6);
  const entriesOnDisk = u16(zip, eocd + 8);
  const total = u16(zip, eocd + 10);
  const cdSize = u32(zip, eocd + 12);
  const cdOffset = u32(zip, eocd + 16);
  if (disk !== 0 || cdDisk !== 0 || entriesOnDisk !== total)
    throw new ZipFormatError('multi-disk archives are not accepted');
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff)
    throw new ZipFormatError('ZIP64 is not accepted');
  if (cdOffset + cdSize !== eocd) throw new ZipFormatError('central directory does not end at the EOCD');

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  while (p < eocd) {
    if (u32(zip, p) !== CEN_SIG) throw new ZipFormatError('bad central directory record');
    const madeBy = u16(zip, p + 4);
    const flags = u16(zip, p + 8);
    const method = u16(zip, p + 10);
    const crc = u32(zip, p + 16);
    const compressedSize = u32(zip, p + 20);
    const uncompressedSize = u32(zip, p + 24);
    const nameLen = u16(zip, p + 28);
    const extraLen = u16(zip, p + 30);
    const commentLen = u16(zip, p + 32);
    const diskStart = u16(zip, p + 34);
    const external = u32(zip, p + 38);
    const localHeaderOffset = u32(zip, p + 42);
    if (flags & 0x1) throw new ZipFormatError('encrypted entries are not accepted');
    if (method !== 0 && method !== 8) throw new ZipFormatError(`compression method ${String(method)} is not accepted`);
    if (diskStart !== 0) throw new ZipFormatError('multi-disk archives are not accepted');
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new ZipFormatError('ZIP64 is not accepted');
    }
    const nameBytes = zip.subarray(p + 46, p + 46 + nameLen);
    let name: string;
    try {
      name = decoder.decode(nameBytes);
    } catch {
      throw new ZipFormatError('entry name is not valid UTF-8');
    }
    entries.push({
      name,
      method,
      flags,
      crc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      hostOs: madeBy >>> 8,
      externalAttributes: external,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (p !== eocd) throw new ZipFormatError('central directory overruns');
  if (entries.length !== total) throw new ZipFormatError('central directory count differs from the entries walked');
  return entries;
}

/** D3: the Unix file type from the external attributes (when the host is Unix), else regular. */
export function unixFileType(entry: ZipEntry): 'regular' | 'directory' | 'symlink' | 'other' {
  if (entry.hostOs !== 3) return entry.name.endsWith('/') ? 'directory' : 'regular';
  const mode = entry.externalAttributes >>> 16;
  const type = mode & 0o170000;
  if (type === 0 || type === 0o100000) return 'regular';
  if (type === 0o040000) return 'directory';
  if (type === 0o120000) return 'symlink';
  return 'other';
}

/** D3: the local header agrees with the central record; returns where the entry's data starts. */
export function localDataOffset(zip: Uint8Array, entry: ZipEntry): number {
  const o = entry.localHeaderOffset;
  if (u32(zip, o) !== LOC_SIG) throw new ZipFormatError(`bad local header for ${entry.name}`);
  const flags = u16(zip, o + 6);
  const method = u16(zip, o + 8);
  const nameLen = u16(zip, o + 26);
  const extraLen = u16(zip, o + 28);
  const name = new TextDecoder().decode(zip.subarray(o + 30, o + 30 + nameLen));
  if (name !== entry.name || method !== entry.method || (flags & 0x1) !== 0) {
    throw new ZipFormatError(`local header differs from the central record for ${entry.name}`);
  }
  // Data descriptors (bit 3) put sizes after the data; release objects never use them (RELEASE_FORMAT 8).
  if (flags & 0x8) throw new ZipFormatError(`data descriptors are not accepted (${entry.name})`);
  if (
    u32(zip, o + 14) !== entry.crc ||
    u32(zip, o + 18) !== entry.compressedSize ||
    u32(zip, o + 22) !== entry.uncompressedSize
  ) {
    throw new ZipFormatError(`local header sizes differ from the central record for ${entry.name}`);
  }
  const start = o + 30 + nameLen + extraLen;
  if (start + entry.compressedSize > zip.length) throw new ZipFormatError(`entry data overruns for ${entry.name}`);
  return start;
}

/** The compression-ratio bomb heuristic on the declared sizes (RELEASE_FORMAT 9). */
export function ratioOk(entry: ZipEntry): boolean {
  if (entry.uncompressedSize === 0) return true;
  if (entry.compressedSize === 0) return false;
  return entry.uncompressedSize / entry.compressedSize <= MAX_COMPRESSION_RATIO;
}

/**
 * E1: inflates one entry, never producing more than `entry.uncompressedSize` bytes (the stream is abandoned at the
 * first byte over), then checks the exact size and the CRC-32.
 */
export function inflateEntry(zip: Uint8Array, entry: ZipEntry): Uint8Array {
  const start = localDataOffset(zip, entry);
  const data = zip.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.uncompressedSize)
      throw new ZipFormatError(`stored size mismatch for ${entry.name}`);
    const copy = data.slice();
    if (crc32(copy) !== entry.crc) throw new ZipFormatError(`CRC mismatch for ${entry.name}`);
    return copy;
  }
  const out = new Uint8Array(entry.uncompressedSize);
  let written = 0;
  let overflow = false;
  const inflater = new Inflate((chunk) => {
    if (overflow) return;
    if (written + chunk.length > out.length) {
      overflow = true;
      return;
    }
    out.set(chunk, written);
    written += chunk.length;
  });
  const CHUNK = 64 * 1024;
  for (let i = 0; i < data.length && !overflow; i += CHUNK) {
    inflater.push(data.subarray(i, Math.min(data.length, i + CHUNK)), i + CHUNK >= data.length);
  }
  if (overflow) throw new ZipFormatError(`entry inflates beyond its declared size: ${entry.name}`);
  if (written !== out.length) throw new ZipFormatError(`entry inflates to fewer bytes than declared: ${entry.name}`);
  if (crc32(out) !== entry.crc) throw new ZipFormatError(`CRC mismatch for ${entry.name}`);
  return out;
}
