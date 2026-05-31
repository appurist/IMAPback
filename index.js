#!/usr/bin/env bun
import tls from "node:tls";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import { join } from "node:path";

function usage() {
  return [
    "Usage: bun run index.js <hostname> [password] --user <username> [--port <port>] [--folders] [--counts] [--search <text>] [--list [folder]] [--date <range>] [--output <dir>] [--restore <dir> --restore-folder <folder>] [--dry-run]",
    "",
    "Options:",
    "  config.cfg          Optional defaults file in the current directory",
    "  --config, -c <file> Defaults file path, default ./config.cfg",
    "  --user <username>   IMAP username, or set IMAPSAVE_USER",
    "  --connect-host <host> Connect to this host/IP while using hostname for TLS SNI",
    "  --port <port>       IMAPS TLS port, default 993",
    "  --folders           List all folders",
    "  --counts            Report message counts for each folder",
    "  --search, -s <text> Filter folder rows by case-insensitive folder name match",
    "  --list, -l          List Date, From, and Subject for messages in one matching folder",
    "  --date, -d <range>  Filter --list by Date header; use YYYYMMDD, YYYYMMDD-YYYYMMDD, YYYYMMDD-, or -YYYYMMDD",
    "  --output, -o <dir>  Save all folders and messages under this local directory",
    "  --restore <dir>     Restore .eml files from this local directory",
    "  --restore-folder <folder> Destination folder for restored messages",
    "  --dry-run           Preview restore actions without creating folders or appending messages",
    "  --help              Show this help"
  ].join("\n");
}

function findConfigPath(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config" || arg === "-c") {
      return argv[index + 1] ?? null;
    }
    if (arg.startsWith("--config=")) {
      return arg.slice("--config=".length);
    }
  }
  return "config.cfg";
}

async function loadConfigDefaults(path) {
  if (!existsSync(path)) {
    return {};
  }
  const config = JSON.parse(await readFile(path, "utf8"));
  return {
    hostname: config.hostname ?? config.host ?? null,
    connectHost: config.connectHost ?? config.connect_host ?? null,
    password: config.password ?? null,
    port: config.port,
    folders: config.folders,
    counts: config.counts,
    list: config.list,
    date: config.date,
    search: config.search,
    output: config.output,
    restore: config.restore,
    restoreFolder: config.restoreFolder ?? config.restore_folder,
    dryRun: config.dryRun ?? config.dry_run,
    user: config.user ?? config.username ?? null
  };
}

async function parseArgs(argv) {
  const configPath = findConfigPath(argv);
  if (!configPath) {
    throw new Error("--config requires a file path");
  }
  const defaults = await loadConfigDefaults(configPath);
  const options = {
    port: defaults.port ?? 993,
    folders: defaults.folders ?? false,
    counts: defaults.counts ?? false,
    list: defaults.list ?? null,
    date: defaults.date ?? null,
    search: defaults.search ?? null,
    output: defaults.output ?? null,
    restore: defaults.restore ?? null,
    restoreFolder: defaults.restoreFolder ?? null,
    dryRun: defaults.dryRun ?? false,
    connectHost: defaults.connectHost ?? null,
    user: process.env.IMAPSAVE_USER ?? defaults.user ?? null
  };
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--folders") {
      options.folders = true;
    } else if (arg === "--counts") {
      options.counts = true;
    } else if (arg === "--list" || arg === "-l") {
      const next = argv[index + 1];
      if (next && !next.startsWith("-")) {
        options.list = next;
        index += 1;
      } else {
        options.list = true;
      }
    } else if (arg.startsWith("--list=")) {
      options.list = arg.slice("--list=".length);
    } else if (arg === "--date" || arg === "-d") {
      options.date = argv[++index] ?? null;
    } else if (arg.startsWith("--date=")) {
      options.date = arg.slice("--date=".length);
    } else if (arg.startsWith("-d=")) {
      options.date = arg.slice("-d=".length);
    } else if (arg === "--search" || arg === "-s") {
      options.search = argv[++index] ?? null;
    } else if (arg.startsWith("--search=")) {
      options.search = arg.slice("--search=".length);
    } else if (arg === "--config" || arg === "-c") {
      index += 1;
    } else if (arg.startsWith("--config=")) {
      continue;
    } else if (arg === "--port") {
      options.port = Number(argv[++index]);
    } else if (arg.startsWith("--port=")) {
      options.port = Number(arg.slice("--port=".length));
    } else if (arg === "--connect-host") {
      options.connectHost = argv[++index] ?? null;
    } else if (arg.startsWith("--connect-host=")) {
      options.connectHost = arg.slice("--connect-host=".length);
    } else if (arg === "--user") {
      options.user = argv[++index] ?? null;
    } else if (arg.startsWith("--user=")) {
      options.user = arg.slice("--user=".length);
    } else if (arg === "--output" || arg === "-o") {
      options.output = argv[++index] ?? null;
    } else if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length);
    } else if (arg === "--restore") {
      options.restore = argv[++index] ?? null;
    } else if (arg.startsWith("--restore=")) {
      options.restore = arg.slice("--restore=".length);
    } else if (arg === "--restore-folder") {
      options.restoreFolder = argv[++index] ?? null;
    } else if (arg.startsWith("--restore-folder=")) {
      options.restoreFolder = arg.slice("--restore-folder=".length);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  options.hostname = positionals[0] ?? defaults.hostname ?? null;
  options.password = positionals[1] ?? process.env.IMAPSAVE_PASSWORD ?? defaults.password ?? null;
  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
    throw new Error("Invalid --port value");
  }
  if (options.restore && !options.restoreFolder) {
    throw new Error("--restore-folder is required with --restore");
  }
  if (options.restoreFolder && !options.restore) {
    throw new Error("--restore is required with --restore-folder");
  }
  options.dateFilter = parseDateFilter(options.date);
  return options;
}

