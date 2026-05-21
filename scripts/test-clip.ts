import { clipEmbed, CLIP_EMBED_DIM } from "../lib/replicate";

const url = "https://picsum.photos/seed/test/800/600";
console.log(`Embedding: ${url}`);
const t0 = Date.now();
const vec = await clipEmbed(url);
const ms = Date.now() - t0;
console.log(`✓ embedded in ${ms}ms`);
console.log(`  dim: ${vec.length} (expected ${CLIP_EMBED_DIM})`);
console.log(`  sample: [${vec.slice(0, 5).map((n) => n.toFixed(4)).join(", ")}, ...]`);
