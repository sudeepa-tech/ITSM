import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { MAX_IMPORT_ROWS, canonicalHeader, generatePassword, passwordProblem, summarize, validateRows } from "../src/services/userImport";
import { buildTemplate, buildUsersWorkbook, parseCsv, readSheet } from "../src/services/userSheet";

const row = (n: number, cells: Record<string, string>) => ({ row: n, cells });
const opts = { existing: new Set(["old@x.com"]), updateExisting: false, selfEmail: "me@x.com" };

describe("headers", () => {
  it("accepts aliases, any case and spacing", () => {
    expect(["E-mail", "Work Email", "Full name", "Time zone", "TZ", "Dept", "Initial password", "Language"].map(canonicalHeader)).toEqual(["email", "email", "name", "timezone", "timezone", "department", "password", "locale"]);
    expect(canonicalHeader("Last sign-in")).toBeNull();
  });
});

describe("validateRows", () => {
  it("creates valid rows with sensible parsing", () => {
    const [r] = validateRows([row(2, { name: " Jane Roe ", email: "JANE@X.com", role: "technician", language: "español" as never, locale: "Español", timezone: "Asia/Kolkata", active: "No", team: "Network Support" })], opts);
    expect(r).toMatchObject({ action: "create", email: "jane@x.com", name: "Jane Roe", role: "AGENT" });
    expect(r.parsed).toMatchObject({ role: "AGENT", locale: "es", timezone: "Asia/Kolkata", active: false, team: "Network Support" });
  });
  it("reports every problem with a row number", () => {
    const rs = validateRows([
      row(2, { name: "A", email: "bad" }), row(3, { name: "Ok Name", email: "ok@x.com", role: "wizard" }), row(4, { name: "Ok Name", email: "ok2@x.com", timezone: "Mars/Base" }),
      row(5, { name: "Ok Name", email: "ok3@x.com", password: "short" }), row(6, { name: "Ok Name", email: "ok@x.com" }), row(7, { email: "noname@x.com" }), row(8, { name: "Ok", email: "o4@x.com", locale: "klingon" }),
    ], opts);
    expect(rs.map((r) => r.action)).toEqual(Array(7).fill("error"));
    expect(rs[3].errors.join()).toMatch(/at least 8/);
    expect(rs[4].errors.join()).toMatch(/Duplicate email.*row 3/);
    expect(rs[5].errors.join()).toMatch(/Name is missing/);
    expect(rs[0].errors.length).toBe(2);
  });
  it("skips existing users unless updating, and never lets a file change passwords of existing users", () => {
    expect(validateRows([row(2, { email: "old@x.com", name: "Old Name" })], opts)[0].action).toBe("skip");
    const u = validateRows([row(2, { email: "old@x.com", department: "HR", password: "Abcdef12" })], { ...opts, updateExisting: true })[0];
    expect(u.action).toBe("update");
    expect(u.parsed?.password).toBeUndefined();
    expect(u.notes.join()).toMatch(/Password column is ignored/);
  });
  it("protects the importing admin from demoting or deactivating themselves", () => {
    const o = { ...opts, existing: new Set(["me@x.com"]), updateExisting: true };
    expect(validateRows([row(2, { email: "me@x.com", role: "Employee" })], o)[0].action).toBe("error");
    expect(validateRows([row(2, { email: "me@x.com", active: "No" })], o)[0].action).toBe("error");
    expect(validateRows([row(2, { email: "me@x.com", department: "IT" })], o)[0].action).toBe("update");
  });
  it("rejects formula cells and strips control characters and the export apostrophe", () => {
    expect(validateRows([{ row: 2, cells: { email: "f@x.com", name: "Fo Bar" }, hasFormula: true }], opts)[0].action).toBe("error");
    const [r] = validateRows([row(2, { email: "c@x.com", name: "'=cmd|' /C calc'!A0\u0007" })], opts);
    expect(r.name).toBe("=cmd|' /C calc'!A0");
  });
  it("summarises", () => {
    expect(summarize(validateRows([row(2, { name: "Aa", email: "a@x.com" }), row(3, { email: "old@x.com" }), row(4, { email: "nope" })], opts))).toEqual({ total: 3, create: 1, update: 0, skip: 1, error: 1 });
  });
});

describe("passwords", () => {
  it("generates strong, policy-compliant, unambiguous passwords", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) { const p = generatePassword(); expect(passwordProblem(p)).toBeNull(); expect(p).not.toMatch(/[Il1O0]/); seen.add(p); }
    expect(seen.size).toBe(500);
    expect(generatePassword(16)).toHaveLength(16);
  });
  it("enforces the policy", () => {
    expect(passwordProblem("short1")).toMatch(/8/); expect(passwordProblem("onlyletters")).toMatch(/number/); expect(passwordProblem("Good1234")).toBeNull();
  });
});

