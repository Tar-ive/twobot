"""
Cluster post embeddings with KMeans, write cluster_id + centroids back to DB.

  python cluster.py --k 12

Reads post.embedding from Postgres (via psycopg2 with NEON_DB_URL).
Writes:
  - posts.cluster_id
  - topic_clusters (cluster_id, centroid, size)
The text label is filled in by scripts/label-clusters.ts later.
"""
import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
from sklearn.cluster import KMeans

# Use the Neon HTTP API directly via requests to avoid needing psycopg2
import urllib.request
import urllib.parse
import re

NEON_DB_URL = os.environ.get("NEON_DB_URL")
if not NEON_DB_URL:
    # Fall back to .env file
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line.startswith("NEON_DB_URL="):
                NEON_DB_URL = line.split("=", 1)[1].strip().strip('"').strip("'")
                break
if not NEON_DB_URL:
    print("NEON_DB_URL not set", file=sys.stderr)
    sys.exit(1)

# We need psycopg2 for direct SQL — fall back to TS bridge if missing
try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("Installing psycopg2-binary...", file=sys.stderr)
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", "psycopg2-binary"])
    import psycopg2
    import psycopg2.extras


def parse_vec(s):
    if isinstance(s, list):
        return s
    if isinstance(s, str):
        return [float(x) for x in s.strip("[]").split(",") if x.strip()]
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--k", type=int, default=12, help="Number of clusters")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    print(f"Connecting to Neon...")
    conn = psycopg2.connect(NEON_DB_URL)
    conn.autocommit = False

    # 1. Load post embeddings (text)
    cur = conn.cursor()
    cur.execute(
        """
        SELECT post_id, embedding::text
        FROM posts
        WHERE embedding IS NOT NULL AND parent_id IS NULL
        """
    )
    rows = cur.fetchall()
    print(f"Posts with embedding: {len(rows)}")
    if len(rows) < args.k * 3:
        print(f"  Warning: {len(rows)} posts is small for k={args.k}; consider k={max(2, len(rows) // 10)}")

    post_ids = [r[0] for r in rows]
    X = np.array([parse_vec(r[1]) for r in rows], dtype=np.float32)
    print(f"  matrix: {X.shape}")

    # 2. KMeans
    print(f"\nFitting KMeans (k={args.k}) ...")
    km = KMeans(n_clusters=args.k, random_state=args.seed, n_init=10)
    labels = km.fit_predict(X)
    centroids = km.cluster_centers_
    print(f"  inertia: {km.inertia_:.1f}")

    sizes = np.bincount(labels, minlength=args.k)
    for c in range(args.k):
        print(f"  cluster {c:2d}: {sizes[c]:3d} posts")

    # 3. Write cluster_id per post
    print(f"\nWriting cluster_id to posts...")
    cur.execute("BEGIN")
    for pid, lab in zip(post_ids, labels):
        cur.execute("UPDATE posts SET cluster_id = %s WHERE post_id = %s", (int(lab), pid))
    print(f"  updated {len(post_ids)} posts")

    # 4. Upsert topic_clusters rows with centroids
    print(f"\nWriting centroids to topic_clusters...")
    # Clear old centroids first to ensure size + cluster_id mapping stays clean.
    cur.execute("DELETE FROM topic_clusters")
    for c in range(args.k):
        centroid_str = "[" + ",".join(f"{x:.6f}" for x in centroids[c]) + "]"
        cur.execute(
            """
            INSERT INTO topic_clusters (cluster_id, label, description, centroid, size, computed_at)
            VALUES (%s, %s, NULL, %s::vector, %s, NOW())
            """,
            (int(c), f"cluster_{c}", centroid_str, int(sizes[c])),
        )
    conn.commit()
    cur.close()
    conn.close()

    print(f"\n✓ Done. Run `npm run clusters:label` next to LLM-label the clusters.")


if __name__ == "__main__":
    main()
