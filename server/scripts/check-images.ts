// Verifies every product and category image, stores the result on each product image row and writes prisma/image-report.json.
//
// Checks:
//  * local paths (/img/...) exist under client/public with EXACTLY the same letter case (Windows ignores case, Linux production does not),
//    and the file really is an image (JPEG / PNG / WebP / GIF / SVG), not an empty or HTML file;
//  * remote URLs answer 200 with an image content type;
//  * a real (non-stand-in) photo has a source and licence, and one photo is not used by several products;
//  * no active category or product is left without an image.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, "../../client/public");

/** Case-sensitive existence check, walking each path segment through the real directory listing. */
function existsExact(rel: string): boolean {
  let dir = PUBLIC;
  for (const part of rel.split("/").filter(Boolean)) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory() || !fs.readdirSync(dir).includes(part)) return false;
    dir = path.join(dir, part);
  }
  return fs.statSync(dir).isFile();
}

function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const head = buf.subarray(0, 12);
  if (head[0] === 0xff && head[1] === 0xd8) return true; // JPEG
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true; // PNG
  if (head.subarray(0, 4).toString() === "RIFF" && head.subarray(8, 12).toString() === "WEBP") return true;
  if (head.subarray(0, 3).toString() === "GIF") return true;
  const text = buf.subarray(0, 300).toString("utf8").trimStart().toLowerCase();
  return text.startsWith("<svg") || (text.startsWith("<?xml") && text.includes("<svg"));
}

async function check(url: string): Promise<string | null> {
  if (url.startsWith("/")) {
    if (!existsExact(url)) return fs.existsSync(path.join(PUBLIC, url)) ? "file exists but its name differs in letter case (breaks on Linux)" : "file not found under client/public";
    return looksLikeImage(fs.readFileSync(path.join(PUBLIC, url))) ? null : "file is not a valid image";
  }
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return `HTTP ${r.status}`;
    return (r.headers.get("content-type") ?? "").startsWith("image/") ? null : "response is not an image";
  } catch (e) {
    return `request failed (${e instanceof Error ? e.message : "error"})`;
  }
}

async function main() {
  const report: { kind: "product" | "category"; name: string; url: string; ok: boolean; problem?: string }[] = [];

  const rows = await prisma.productImage.findMany({ include: { product: { select: { slug: true, isActive: true } } } });
  const realUse = new Map<string, string[]>();
  for (const r of rows) {
    let problem = await check(r.url);
    await prisma.productImage.update({ where: { id: r.id }, data: { lastCheckedAt: new Date(), lastCheckOk: problem === null } });
    if (!problem && !r.isPlaceholder && (!r.sourceUrl || !r.license)) problem = "real photo without source/licence";
    if (!r.isPlaceholder) realUse.set(r.url, [...(realUse.get(r.url) ?? []), r.product.slug]);
    report.push({ kind: "product", name: r.product.slug, url: r.url, ok: !problem, problem: problem ?? undefined });
  }
  // The same photo on several products is only a problem for real product photos; stand-ins are labelled as representative.
  for (const [url, slugs] of realUse) if (slugs.length > 1) report.push({ kind: "product", name: slugs.join(", "), url, ok: false, problem: "one real photo shared by several products" });

  const stockPhotos = new Map<string, string[]>();
  for (const r of rows) if (r.url.startsWith("/img/stock/")) stockPhotos.set(r.url, [...(stockPhotos.get(r.url) ?? []), r.product.slug]);
  for (const [url, slugs] of stockPhotos) if (slugs.length > 1) report.push({ kind: "product", name: slugs.join(", "), url, ok: false, problem: "one stock photo used for several products" });

  const noImage = await prisma.product.findMany({ where: { isActive: true, images: { none: {} } }, select: { slug: true } });
  for (const p of noImage) report.push({ kind: "product", name: p.slug, url: "", ok: false, problem: "active product has no image row" });

  for (const c of await prisma.category.findMany({ where: { isActive: true } })) {
    const problem = c.imageUrl ? await check(c.imageUrl) : "category has no image";
    report.push({ kind: "category", name: c.slug, url: c.imageUrl ?? "", ok: !problem, problem: problem ?? undefined });
  }

  const standIns = rows.filter((r) => r.url.endsWith("/coming-soon.svg")).map((r) => r.product.slug);
  fs.writeFileSync(path.resolve(HERE, "../prisma/image-report.json"), JSON.stringify({ checkedAt: new Date().toISOString(), comingSoon: standIns, report }, null, 2));
  const bad = report.filter((r) => !r.ok);
  console.log(`${report.length} images checked (${rows.length} product, ${report.length - rows.length - noImage.length - [...realUse].filter(([, s]) => s.length > 1).length - [...stockPhotos].filter(([, s]) => s.length > 1).length} category), ${bad.length} problems`);
  console.log(`Products still on the "coming soon" image (no suitable licensed photo yet): ${standIns.length}${standIns.length ? " — " + standIns.join(", ") : ""}`);
  for (const b of bad) console.log(" -", b.kind, b.name, b.url, b.problem);
  process.exitCode = bad.length ? 1 : 0;
}

main().finally(() => prisma.$disconnect());