describe("csv", () => {
  it("handles quotes, embedded commas/newlines, CRLF, BOM and semicolon delimiters", () => {
    expect(parseCsv('\uFEFFName,Email\r\n"Doe, Jane","j@x.com"\r\n"Say ""hi""","a\nb"\r\n')).toEqual([["Name", "Email"], ["Doe, Jane", "j@x.com"], ['Say "hi"', "a\nb"]]);
    expect(parseCsv("Name;Email\nA;a@x.com")).toEqual([["Name", "Email"], ["A", "a@x.com"]]);
  });
});

describe("spreadsheet round trip", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  it("exports, defuses formulas, and re-imports", async () => {
    const bytes = await buildUsersWorkbook([
      { name: '=HYPERLINK("http://evil","x")', email: "e1@x.com", role: "END_USER", locale: "en", timezone: "UTC", active: true, createdAt: new Date() },
      { name: "Agent Smith", email: "a1@x.com", role: "AGENT", team: "Network Support", location: "London", department: "IT", locale: "de", timezone: "Europe/Berlin", active: false, lastLoginAt: new Date() },
    ]);
    expect(bytes[0]).toBe(0x50);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Users")!;
    expect(ws.getRow(1).values).toEqual([undefined, "Name", "Email", "Role", "Department", "Team", "Location", "Language", "Time zone", "Active", "Last sign-in", "Created"]);
    expect(String(ws.getCell("A2").value)).toBe(`'=HYPERLINK("http://evil","x")`);
    expect(JSON.stringify(ws.getRow(2).values)).not.toMatch(/\$2[aby]\$|passwordHash/);

    const back = await readSheet(bytes, "users.xlsx");
    expect(back.unknownHeaders.sort()).toEqual(["Created", "Last sign-in"]);
    expect(back.rows).toHaveLength(2);
    const res = validateRows(back.rows, { existing: new Set(), updateExisting: false });
    expect(res[0].name).toBe('=HYPERLINK("http://evil","x")'); // apostrophe removed again
    expect(res[1].parsed).toMatchObject({ role: "AGENT", team: "Network Support", locale: "de", active: false, timezone: "Europe/Berlin" });
  });
  it("builds a template with instructions and no data rows", async () => {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load((await buildTemplate()) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Users", "Instructions", "Example"]);
    expect(wb.getWorksheet("Users")!.getRow(2).values).toEqual([]);
    expect((wb.getWorksheet("Users")!.getCell("C2").dataValidation as { formulae: string[] }).formulae[0]).toContain("Agent");
    await expect(readSheet(await buildTemplate(), "t.xlsx")).resolves.toMatchObject({ rows: [] });
  });
  it("the sample rows on the Example sheet are valid when copied into the Users sheet", async () => {
    const tpl = new ExcelJS.Workbook(); await tpl.xlsx.load((await buildTemplate()) as unknown as ArrayBuffer);
    const copy = new ExcelJS.Workbook(); const ws = copy.addWorksheet("Users");
    tpl.getWorksheet("Example")!.eachRow((r) => ws.addRow((r.values as unknown[]).slice(1)));
    const rows = (await readSheet(new Uint8Array(await copy.xlsx.writeBuffer() as ArrayBuffer), "x.xlsx")).rows;
    const res = validateRows(rows, { existing: new Set(), updateExisting: false });
    expect(rows).toHaveLength(5);
    expect(res.map((r) => r.action)).toEqual(["create", "create", "create", "create", "create"]);
    expect(res.map((r) => r.parsed?.role)).toEqual(["END_USER", "END_USER", "AGENT", "ADMIN", "END_USER"]);
    expect(res[4].parsed?.active).toBe(false);
  });
  it("rejects files that are neither xlsx nor csv, and corrupt zips", async () => {
    await expect(readSheet(enc("hello"), "x.txt")).rejects.toThrow(/Unsupported/);
    await expect(readSheet(new Uint8Array([0x50, 0x4b, 1, 2, 3]), "x.xlsx")).rejects.toThrow(/could not be read/);
    await expect(readSheet(enc("Foo,Bar\n1,2"), "x.csv")).rejects.toThrow(/Email column/);
  });
  it("reads CSV with a header offset", async () => {
    const r = await readSheet(enc("Report title\nName,Email,Role\nJo Bo,jo@x.com,Agent\n\n"), "x.csv");
    expect(r.rows).toEqual([{ row: 3, cells: { name: "Jo Bo", email: "jo@x.com", role: "Agent" }, hasFormula: false }]);
  });
  it("exposes the row cap", () => expect(MAX_IMPORT_ROWS).toBe(200));
});
