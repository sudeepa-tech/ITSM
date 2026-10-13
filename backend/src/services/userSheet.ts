/** Excel (.xlsx) and CSV reading/writing for the user list. Uses Uint8Array so it also runs in the browser demo. */
import ExcelJS from "exceljs";
import { canonicalHeader, Field, LOCALE_CODES, MAX_IMPORT_ROWS, RoleName, SheetRow } from "./userImport";

const ROLE_LABEL: Record<RoleName, string> = { END_USER: "Employee", AGENT: "Agent", ADMIN: "Admin" };
export interface ExportUser { name: string; email: string; role: RoleName; department?: string | null; team?: string | null; location?: string | null; locale: string; timezone: string; active: boolean; lastLoginAt?: Date | null; createdAt?: Date }

/** Text that a spreadsheet could treat as a formula gets a leading apostrophe (defence in depth; also matters if the file is saved as CSV). */
const safe = (v?: string | null) => (!v ? "" : /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const toBytes = (b: unknown) => new Uint8Array(b as ArrayBuffer);

const COLUMNS = [
  { header: "Name", key: "name", width: 26 }, { header: "Email", key: "email", width: 34 }, { header: "Role", key: "role", width: 12 }, { header: "Department", key: "department", width: 18 },
  { header: "Team", key: "team", width: 22 }, { header: "Location", key: "location", width: 16 }, { header: "Language", key: "language", width: 10 }, { header: "Time zone", key: "timezone", width: 20 },
  { header: "Active", key: "active", width: 9 },
];

function styleHeader(ws: ExcelJS.Worksheet) {
  const r = ws.getRow(1);
  r.font = { bold: true }; r.alignment = { vertical: "middle" };
  r.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE3F0F8" } }; c.border = { bottom: { style: "thin", color: { argb: "FF9DB4C3" } } }; });
}

export async function buildUsersWorkbook(users: ExportUser[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Northbeam ITSM"; wb.created = new Date();
  const ws = wb.addWorksheet("Users", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [...COLUMNS, { header: "Last sign-in", key: "last", width: 18 }, { header: "Created", key: "created", width: 18 }];
  styleHeader(ws);
  for (const u of users) {
    ws.addRow({ name: safe(u.name), email: safe(u.email), role: ROLE_LABEL[u.role], department: safe(u.department), team: safe(u.team), location: safe(u.location), language: u.locale, timezone: u.timezone, active: u.active ? "Yes" : "No", last: u.lastLoginAt ?? "", created: u.createdAt ?? "" });
  }
  for (const k of ["last", "created"]) ws.getColumn(k).numFmt = "yyyy-mm-dd hh:mm";
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
  return toBytes(await wb.xlsx.writeBuffer());
}

export async function buildTemplate(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Northbeam ITSM";
  const ws = wb.addWorksheet("Users", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [...COLUMNS, { header: "Password", key: "password", width: 20 }];
  styleHeader(ws);
  for (let r = 2; r <= MAX_IMPORT_ROWS + 1; r++) {
    ws.getCell(`C${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"Employee,Agent,Admin"'] };
    ws.getCell(`G${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [`"${LOCALE_CODES.join(",")}"`] };
    ws.getCell(`I${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"Yes,No"'] };
  }
  const help = wb.addWorksheet("Instructions");
  help.getColumn(1).width = 16; help.getColumn(2).width = 96;
  const lines: [string, string][] = [
    ["How to use", `Fill in the "Users" sheet, one person per row (up to ${MAX_IMPORT_ROWS} rows), then upload it under Admin > Users > Import. You always get a preview before anything is saved.`],
    ["Name", "Required for new users. 2 to 80 characters."], ["Email", "Required. Used to sign in and to match existing users."],
    ["Role", "Employee (default), Agent or Admin. Agents and Admins also get a staff profile so tickets can be routed to them."],
    ["Department", "Optional."], ["Team", "Agents and Admins only. Defaults to Service Desk."], ["Location", "Agents and Admins only. Optional."],
    ["Language", `Interface language: ${LOCALE_CODES.join(", ")}. Default en.`], ["Time zone", "IANA name such as Europe/London or Asia/Kolkata. Default UTC."], ["Active", "Yes (default) or No."],
    ["Password", "Optional, at least 8 characters with a letter and a number. Leave blank to have a secure one generated; you download the generated passwords once, after the import. Ignored for users that already exist."],
    ["Example", "The orange \"Example\" tab shows sample rows (example.com addresses). Copy rows you need into the \"Users\" sheet; the Example tab is never imported."],
    ["Updating", "Existing users are skipped unless you tick “Update existing users”. Blank cells never overwrite existing values."],
    ["Exports", "An exported file can be re-imported to update users in bulk. Columns it does not need (Last sign-in, Created) are ignored."],
  ];
  lines.forEach(([a, b], i) => { const row = help.addRow([a, b]); row.getCell(1).font = { bold: true }; row.getCell(2).alignment = { wrapText: true, vertical: "top" }; if (i === 0) row.height = 34; });

  // Hover notes on the key columns of the sheet people actually fill in.
  const notes: Record<string, string> = { A1: "Required for new users. 2 to 80 characters.", B1: "Required. Used to sign in; matches existing users.", C1: "Employee (default), Agent or Admin. Pick from the list.", J1: "Optional. Leave blank to generate a secure password. Ignored for existing users." };
  for (const [addr, text] of Object.entries(notes)) ws.getCell(addr).note = text;

  // Sample rows live on their own sheet so they can never be imported by accident. Copy what you need into "Users".
  const ex = wb.addWorksheet("Example", { views: [{ state: "frozen", ySplit: 1 }] });
  ex.properties.tabColor = { argb: "FFF2B233" };
  ex.columns = [...COLUMNS, { header: "Password", key: "password", width: 20 }];
  styleHeader(ex);
  [
    ["Jane Doe", "jane.doe@example.com", "Employee", "Finance", "", "", "en", "Europe/London", "Yes", ""],
    ["Carlos Ruiz", "carlos.ruiz@example.com", "Employee", "Sales", "", "", "es", "Europe/Madrid", "Yes", "Welcome2026"],
    ["Priya Nair", "priya.nair@example.com", "Agent", "IT", "Network Support", "Bengaluru", "en", "Asia/Kolkata", "Yes", ""],
    ["Sam Admin", "sam.admin@example.com", "Admin", "IT", "Service Desk", "London", "en", "Europe/London", "Yes", ""],
    ["Left Company", "left.company@example.com", "Employee", "HR", "", "", "en", "UTC", "No", ""],
  ].forEach((r) => ex.addRow(r));
  return toBytes(await wb.xlsx.writeBuffer());
}

// ------------------------------------------------------------------- reading
interface Cell { text: string; formula: boolean }
function cellOf(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return { text: "", formula: false };
  if (v instanceof Date) return { text: v.toISOString(), formula: false };
  if (typeof v === "object") {
    if ("formula" in v || "sharedFormula" in v) return { text: "", formula: true };
    if ("richText" in v) return { text: v.richText.map((r) => r.text).join(""), formula: false };
    if ("text" in v) return { text: String(v.text), formula: false };
    return { text: "", formula: false };
  }
  return { text: String(v), formula: false };
}

/** Minimal RFC 4180 parser: quotes, escaped quotes, CRLF, BOM, and ; as delimiter for European exports. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = first.split(";").length > first.split(",").length ? ";" : ",";
  const rows: string[][] = []; let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '"') { if (src[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && src[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function fromMatrix(matrix: Cell[][], firstRowNumber = 1) {
  const hi = matrix.slice(0, 5).findIndex((r) => r.some((c) => canonicalHeader(c.text) === "email"));
  if (hi < 0) return null;
  const cols = matrix[hi].map((c) => canonicalHeader(c.text));
  const unknown = matrix[hi].filter((c, i) => !cols[i] && c.text.trim()).map((c) => c.text.trim());
  const rows: SheetRow[] = [];
  for (let i = hi + 1; i < matrix.length; i++) {
    const cells: SheetRow["cells"] = {}; let any = false, formula = false;
    matrix[i].forEach((c, j) => { const f = cols[j] as Field | null; if (!f) return; if (c.formula) formula = true; if (c.text.trim()) any = true; if (!(f in cells)) cells[f] = c.text; });
    if (any || formula) rows.push({ row: firstRowNumber + i, cells, hasFormula: formula });
  }
  return { rows, unknownHeaders: unknown };
}

export async function readSheet(data: Uint8Array | ArrayBuffer, filename: string): Promise<{ rows: SheetRow[]; unknownHeaders: string[] }> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const bad = () => new Error("No header row with an Email column was found. Use the template from the Import dialog.");
  if (isZip) {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(bytes as unknown as ArrayBuffer); } catch { throw new Error("This file could not be read as an Excel workbook."); }
    for (const ws of wb.worksheets) {
      const matrix: Cell[][] = [];
      ws.eachRow({ includeEmpty: false }, (row, n) => { const cells: Cell[] = []; row.eachCell({ includeEmpty: true }, (c, col) => { cells[col - 1] = cellOf(c.value); }); for (let k = 0; k < cells.length; k++) cells[k] ??= { text: "", formula: false }; matrix[n - 1] = cells; });
      for (let k = 0; k < matrix.length; k++) matrix[k] ??= [];
      const r = fromMatrix(matrix);
      if (r) return r;
    }
    throw bad();
  }
  if (/\.csv$/i.test(filename) && !bytes.includes(0)) {
    const matrix = parseCsv(new TextDecoder("utf-8").decode(bytes)).map((r) => r.map((t) => ({ text: t, formula: false })));
    const r = fromMatrix(matrix);
    if (r) return r;
    throw bad();
  }
  throw new Error("Unsupported file. Upload an .xlsx or .csv file.");
}
