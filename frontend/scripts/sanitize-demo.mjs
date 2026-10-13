// Post-build step for the single-file demo: some bundled libraries contain the literal U+FFFD character inside JS string
// literals. Writing it as the equivalent \uFFFD escape keeps the string value identical and keeps the file plain, valid HTML.
import fs from "node:fs";
const f = "dist-demo/index.demo.html";
const src = fs.readFileSync(f, "utf8");
const n = [...src].filter((c) => c === "\uFFFD").length;
fs.writeFileSync(f, src.replaceAll("\uFFFD", "\\uFFFD"));
console.log(`sanitize-demo: rewrote ${n} literal U+FFFD character(s)`);
