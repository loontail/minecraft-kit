import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";
import { crc32 } from "node:zlib";

/** One entry to place in a fixture archive. */
export type ZipFixtureEntry = {
  readonly name: string;
  readonly content?: string | Uint8Array;
};

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const VERSION = 20;
const METHOD_STORED = 0;

/**
 * Build a zip archive with stored (uncompressed) entries and write it to `filePath`.
 *
 * Written by hand rather than with a zip library because the security tests need entry
 * names that no well-behaved writer would emit (reserved Windows device names, trailing
 * dots, traversal attempts).
 */
export const writeFixtureZip = async (
  filePath: string,
  entries: readonly ZipFixtureEntry[],
): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, fixtureZipBytes(entries));
};

/** Same archive as {@link writeFixtureZip}, returned as bytes so it can be served over HTTP. */
export const fixtureZipBytes = (entries: readonly ZipFixtureEntry[]): Buffer => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const data = toBuffer(entry.content);
    const checksum = crc32(data);
    locals.push(localHeader(nameBytes, data, checksum), data);
    centrals.push(centralHeader(nameBytes, data, checksum, offset));
    offset += 30 + nameBytes.length + data.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  return Buffer.concat([
    ...locals,
    centralDirectory,
    endOfCentralDirectory(entries.length, centralDirectory.length, offset),
  ]);
};

const toBuffer = (content: string | Uint8Array | undefined): Buffer => {
  if (content === undefined) return Buffer.alloc(0);
  return typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
};

const localHeader = (nameBytes: Buffer, data: Buffer, checksum: number): Buffer => {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(VERSION, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(METHOD_STORED, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBytes]);
};

const centralHeader = (
  nameBytes: Buffer,
  data: Buffer,
  checksum: number,
  localOffset: number,
): Buffer => {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(VERSION, 4);
  header.writeUInt16LE(VERSION, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(METHOD_STORED, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(data.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(localOffset, 42);
  return Buffer.concat([header, nameBytes]);
};

const endOfCentralDirectory = (
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
): Buffer => {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(entryCount, 8);
  record.writeUInt16LE(entryCount, 10);
  record.writeUInt32LE(centralDirectorySize, 12);
  record.writeUInt32LE(centralDirectoryOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
};
