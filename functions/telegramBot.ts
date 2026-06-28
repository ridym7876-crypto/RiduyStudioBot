import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const TELEGRAM_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const HF_API_KEY = Deno.env.get("HUGGINGFACE_API_KEY") || "";

async function sendMessage(chatId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
}

async function sendPhoto(chatId: string, buf: ArrayBuffer, caption: string) {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption);
  form.append("photo", new Blob([buf], { type: "image/png" }), "image.png");
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, { method: "POST", body: form });
}

async function sendVideo(chatId: string, buf: ArrayBuffer, caption: string) {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption);
  form.append("video", new Blob([buf], { type: "video/mp4" }), "video.mp4");
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendVideo`, { method: "POST", body: form });
}

async function generateImage(prompt: string): Promise<ArrayBuffer | null> {
  const res = await fetch(
    "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${HF_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: prompt }),
    }
  );
  if (res.ok) return await res.arrayBuffer();
  console.error("Image error:", res.status, await res.text());
  return null;
}

async function generateVideo(prompt: string): Promise<ArrayBuffer | null> {
  const res = await fetch(
    "https://api-inference.huggingface.co/models/damo-vilab/text-to-video-ms-1.7b",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${HF_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: prompt }),
    }
  );
  if (res.ok) return await res.arrayBuffer();
  console.error("Video error:", res.status, await res.text());
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  let body: any;
  try { body = await req.json(); } catch { return new Response("Bad request", { status: 400 }); }

  const message = body?.message;
  if (!message) return new Response("No message", { status: 200 });

  const chatId = String(message.chat?.id);
  const text: string = message.text || "";

  if (text === "/start") {
    await sendMessage(chatId,
      "👋 *RiduyStudio Bot*-এ স্বাগতম!\n\n" +
      "🎨 `/image <প্রম্পট>` — AI দিয়ে ইমেজ তৈরি\n" +
      "🎬 `/video <প্রম্পট>` — AI দিয়ে ভিডিও তৈরি\n" +
      "ℹ️ `/help` — সাহায্য\n\n" +
      "উদাহরণ: `/image a beautiful sunset over the ocean`"
    );
  } else if (text === "/help") {
    await sendMessage(chatId,
      "📖 *কমান্ড লিস্ট:*\n\n" +
      "/start — শুরু করুন\n" +
      "/image [প্রম্পট] — AI দিয়ে ইমেজ তৈরি\n" +
      "/video [প্রম্পট] — AI দিয়ে ভিডিও তৈরি\n" +
      "/help — সাহায্য\n\n" +
      "উদাহরণ:\n`/image a cat on the moon`\n`/video a dog running on beach`"
    );
  } else if (text.startsWith("/image")) {
    const prompt = text.replace(/^\/image\s*/, "").trim();
    if (!prompt) {
      await sendMessage(chatId, "⚠️ প্রম্পট দিন!\nউদাহরণ: `/image a beautiful sunset`");
    } else {
      await sendMessage(chatId, `🎨 ইমেজ তৈরি হচ্ছে...\nপ্রম্পট: *${prompt}*\n\n⏳ একটু অপেক্ষা করুন...`);
      const buf = await generateImage(prompt);
      if (buf) {
        await sendPhoto(chatId, buf, `✅ ইমেজ তৈরি হয়েছে!\nপ্রম্পট: ${prompt}`);
      } else {
        await sendMessage(chatId, "❌ ইমেজ তৈরি হয়নি। মডেল লোড হচ্ছে, ৩০ সেকেন্ড পর আবার চেষ্টা করুন।");
      }
    }
  } else if (text.startsWith("/video")) {
    const prompt = text.replace(/^\/video\s*/, "").trim();
    if (!prompt) {
      await sendMessage(chatId, "⚠️ প্রম্পট দিন!\nউদাহরণ: `/video a cat walking in rain`");
    } else {
      await sendMessage(chatId, `🎬 ভিডিও তৈরি হচ্ছে...\nপ্রম্পট: *${prompt}*\n\n⏳ ১-২ মিনিট সময় নিতে পারে...`);
      const buf = await generateVideo(prompt);
      if (buf) {
        await sendVideo(chatId, buf, `✅ ভিডিও তৈরি হয়েছে!\nপ্রম্পট: ${prompt}`);
      } else {
        await sendMessage(chatId, "❌ ভিডিও তৈরি হয়নি। মডেল লোড হচ্ছে, ১ মিনিট পর আবার চেষ্টা করুন।");
      }
    }
  } else {
    await sendMessage(chatId, "❓ বুঝতে পারিনি। /start দিয়ে শুরু করুন বা /help দেখুন।");
  }

  return new Response("OK", { status: 200 });
});
