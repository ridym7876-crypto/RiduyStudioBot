// Riduy Video AI API — শুধুমাত্র ভিডিও জেনারেশন ও ভিডিও এডিট
// Real video engine via HuggingFace Spaces (LTX-Video). Persists output so links survive.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.31";

const SPACES = [{ host: "lightricks-ltx-video-distilled.hf.space", name: "ltx" }];
const DEFAULT_NEG = "worst quality, inconsistent motion, blurry, jittery, distorted, watermark, text, low resolution";

function generateApiKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let r = "";
  for (let i = 0; i < 35; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return `Riduy${r}Apik`;
}
function isValidKeyFormat(k: string): boolean {
  if (!k || typeof k !== "string") return false;
  if (!k.startsWith("Riduy") || !k.endsWith("Apik")) return false;
  if (k.length < 40 || k.length > 45) return false;
  const mid = k.slice(5, -4);
  return /^[A-Za-z0-9]+$/.test(mid) && mid.length >= 30;
}
function getApiKey(req: Request, query: any, body: any): string | null {
  const h = req.headers;
  return h.get("ABDUL_KHALEK_RIDUY_API-KEY") || h.get("abdul_khalek_riduy_api-key") || h.get("x-api-key") || query.key || body.key || null;
}
const memKeys = new Map<string, any>();
const memUsage = new Map<string, number>();

async function validateApiKey(base44: any, apiKey: string): Promise<any> {
  if (!isValidKeyFormat(apiKey)) return { success: false, message: "Invalid key format. Key must start with 'Riduy' and end with 'Apik' (40-45 chars)." };
  if (base44) {
    try {
      const all = await base44.asServiceRole.entities.RiduyApiKey.list({ limit: 500 });
      const found = all?.find((k: any) => { const d = k.data || k; return d.apiKey === apiKey && d.isActive !== false; });
      if (found) return { success: true, data: found.data || found };
    } catch { }
  }
  const mem = memKeys.get(apiKey);
  if (mem) return { success: true, data: mem };
  return { success: true, data: { apiKey, id: "format_valid", dailyLimit: 100, todayCount: 0, totalCalls: 0, boundApp: "" } };
}
async function saveKeyToDb(base44: any, key: string, bindApp: string, user: string): Promise<string> {
  if (base44) {
    try {
      await base44.asServiceRole.entities.RiduyApiKey.create({ apiKey: key, userIdentifier: user, boundApp, isActive: true, dailyLimit: 100, todayCount: 0, lastResetDate: new Date().toISOString().split("T")[0], totalCalls: 0, createdAt: new Date().toISOString(), teachCommands: [] });
      return "database";
    } catch { }
  }
  memKeys.set(key, { apiKey: key, userIdentifier: user, boundApp, isActive: true, dailyLimit: 100, todayCount: 0, totalCalls: 0 });
  return "memory";
}
function clamp(n: number, lo: number, hi: number, def: number): number {
  n = Number(n); if (!isFinite(n)) return def; return Math.max(lo, Math.min(hi, Math.round(n)));
}
function round32(n: number, def: number): number {
  n = Number(n); if (!isFinite(n) || n <= 0) return def; return Math.round(n / 32) * 32;
}
function toBase64(bytes: Uint8Array): string {
  let binary = ""; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as any);
  return btoa(binary);
}

