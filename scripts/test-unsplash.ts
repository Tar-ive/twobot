import { searchPhoto } from "../lib/unsplash";

for (const q of ["espresso", "candle light", "san francisco fog", "code editor", "meditation cushion"]) {
  const r = await searchPhoto(q);
  console.log(q.padEnd(22), "→", r ? "✓ " + r.url.slice(0, 80) : "null");
}
