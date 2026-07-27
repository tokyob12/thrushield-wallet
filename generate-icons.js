import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const svgPath = path.join(root, "icon.svg");
const outDir = path.join(root, "icons");

const sizes = [16, 32, 48, 128];

async function main() {
  if (!fs.existsSync(svgPath)) {
    throw new Error(`Missing ${svgPath}`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const svg = fs.readFileSync(svgPath);

  for (const size of sizes) {
    const outPath = path.join(outDir, `icon${size}.png`);
    await sharp(svg).resize(size, size).png().toFile(outPath);
    console.log(`Wrote ${path.relative(root, outPath)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