async function uploadImageToSpace(host: string, imageUrl?: string, imageBase64?: string): Promise<string | null> {
  try {
    let bytes: Uint8Array; const filename = "input.png";
    if (imageBase64) {
      const b64 = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;
      const bin = atob(b64); bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else if (imageUrl) {
      const r = await fetch(imageUrl); if (!r.ok) return null; bytes = new Uint8Array(await r.arrayBuffer());
    } else return null;
    const form = new FormData();
    form.append("files", new Blob([bytes], { type: "image/png" }), filename);
    const up = await fetch(`https://${host}/gradio_api/upload?upload_id=${crypto.randomUUID()}`, { method: "POST", body: form });
    if (!up.ok) return null;
    const arr = await up.json();
    return Array.isArray(arr) && arr.length ? arr[0] : null;
  } catch { return null; }
}
async function submitJob(host: string, endpoint: string, data: any[]): Promise<any> {
  try {
    const r = await fetch(`https://${host}/gradio_api/call/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) });
    if (!r.ok) { const t = await r.text(); return { error: `Space submit failed ${r.status}: ${t.slice(0, 150)}` }; }
    const j = await r.json();
    if (!j.event_id) return { error: "No event_id returned." };
    return { event_id: j.event_id };
  } catch (e: any) { return { error: e.message }; }
}
async function pollJob(host: string, endpoint: string, eventId: string, waitMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), waitMs);
  try {
    const r = await fetch(`https://${host}/gradio_api/call/${endpoint}/${eventId}`, { signal: controller.signal });
    clearTimeout(timer);
    const text = await r.text();
    let lastEvent = ""; let lastData = "";
    for (const line of text.split("\n")) {
      if (line.startsWith("event:")) lastEvent = line.slice(6).trim();
      else if (line.startsWith("data:")) lastData = line.slice(5).trim();
    }
    if (lastEvent === "error") return { status: "error", message: "Space generation error. Model busy, try again." };
    if (lastEvent === "complete" && lastData) {
      try {
        const arr = JSON.parse(lastData);
        let url: string | undefined; let seed: number | undefined;
        const walk = (o: any) => {
          if (!o) return;
          if (typeof o === "string" && o.includes("/gradio_api/file=") && o.includes(".mp4")) { url = url || o; return; }
          if (typeof o === "object") {
            if (o.url && typeof o.url === "string" && o.url.includes(".mp4")) url = url || o.url;
            if (typeof o.seed === "number") seed = o.seed;
            for (const v of Object.values(o)) walk(v);
          }
        };
        walk(arr);
        if (Array.isArray(arr) && typeof arr[arr.length - 1] === "number") seed = arr[arr.length - 1];
        if (url) return { status: "completed", raw_url: url, seed };
        return { status: "processing", message: "Result received but video URL not found." };
      } catch { return { status: "processing" }; }
    }
    return { status: "processing" };
  } catch (e: any) {
    clearTimeout(timer);
    if (e.name === "AbortError") return { status: "processing" };
    return { status: "error", message: e.message };
  }
}

// Persist video immediately (space URL dies later). Try Base44 storage, else base64.
async function persistVideo(base44: any, rawUrl: string): Promise<any> {
  try {
    const r = await fetch(rawUrl);
    if (!r.ok) return { video_url: rawUrl, note: "raw url (may expire)" };
    const bytes = new Uint8Array(await r.arrayBuffer());
    // 1. Try Base44 public storage → permanent CDN url
    if (base44?.integrations?.Core?.UploadFile) {
      try {
        const file = new File([bytes], "riduy_video.mp4", { type: "video/mp4" });
        const up = await base44.integrations.Core.UploadFile({ file });
        const furl = up?.file_url || up?.data?.file_url || up?.url;
        if (furl) return { video_url: furl, permanent: true, size: bytes.length, mime: "video/mp4" };
      } catch { }
    }
    // 2. Fallback: base64 data (always works)
    return { video_url: rawUrl, video_base64: toBase64(bytes), mime: "video/mp4", size: bytes.length, note: "base64 (raw url may expire)" };
  } catch (e: any) {
    return { video_url: rawUrl, error: "persist failed: " + e.message };
  }
}

async function textToVideo(base44: any, prompt: string, opts: any, budgetMs: number): Promise<any> {
  const duration = clamp(opts.duration, 1, 8, 2);
  const width = round32(opts.width, 704);
  const height = round32(opts.height, 512);
  const neg = opts.negative_prompt || DEFAULT_NEG;
  const data = [prompt, neg, null, null, height, width, "text-to-video", duration, 9, opts.seed ?? 42, true, 1, true];
  const host = SPACES[0].host; const endpoint = "text_to_video";
  const sub = await submitJob(host, endpoint, data);
  if (sub.error) return { status: "error", message: sub.error };
  const start = Date.now();
  while (Date.now() - start < budgetMs) {
    const p = await pollJob(host, endpoint, sub.event_id, Math.min(20000, budgetMs - (Date.now() - start)));
    if (p.status === "completed" && p.raw_url) {
      const persisted = await persistVideo(base44, p.raw_url);
      return { status: "completed", seed: p.seed, duration, width, height, ...persisted };
    }
    if (p.status === "error") return { status: "error", message: p.message };
    await new Promise(r => setTimeout(r, 1500));
  }
  return { status: "processing", job: { space: host, endpoint, event_id: sub.event_id }, message: "ভিডিও এখনও তৈরি হচ্ছে। job দিয়ে video_status কল করুন।" };
}
async function imageToVideo(base44: any, prompt: string, opts: any, budgetMs: number): Promise<any> {
  const host = SPACES[0].host; const endpoint = "image_to_video";
  let imgPath: string | null = null;
  if (opts.image_url || opts.image_base64) {
    imgPath = await uploadImageToSpace(host, opts.image_url, opts.image_base64);
    if (!imgPath) return { status: "error", message: "ইমেজ আপলোড ব্যর্থ। valid image_url বা image_base64 দিন।" };
  }
  const duration = clamp(opts.duration, 1, 8, 2);
  const width = round32(opts.width, 704);
  const height = round32(opts.height, 512);
  const neg = opts.negative_prompt || DEFAULT_NEG;
  const data = [prompt || "make this image come alive, cinematic motion", neg, imgPath, null, height, width, "image-to-video", duration, 9, opts.seed ?? 42, true, 1, true];
  const sub = await submitJob(host, endpoint, data);
  if (sub.error) return { status: "error", message: sub.error };
  const start = Date.now();
  while (Date.now() - start < budgetMs) {
    const p = await pollJob(host, endpoint, sub.event_id, Math.min(20000, budgetMs - (Date.now() - start)));
    if (p.status === "completed" && p.raw_url) {
      const persisted = await persistVideo(base44, p.raw_url);
      return { status: "completed", seed: p.seed, duration, width, height, ...persisted };
    }
    if (p.status === "error") return { status: "error", message: p.message };
    await new Promise(r => setTimeout(r, 1500));
  }
  return { status: "processing", job: { space: host, endpoint, event_id: sub.event_id }, message: "ভিডিও এখনও তৈরি হচ্ছে। job দিয়ে video_status কল করুন।" };
}
async function bumpUsage(base44: any, key: string, data: any, today: string, tc: number) {
  if (base44 && data.id && data.id !== "format_valid") {
    try { await base44.asServiceRole.entities.RiduyApiKey.update(data.id, { todayCount: tc + 1, lastResetDate: today, totalCalls: (data.totalCalls || 0) + 1 }); return; } catch { }
  }
  memUsage.set(key, (memUsage.get(key) || 0) + 1);
}

Deno.serve(async (req: Request) => {
  const ch = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, ABDUL_KHALEK_RIDUY_API-KEY", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: ch });
  let base44: any = null;
  try { base44 = createClientFromRequest(req); } catch {}
  let body: any = {};
  try { if (req.method === "POST") body = await req.json(); } catch {}
  const url = new URL(req.url);
  const query = Object.fromEntries(url.searchParams.entries());
  const action = body.action || query.action;
  const json = (d: any, s = 200) => new Response(JSON.stringify(d), { status: s, headers: ch });

  if (action === "generate_key") {
    const key = generateApiKey();
    const bindApp = body.bind_app || query.bind_app || "";
    const user = body.userIdentifier || query.user || "anonymous";
    let stored = "memory";
    try { stored = await saveKeyToDb(base44, key, bindApp, user); }
    catch (e: any) { try { memKeys.set(key, { apiKey: key, userIdentifier: user, boundApp: bindApp, isActive: true, dailyLimit: 100, todayCount: 0, totalCalls: 0 }); } catch {} }
    return json({ success: true, apiKey: key, headerName: "ABDUL_KHALEK_RIDUY_API-KEY", message: "আপনার ভিডিও API key তৈরি হয়েছে।", dailyLimit: 100, storedIn: stored, usage: "শুধু ভিডিও generation ও video edit।" });
  }
  if (action === "validate_key") {
    const ak = getApiKey(req, query, body);
    if (!ak) return json({ error: "API key required." }, 401);
    const kr = await validateApiKey(base44, ak);
    return json({ success: kr.success, valid: kr.success, message: kr.success ? "Key valid ✅" : kr.message });
  }
  if (action === "info" || !action) {
    return json({ name: "Riduy Video AI API", description: "শুধুমাত্র ভিডিও জেনারেশন ও ভিডিও এডিট", header: "ABDUL_KHALEK_RIDUY_API-KEY", endpoints: { generate_video: "Text → Video. prompt, duration(1-8s), width, height, seed", edit_video: "Image → Video. prompt, image_url OR image_base64", video_status: "job{space,endpoint,event_id}", generate_key: "get a key" } });
  }
  const ak = getApiKey(req, query, body);
  if (!ak) return json({ error: "API key required. Header: ABDUL_KHALEK_RIDUY_API-KEY" }, 401);
  const kr = await validateApiKey(base44, ak);
  if (!kr.success) return json({ error: kr.message }, 401);
  const today = new Date().toISOString().split("T")[0];
  let tc = kr.data.todayCount || 0;
  if (kr.data.lastResetDate !== today) tc = 0;
  if (tc >= (kr.data.dailyLimit || 100)) return json({ error: "Daily limit reached (100/day)." }, 429);
  const prompt = (body.prompt || query.prompt || "").toString().trim();

  if (action === "generate_video" || action === "text_to_video") {
    if (!prompt) return json({ error: "prompt দিন — কী ভিডিও বানাতে চান?" }, 400);
    const result = await textToVideo(base44, prompt, body, 42000);
    await bumpUsage(base44, ak, kr.data, today, tc);
    return json({ success: result.status !== "error", type: "text_to_video", prompt, ...result });
  }
  if (action === "edit_video" || action === "image_to_video") {
    if (!prompt && !body.image_url && !body.image_base64) return json({ error: "prompt অথবা image_url/image_base64 দিন।" }, 400);
    const result = await imageToVideo(base44, prompt, body, 42000);
    await bumpUsage(base44, ak, kr.data, today, tc);
    return json({ success: result.status !== "error", type: "image_to_video", prompt, ...result });
  }
  if (action === "video_status") {
    const job = body.job || { space: body.space, endpoint: body.endpoint, event_id: body.event_id };
    if (!job?.event_id) return json({ error: "job.event_id প্রয়োজন।" }, 400);
    const host = job.space || SPACES[0].host; const endpoint = job.endpoint || "text_to_video";
    const p = await pollJob(host, endpoint, job.event_id, 15000);
    if (p.status === "completed" && p.raw_url) {
      const persisted = await persistVideo(base44, p.raw_url);
      return json({ success: true, status: "completed", seed: p.seed, ...persisted, job });
    }
    return json({ success: p.status !== "error", ...p, job });
  }
  return json({ error: "Unknown action", availableActions: ["generate_key", "validate_key", "generate_video", "edit_video", "video_status", "info"] }, 400);
});
