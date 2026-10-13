/** Strip quoted history so replies don't re-post the whole thread. */
export function stripQuoted(body: string): string {
  const lines = body.replace(/\r/g, "").split("\n");
  const cut = lines.findIndex((l) => /^>/.test(l) || /^On .+ wrote:$/i.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l.trim()) || /^_{5,}$/.test(l.trim()));
  return (cut >= 0 ? lines.slice(0, cut) : lines).join("\n").trim();
}

