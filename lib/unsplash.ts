import "dotenv/config";

const ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;

// Search Unsplash for a photo matching the query. Returns the photo URL or null.
// Honors the API guidelines (Client-ID auth, attribution available in `attribution`).
export async function searchPhoto(query: string): Promise<{ url: string; attribution: string } | null> {
  if (!ACCESS_KEY) {
    console.warn("UNSPLASH_ACCESS_KEY missing — falling back to Lorem Picsum");
    return null;
  }
  const u = new URL("https://api.unsplash.com/search/photos");
  u.searchParams.set("query", query);
  u.searchParams.set("per_page", "10");
  u.searchParams.set("orientation", "landscape");
  u.searchParams.set("content_filter", "high");

  const res = await fetch(u.toString(), {
    headers: { Authorization: `Client-ID ${ACCESS_KEY}` },
  });
  if (!res.ok) {
    const body = await res.text();
    console.warn(`Unsplash ${res.status}: ${body.slice(0, 200)}`);
    return null;
  }
  const data: any = await res.json();
  const results: any[] = data?.results ?? [];
  if (results.length === 0) {
    console.warn(`Unsplash: no results for "${query}"`);
    return null;
  }

  // Pick one randomly from top 10 to avoid every agent showing the same top result for a topic.
  const pick = results[Math.floor(Math.random() * results.length)];
  const url: string | undefined = pick?.urls?.regular ?? pick?.urls?.small;
  if (!url) return null;
  const photographer = pick?.user?.name ?? "Unsplash";
  const photoLink = pick?.links?.html ?? "";
  return {
    url,
    attribution: `Photo by ${photographer} on Unsplash${photoLink ? ` (${photoLink})` : ""}`,
  };
}
