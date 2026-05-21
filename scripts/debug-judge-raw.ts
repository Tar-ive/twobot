import "dotenv/config";

const r = await fetch("https://api.minimax.io/v1/text/chatcompletion_v2", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "MiniMax-M2",
    messages: [
      {
        role: "system",
        content:
          "You are Arjun, a 28-year-old research scientist at Anthropic in SF, into Vedanta. Voice: wry but generous. Write short replies. Never mention being an AI.",
      },
      {
        role: "user",
        content:
          'You see this tweet: "morning espresso and a fresh arxiv preprint. SF fog is rolling in."\n\nWhat do you do? Respond with EXACTLY:\nACTION: <LIKE|REPLY|SHARE|SKIP|NOT_INTERESTED>\nREASON: <short>',
      },
    ],
    max_tokens: 400,
    temperature: 0.8,
  }),
});

const json = await r.json();
console.log("HTTP", r.status);
console.log(JSON.stringify(json, null, 2));