function quoteImap(value) {
  return `"${`${value ?? ""}`.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function quoteDisplay(value) {
  const text = `${value ?? ""}`;
  return `'${text.replace(/'/g, "''")}'`;
}

function rawDisplay(value) {
  return `${value ?? ""}`.replace(/\r?\n/g, " ");
}

function parseDatePart(value) {
  const match = `${value ?? ""}`.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid date value: ${value}; expected YYYYMMDD`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error(`Invalid date value: ${value}; expected YYYYMMDD`);
  }
  return date;
}

function parseDateFilter(value) {
  if (!value) {
    return null;
  }
  const text = `${value}`;
  const separator = text.indexOf("-");
  const fromText = separator === -1 ? text : text.slice(0, separator);
  const toText = separator === -1 ? "" : text.slice(separator + 1);
  if (!fromText && !toText) {
    throw new Error("Invalid --date range; expected YYYYMMDD, YYYYMMDD-YYYYMMDD, YYYYMMDD-, or -YYYYMMDD");
  }
  const from = fromText ? parseDatePart(fromText) : null;
  const to = toText ? parseDatePart(toText) : null;
  if (from && to && from >= to) {
    throw new Error("Invalid --date range; from date must be before to date");
  }
  return { from, to, text };
}

function messageMatchesDateFilter(dateHeader, filter) {
  if (!filter) {
    return true;
  }
  const value = Date.parse(decodeMimeWords(dateHeader));
  if (!Number.isFinite(value)) {
    return false;
  }
  if (filter.from && value < filter.from.getTime()) {
    return false;
  }
  if (filter.to && value >= filter.to.getTime()) {
    return false;
  }
  return true;
}

function decodeQEncoded(value) {
  const bytes = [];
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "_") {
      bytes.push(0x20);
    } else if (char === "=" && /^[0-9A-Fa-f]{2}$/.test(value.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(value.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(char.charCodeAt(0));
    }
  }
  return Buffer.from(bytes);
}

function decodeBytes(buffer, charset) {
  const normalized = charset.toLowerCase();
  if (normalized === "utf-8" || normalized === "utf8" || normalized === "us-ascii" || normalized === "ascii") {
    return new TextDecoder("utf-8").decode(buffer);
  }
  if (normalized === "iso-8859-1" || normalized === "latin1" || normalized === "latin-1") {
    return new TextDecoder("latin1").decode(buffer);
  }
  try {
    return new TextDecoder(normalized).decode(buffer);
  } catch {
    return buffer.toString("utf8");
  }
}

function decodeMimeWords(value) {
  return `${value ?? ""}`
    .replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=(?:\s+(?==\?[^?]+\?[bqBQ]\?[^?]*\?=))?/g, (_match, charset, encoding, body) => {
      const bytes = encoding.toUpperCase() === "B"
        ? Buffer.from(body, "base64")
        : decodeQEncoded(body);
      return decodeBytes(bytes, charset);
    });
}

function formatCountLine(count, folder, showSubscription) {
  return `${`${count ?? 0}`.padStart(6, " ")}\t${quoteDisplay(folder.displayName)}\t${displayAttributes(folder, showSubscription)}`;
}

function formatBackupLine(folderName, messages, saved, skipped, errors) {
  const parts = [`${folderName}\t${messages} messages`];
  if (saved !== messages) {
    parts.push(`${saved} saved`);
  }
  if (skipped !== 0) {
    parts.push(`${skipped} skipped`);
  }
  if (errors !== 0) {
    parts.push(`${errors} errors`);
  }
  return parts.join("\t");
}

function parseAString(input, start = 0) {
  let index = start;
  while (index < input.length && input[index] === " ") {
    index += 1;
  }
  if (index >= input.length) {
    return null;
  }
  if (input[index] === '"') {
    let value = "";
    index += 1;
    while (index < input.length) {
      const char = input[index];
      if (char === "\\") {
        value += input[index + 1] ?? "";
        index += 2;
        continue;
      }
      if (char === '"') {
        return { value, nextIndex: index + 1 };
      }
      value += char;
      index += 1;
    }
    return null;
  }
  const begin = index;
  while (index < input.length && input[index] !== " ") {
    index += 1;
  }
  return { value: input.slice(begin, index), nextIndex: index };
}

function decodeUtf16Be(buffer) {
  let result = "";
  for (let index = 0; index + 1 < buffer.length; index += 2) {
    result += String.fromCharCode(buffer.readUInt16BE(index));
  }
  return result;
}

function decodeModifiedUtf7(value) {
  return `${value ?? ""}`.replace(/&([^-]*)-/g, (match, encoded) => {
    if (encoded === "") {
      return "&";
    }
    const base64 = encoded.replace(/,/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    try {
      return decodeUtf16Be(Buffer.from(padded, "base64"));
    } catch {
      return match;
    }
  });
}

function splitTopLevel(value) {
  const items = [];
  let current = "";
  let depth = 0;
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quoted) {
      current += char;
      if (char === "\\") {
        current += value[index + 1] ?? "";
        index += 1;
      } else if (char === '"') {
        quoted = false;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      current += char;
      continue;
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    }
    if (char === " " && depth === 0) {
      if (current) {
        items.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) {
    items.push(current);
  }
  return items;
}

function parseListLine(line) {
  const match = line.match(/^\* LIST\s+\((.*?)\)\s+(.+)$/i);
  if (!match) {
    return null;
  }
  const delimiter = parseAString(match[2]);
  const mailbox = delimiter ? parseAString(match[2], delimiter.nextIndex) : null;
  if (!mailbox) {
    return null;
  }
  return {
    attributes: match[1] ? splitTopLevel(match[1]) : [],
    delimiter: delimiter.value === "NIL" ? null : delimiter.value,
    name: mailbox.value,
    displayName: decodeModifiedUtf7(mailbox.value)
  };
}

function parseStatusLine(line) {
  const match = line.match(/^\* STATUS\s+(?:"((?:\\.|[^"])*)"|([^ ]+))\s+\((.*)\)$/i);
  if (!match) {
    return null;
  }
  const values = splitTopLevel(match[3]);
  const status = {
    name: (match[1] ?? match[2]).replace(/\\"/g, '"').replace(/\\\\/g, "\\")
  };
  for (let index = 0; index < values.length; index += 2) {
    status[values[index].toLowerCase()] = Number(values[index + 1]);
  }
  return status;
}

function safePathPart(value) {
  const cleaned = `${value ?? ""}`
    .replace(/[<>:"\\|?*\u0000-\u001F]/g, "_")
    .replace(/[ .]+$/g, "")
    .trim();
  return cleaned || "_";
}

function localFolderPath(root, folder) {
  const separator = folder.delimiter || "/";
  const parts = folder.displayName.split(separator).filter(Boolean).map(safePathPart);
  return join(root, ...parts);
}

function displayAttributes(folder, showSubscription) {
  const hidden = new Set(["\\HasChildren", "\\HasNoChildren", "\\UnMarked"]);
  const labels = [];
  for (const attribute of folder.attributes) {
    if (hidden.has(attribute)) {
      continue;
    }
    if (attribute === "\\Marked") {
      labels.push("MARKED");
    } else if (attribute === "\\Noselect") {
      labels.push("NOSELECT");
    } else if (attribute === "\\NonExistent") {
      labels.push("NONEXISTENT");
    } else if (attribute.startsWith("\\")) {
      labels.push(attribute.slice(1).toUpperCase());
    } else {
      labels.push(attribute);
    }
  }
  if (showSubscription) {
    labels.push(folder.subscribed ? "SUB" : "NOSUB");
  }
  return labels.join(" ");
}

function parseHeaders(raw) {
  const headers = new Map();
  let current = null;
  for (const line of `${raw ?? ""}`.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && current) {
      headers.set(current, `${headers.get(current) ?? ""} ${line.trim()}`.trim());
      continue;
    }
    const index = line.indexOf(":");
    if (index === -1) {
      continue;
    }
    current = line.slice(0, index).trim().toLowerCase();
    headers.set(current, line.slice(index + 1).trim());
  }
  return headers;
}

function folderMatches(folder, search) {
  if (!search) {
    return true;
  }
  const needle = search.toLowerCase();
  return folder.name.toLowerCase().includes(needle) || folder.displayName.toLowerCase().includes(needle);
}

function exactFolderMatches(folder, name) {
  return folder.name === name || folder.displayName === name;
}

function errorText(error) {
  return `${error?.message ?? error}`.replace(/\r?\n/g, " ");
}

function compareRestoreFiles(left, right) {
  const leftName = left.name.toLowerCase();
  const rightName = right.name.toLowerCase();
  const leftUid = Number(leftName.match(/^(\d+)\.eml$/)?.[1]);
  const rightUid = Number(rightName.match(/^(\d+)\.eml$/)?.[1]);
  const leftHasUid = Number.isInteger(leftUid);
  const rightHasUid = Number.isInteger(rightUid);
  if (leftHasUid && rightHasUid && leftUid !== rightUid) {
    return leftUid - rightUid;
  }
  if (leftHasUid !== rightHasUid) {
    return leftHasUid ? -1 : 1;
  }
  return leftName.localeCompare(rightName);
}

async function collectRestoreFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".eml"))
    .map((entry) => ({
      name: entry.name,
      path: join(directory, entry.name)
    }))
    .sort(compareRestoreFiles);
}

function parseMessageDate(message) {
  const separator = message.indexOf("\r\n\r\n");
  const fallbackSeparator = separator === -1 ? message.indexOf("\n\n") : separator;
  const headerEnd = fallbackSeparator === -1 ? Math.min(message.length, 65536) : fallbackSeparator;
  const headers = parseHeaders(message.subarray(0, headerEnd).toString("utf8"));
  const value = Date.parse(decodeMimeWords(headers.get("date") ?? ""));
  return Number.isFinite(value) ? new Date(value) : null;
}

function formatImapInternalDate(date) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  const month = months[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hours = `${date.getUTCHours()}`.padStart(2, "0");
  const minutes = `${date.getUTCMinutes()}`.padStart(2, "0");
  const seconds = `${date.getUTCSeconds()}`.padStart(2, "0");
  return `${day}-${month}-${year} ${hours}:${minutes}:${seconds} +0000`;
}

function taggedResponseOk(lines, tag) {
  const tagged = lines.find((line) => line.startsWith(`${tag} `));
  if (!new RegExp(`^${tag} OK\\b`, "i").test(tagged ?? "")) {
    throw new Error(tagged ?? "No tagged response");
  }
}

class ImapClient {
  constructor({ hostname, connectHost, port }) {
    this.hostname = hostname;
    this.connectHost = connectHost ?? hostname;
    this.port = port;
    this.tagCounter = 1;
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
  }

  async connect() {
    this.socket = tls.connect({
      host: this.connectHost,
      port: this.port,
      servername: this.hostname,
      rejectUnauthorized: true
    });
    this.socket.on("data", (chunk) => this.receive(chunk));
    this.socket.on("error", (error) => this.fail(error));
    this.socket.on("end", () => this.fail(new Error("IMAP connection ended")));
    await new Promise((resolve, reject) => {
      this.socket.once("secureConnect", resolve);
      this.socket.once("error", reject);
    });
    await this.readLinesUntil((lines) => lines.some((line) => line.startsWith("* OK")));
  }

  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (let index = 0; index < this.waiters.length; ) {
      const waiter = this.waiters[index];
      const result = waiter.tryRead();
      if (result.ready) {
        this.waiters.splice(index, 1);
        waiter.resolve(result.value);
        continue;
      }
      index += 1;
    }
  }

  fail(error) {
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) {
      waiter.reject(error);
    }
  }

  takeLine() {
    const index = this.buffer.indexOf("\r\n");
    if (index === -1) {
      return null;
    }
    const line = this.buffer.subarray(0, index).toString("utf8");
    this.buffer = this.buffer.subarray(index + 2);
    return line;
  }

  async readLine() {
    const existing = this.takeLine();
    if (existing !== null) {
      return existing;
    }
    return await new Promise((resolve, reject) => {
      this.waiters.push({
        resolve,
        reject,
        tryRead: () => {
          const line = this.takeLine();
          return line === null ? { ready: false } : { ready: true, value: line };
        }
      });
    });
  }

  async readLinesUntil(predicate) {
    const lines = [];
    while (true) {
      lines.push(await this.readLine());
      if (predicate(lines)) {
        return lines;
      }
    }
  }

  async readBytes(size) {
    if (this.buffer.length >= size) {
      const result = this.buffer.subarray(0, size);
      this.buffer = this.buffer.subarray(size);
      return result;
    }
    return await new Promise((resolve, reject) => {
      this.waiters.push({
        resolve,
        reject,
        tryRead: () => {
          if (this.buffer.length < size) {
            return { ready: false };
          }
          const result = this.buffer.subarray(0, size);
          this.buffer = this.buffer.subarray(size);
          return { ready: true, value: result };
        }
      });
    });
  }

  async readToFile(size, path) {
    const stream = createWriteStream(path, { flags: "wx" });
    let remaining = size;
    try {
      while (remaining > 0) {
        if (this.buffer.length === 0) {
          await new Promise((resolve, reject) => {
            this.waiters.push({
              resolve,
              reject,
              tryRead: () => this.buffer.length === 0 ? { ready: false } : { ready: true }
            });
          });
        }
        const chunkSize = Math.min(remaining, this.buffer.length);
        const chunk = this.buffer.subarray(0, chunkSize);
        this.buffer = this.buffer.subarray(chunkSize);
        remaining -= chunkSize;
        if (!stream.write(chunk)) {
          await new Promise((resolve, reject) => {
            stream.once("drain", resolve);
            stream.once("error", reject);
          });
        }
      }
      await new Promise((resolve, reject) => stream.end((error) => error ? reject(error) : resolve()));
    } catch (error) {
      stream.destroy();
      throw error;
    }
  }

  async command(command) {
    const tag = `A${`${this.tagCounter++}`.padStart(4, "0")}`;
    this.socket.write(`${tag} ${command}\r\n`);
    const lines = await this.readLinesUntil((items) => items.some((line) => line.startsWith(`${tag} `)));
    taggedResponseOk(lines, tag);
    return lines.filter((line) => !line.startsWith(`${tag} `));
  }

  async literalCommand(command, literal) {
    const tag = `A${`${this.tagCounter++}`.padStart(4, "0")}`;
    this.socket.write(`${tag} ${command} {${literal.length}}\r\n`);
    const continuation = await this.readLinesUntil((items) => {
      const last = items.at(-1) ?? "";
      return last.startsWith("+") || items.some((line) => line.startsWith(`${tag} `));
    });
    if (continuation.some((line) => line.startsWith(`${tag} `))) {
      taggedResponseOk(continuation, tag);
      return;
    }
    await new Promise((resolve, reject) => {
      this.socket.write(literal, (error) => error ? reject(error) : resolve());
    });
    await new Promise((resolve, reject) => {
      this.socket.write("\r\n", (error) => error ? reject(error) : resolve());
    });
    taggedResponseOk(await this.readLinesUntil((lines) => lines.some((line) => line.startsWith(`${tag} `))), tag);
  }

  async login(username, password) {
    await this.command(`LOGIN ${quoteImap(username)} ${quoteImap(password)}`);
  }

  async listFolders() {
    const lines = await this.command('LIST "" "*"');
    return lines.map(parseListLine).filter(Boolean);
  }

  async listSubscribedFolders() {
    const lines = await this.command('LSUB "" "*"');
    return lines.map(parseListLine).filter(Boolean);
  }

  async createFolder(folder) {
    await this.command(`CREATE ${quoteImap(folder)}`);
  }

  async appendMessage(folder, message, internalDate) {
    const datePart = internalDate ? ` "${formatImapInternalDate(internalDate)}"` : "";
    await this.literalCommand(`APPEND ${quoteImap(folder)}${datePart}`, message);
  }

  async status(folder) {
    const lines = await this.command(`STATUS ${quoteImap(folder)} (MESSAGES UIDVALIDITY UIDNEXT)`);
    return lines.map(parseStatusLine).find(Boolean);
  }

  async select(folder) {
    await this.command(`SELECT ${quoteImap(folder)}`);
  }

  async uidSearchAll() {
    const lines = await this.command("UID SEARCH ALL");
    const line = lines.find((item) => item.startsWith("* SEARCH")) ?? "";
    return line
      .slice("* SEARCH".length)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
      .filter((value) => Number.isInteger(value) && value > 0);
  }

  async fetchMessage(uid) {
    const tag = `A${`${this.tagCounter++}`.padStart(4, "0")}`;
    this.socket.write(`${tag} UID FETCH ${uid} (UID BODY.PEEK[])\r\n`);
    const header = await this.readLinesUntil((lines) => {
      const last = lines.at(-1) ?? "";
      return lines.some((line) => line.startsWith(`${tag} `)) || (lines.some((line) => line.startsWith("* ") && line.includes(" FETCH ")) && /\{\d+\}$/.test(last));
    });
    if (header.some((line) => line.startsWith(`${tag} `))) {
      taggedResponseOk(header, tag);
    }
    const literalSize = Number((header.at(-1) ?? "").match(/\{(\d+)\}$/)?.[1]);
    if (!Number.isFinite(literalSize)) {
      throw new Error(`Unexpected FETCH response for UID ${uid}`);
    }
    const message = await this.readBytes(literalSize);
    taggedResponseOk(await this.readLinesUntil((lines) => lines.some((line) => line.startsWith(`${tag} `))), tag);
    return message;
  }

  async fetchMessageToFile(uid, path) {
    const tag = `A${`${this.tagCounter++}`.padStart(4, "0")}`;
    this.socket.write(`${tag} UID FETCH ${uid} (UID BODY.PEEK[])\r\n`);
    const header = await this.readLinesUntil((lines) => {
      const last = lines.at(-1) ?? "";
      return lines.some((line) => line.startsWith(`${tag} `)) || (lines.some((line) => line.startsWith("* ") && line.includes(" FETCH ")) && /\{\d+\}$/.test(last));
    });
    if (header.some((line) => line.startsWith(`${tag} `))) {
      taggedResponseOk(header, tag);
    }
    const literalSize = Number((header.at(-1) ?? "").match(/\{(\d+)\}$/)?.[1]);
    if (!Number.isFinite(literalSize)) {
      throw new Error(`Unexpected FETCH response for UID ${uid}`);
    }
    await this.readToFile(literalSize, path);
    taggedResponseOk(await this.readLinesUntil((lines) => lines.some((line) => line.startsWith(`${tag} `))), tag);
  }

  async fetchHeaderFields(uid) {
    const tag = `A${`${this.tagCounter++}`.padStart(4, "0")}`;
    this.socket.write(`${tag} UID FETCH ${uid} (UID BODY.PEEK[HEADER.FIELDS (DATE FROM SUBJECT)])\r\n`);
    const header = await this.readLinesUntil((lines) => {
      const last = lines.at(-1) ?? "";
      return lines.some((line) => line.startsWith(`${tag} `)) || (lines.some((line) => line.startsWith("* ") && line.includes(" FETCH ")) && /\{\d+\}$/.test(last));
    });
    if (header.some((line) => line.startsWith(`${tag} `))) {
      taggedResponseOk(header, tag);
    }
    const literalSize = Number((header.at(-1) ?? "").match(/\{(\d+)\}$/)?.[1]);
    if (!Number.isFinite(literalSize)) {
      throw new Error(`Unexpected header FETCH response for UID ${uid}`);
    }
    const rawHeaders = (await this.readBytes(literalSize)).toString("utf8");
    taggedResponseOk(await this.readLinesUntil((lines) => lines.some((line) => line.startsWith(`${tag} `))), tag);
    const headers = parseHeaders(rawHeaders);
    return {
      uid,
      date: headers.get("date") ?? "",
      from: headers.get("from") ?? "",
      subject: headers.get("subject") ?? ""
    };
  }

  async logout() {
    try {
      await this.command("LOGOUT");
    } catch {
      this.socket?.end();
    }
  }
}

async function backupFolder(client, root, folder) {
  const destination = localFolderPath(root, folder);
  await mkdir(destination, { recursive: true });
  const status = await client.status(folder.name);
  await writeFile(join(destination, ".imap-folder.json"), JSON.stringify({
    name: folder.name,
    displayName: folder.displayName,
    delimiter: folder.delimiter,
    attributes: folder.attributes,
    messages: status?.messages ?? null,
    uidValidity: status?.uidvalidity ?? null,
    uidNext: status?.uidnext ?? null,
    savedAt: new Date().toISOString()
  }, null, 2), "utf8");

  await client.select(folder.name);
  const uids = await client.uidSearchAll();
  let saved = 0;
  let skipped = 0;
  let errors = 0;
  for (const uid of uids) {
    const filePath = join(destination, `${uid}.eml`);
    if (existsSync(filePath)) {
      skipped += 1;
      continue;
    }
    try {
      await client.fetchMessageToFile(uid, filePath);
      saved += 1;
    } catch (error) {
      errors += 1;
      console.log(`ERROR\t${folder.name}\tUID ${uid}\t${filePath}\t${errorText(error)}`);
      throw error;
    }
  }
  console.log(formatBackupLine(folder.name, uids.length, saved, skipped, errors));
}

async function restoreMessages(client, sourceDirectory, destinationFolder, dryRun) {
  const files = await collectRestoreFiles(sourceDirectory);
  if (files.length === 0) {
    console.log(`${dryRun ? "DRYRUN" : "RESTORE"}\t${sourceDirectory}\t0 messages\tNo .eml files found`);
    return;
  }

  const folders = await client.listFolders();
  const exists = folders.some((folder) => exactFolderMatches(folder, destinationFolder));
  if (!exists) {
    if (dryRun) {
      console.log(`DRYRUN\tCREATE\t${destinationFolder}`);
    } else {
      await client.createFolder(destinationFolder);
      console.log(`CREATE\t${destinationFolder}`);
    }
  }

  let restored = 0;
  for (const file of files) {
    try {
      const message = await readFile(file.path);
      const internalDate = parseMessageDate(message);
      if (dryRun) {
        const dateText = internalDate ? formatImapInternalDate(internalDate) : "no Date header";
        console.log(`DRYRUN\tAPPEND\t${destinationFolder}\t${file.path}\t${message.length} bytes\t${dateText}`);
      } else {
        await client.appendMessage(destinationFolder, message, internalDate);
        restored += 1;
        console.log(`RESTORE\t${destinationFolder}\t${file.path}\t${message.length} bytes`);
      }
    } catch (error) {
      console.log(`ERROR\t${destinationFolder}\t${file.path}\t${errorText(error)}`);
      throw error;
    }
  }

  const action = dryRun ? "DRYRUN" : "RESTORE";
  console.log(`${action}\t${destinationFolder}\t${files.length} messages${dryRun ? "" : `\t${restored} restored`}`);
}

async function listFolderMessages(client, folder, dateFilter) {
  let uids;
  try {
    await client.select(folder.name);
    uids = await client.uidSearchAll();
  } catch (error) {
    console.log(`ERROR\t${folder.name}\t${errorText(error)}`);
    throw error;
  }
  const dateText = dateFilter ? `, date ${dateFilter.text}` : "";
  const lines = [];
  for (const uid of uids) {
    try {
      const item = await client.fetchHeaderFields(uid);
      if (!messageMatchesDateFilter(item.date, dateFilter)) {
        continue;
      }
      lines.push(`${`${uid}`.padStart(8, " ")}\t${rawDisplay(decodeMimeWords(item.date))}\t${rawDisplay(decodeMimeWords(item.from))}\t${rawDisplay(decodeMimeWords(item.subject))}`);
    } catch (error) {
      console.log(`ERROR\t${folder.name}\tUID ${uid}\t${errorText(error)}`);
      throw error;
    }
  }
  if (lines.length === 0) {
    return 0;
  }
  console.log(`\n${quoteDisplay(folder.displayName)} (${lines.length} matched of ${uids.length} messages${dateText})`);
  for (const line of lines) {
    console.log(line);
  }
  return lines.length;
}

async function main() {
  const options = await parseArgs(Bun.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.hostname) {
    throw new Error("hostname is required\n\n" + usage());
  }
  if (!options.user) {
    throw new Error("--user is required, or set IMAPSAVE_USER");
  }
  if (!options.password) {
    throw new Error("password argument is required, or set IMAPSAVE_PASSWORD");
  }

  const client = new ImapClient(options);
  await client.connect();
  try {
    await client.login(options.user, options.password);
    if (!options.counts) {
      console.log(`Account: ${options.user} on ${options.hostname}:${options.port}`);
    }

    const needsFolders = options.folders || options.counts || options.output || options.list || options.search;
    const folders = needsFolders ? await client.listFolders() : [];
    const subscribed = needsFolders ? new Set((await client.listSubscribedFolders()).map((folder) => folder.name)) : new Set();
    for (const folder of folders) {
      folder.subscribed = subscribed.has(folder.name);
    }
    const matchedFolders = typeof options.list === "string" && !options.search
      ? folders.filter((folder) => exactFolderMatches(folder, options.list))
      : folders.filter((folder) => folderMatches(folder, options.search));
    const reportFolders = options.output
      ? matchedFolders
      : matchedFolders.slice().sort((a, b) => a.displayName.localeCompare(b.displayName));
    const backupFolders = matchedFolders;
    const showSubscription = subscribed.size > 0;
    if ((options.folders || (options.search && !options.counts && !options.output && !options.list)) && !options.counts) {
      console.log("\nFolders:");
      for (const folder of reportFolders) {
        console.log(`${quoteDisplay(folder.displayName)}\t${displayAttributes(folder, showSubscription)}`);
      }
    }

    if (options.counts) {
      const countLines = [];
      for (const folder of reportFolders) {
        try {
          const status = await client.status(folder.name);
          countLines.push(formatCountLine(status?.messages ?? 0, folder, showSubscription));
        } catch (error) {
          countLines.push(`ERROR\t${quoteDisplay(folder.displayName)}\t${errorText(error)}`);
          process.exitCode = 1;
        }
      }
      const text = [`Account: ${options.user} on ${options.hostname}:${options.port}`, "Counts:", ...countLines].join("\n");
      console.log(text);
    }

    if (options.list) {
      let matchedMessages = 0;
      for (const folder of reportFolders) {
        try {
          matchedMessages += await listFolderMessages(client, folder, options.dateFilter);
        } catch {
          process.exitCode = 1;
          break;
        }
      }
      if (matchedMessages === 0) {
        console.log("\nNo matching messages.");
      }
    }

    if (options.output) {
      console.log(`\nBacking up to ${options.output}:`);
      await mkdir(options.output, { recursive: true });
      for (const folder of backupFolders) {
        try {
          await backupFolder(client, options.output, folder);
        } catch (error) {
          console.log(`ERROR\t${folder.name}\tBackup stopped\t${errorText(error)}`);
          process.exitCode = 1;
          break;
        }
      }
    }

    if (options.restore) {
      console.log(`\nRestoring ${options.restore} to ${quoteDisplay(options.restoreFolder)}${options.dryRun ? " (dry run)" : ""}:`);
      try {
        await restoreMessages(client, options.restore, options.restoreFolder, options.dryRun);
      } catch (error) {
        console.log(`ERROR\t${options.restoreFolder}\tRestore stopped\t${errorText(error)}`);
        process.exitCode = 1;
      }
    }
  } finally {
    await client.logout();
  }
}

main().catch((error) => {
  console.log(`ERROR\t${errorText(error)}`);
  console.error(error.message);
  process.exit(1);
});
