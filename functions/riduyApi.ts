// Riduy AI API — পৃথিবীর সবচেয়ে শক্তিশালী ফ্রি AI API প্ল্যাটফর্ম
import { createClientFromRequest } from "npm:@base44/sdk@0.8.31";

function generateApiKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let random = "";
  for (let i = 0; i < 35; i++) { random += chars[Math.floor(Math.random() * chars.length)]; }
  return `Riduy${random}Apik`;
}

function getApiKey(req: Request, query: any, body: any): string | null {
  const headers = req.headers;
  return headers.get("ABDUL_KHALEK_RIDUY_API-KEY") || headers.get("abdul_khalek_riduy_api-key") || headers.get("x-api-key") || query.key || body.key || null;
}

async function validateApiKey(base44: any, apiKey: string, bindApp: string): Promise<{success: boolean, data?: any, message?: string}> {
  if (!apiKey.startsWith("Riduy") || !apiKey.endsWith("Apik")) return { success: false, message: "Invalid key format. Key must start with 'Riduy' and end with 'Apik'" };
  if (apiKey.length < 40 || apiKey.length > 45) return { success: false, message: "Invalid key length. Must be 40-45 characters." };

  // List all keys and find manually (filter may not work with asServiceRole)
  const allKeys = await base44.asServiceRole.entities.RiduyApiKey.list({ limit: 500 });
  const keyData = allKeys?.find((k: any) => {
    const d = k.data || k;
    return d.apiKey === apiKey && d.isActive !== false;
  });

  if (!keyData) return { success: false, message: "API key not found or deactivated." };
  const data = keyData.data || keyData;
  if (data.boundApp && bindApp && data.boundApp !== bindApp) return { success: false, message: "এই API key অন্য app-এ lock করা। প্রতিটি key শুধু এক জায়গায় ব্যবহার করুন।" };
  return { success: true, data };
}

async function callHuggingFace(model: string, payload: any): Promise<any> {
  const HF_KEY = Deno.env.get("HUGGINGFACE_API_KEY") || Deno.env.get("HF_API_KEY");
  if (!HF_KEY) return { error: "Hugging Face API key not configured on server." };
  try {
    const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: "POST", headers: { "Authorization": `Bearer ${HF_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(payload)
    });
    if (response.status === 503) return { status: "loading", message: "মডেল লোড হচ্ছে। ৩০ সেকেন্ড পর আবার চেষ্টা করুন।" };
    if (!response.ok) { const t = await response.text(); return { error: `HF API error ${response.status}: ${t.substring(0, 200)}` }; }
    const ct = response.headers.get("content-type") || "";
    if (ct.includes("image/") || ct.includes("video/") || ct.includes("octet-stream")) {
      const buf = await response.arrayBuffer();
      return { status: "success", type: ct, size: buf.byteLength, note: "Binary output received." };
    }
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) return { status: "success", output: data[0].generated_text || JSON.stringify(data[0]) };
    return { status: "success", output: JSON.stringify(data) };
  } catch (e: any) { return { error: e.message }; }
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, ABDUL_KHALEK_RIDUY_API-KEY",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Content-Type": "application/json"
  };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const base44 = createClientFromRequest(req);
  const url = new URL(req.url);
  const queryAction = url.searchParams.get("action");
  let body: any = {};
  try { if (req.method === "POST") body = await req.json(); } catch {}
  const action = body.action || queryAction;
  const query = Object.fromEntries(url.searchParams.entries());
  const json = (d: any, s = 200) => new Response(JSON.stringify(d), { status: s, headers: corsHeaders });

  // ─── Generate API Key ─────────────────────────────────────────────────────
  if (action === "generate_key") {
    const newKey = generateApiKey();
    await base44.asServiceRole.entities.RiduyApiKey.create({
      apiKey: newKey, userIdentifier: body.userIdentifier || query.user || "anonymous",
      boundApp: body.bind_app || query.bind_app || "", isActive: true, dailyLimit: 100,
      todayCount: 0, lastResetDate: new Date().toISOString().split("T")[0],
      totalCalls: 0, createdAt: new Date().toISOString(), teachCommands: []
    });
    return json({ success: true, apiKey: newKey, headerName: "ABDUL_KHALEK_RIDUY_API-KEY", message: "আপনার API key তৈরি হয়েছে।", dailyLimit: 100, note: "এই key শুধু এক জায়গায় কাজ করবে।" });
  }

  // ─── Teach AI ─────────────────────────────────────────────────────────────
  if (action === "teach") {
    const apiKey = getApiKey(req, query, body);
    if (!apiKey) return json({ error: "API key required." }, 401);
    const kr = await validateApiKey(base44, apiKey, body.bind_app || "");
    if (!kr.success) return json({ error: kr.message }, 401);
    const td = body.teach_data || query.teach_data || "";
    if (!td) return json({ error: "teach_data দিন" }, 400);
    const cmds = kr.data.teachCommands || [];
    cmds.push(td);
    await base44.asServiceRole.entities.RiduyApiKey.update(kr.data.id, { teachCommands: cmds });
    return json({ success: true, message: "AI কে শেখানো হয়েছে!", totalCommands: cmds.length, latestCommand: td });
  }

  // ─── Get Teachings ────────────────────────────────────────────────────────
  if (action === "get_teachings") {
    const apiKey = getApiKey(req, query, body);
    if (!apiKey) return json({ error: "API key required." }, 401);
    const kr = await validateApiKey(base44, apiKey, body.bind_app || "");
    if (!kr.success) return json({ error: kr.message }, 401);
    return json({ success: true, teachings: kr.data.teachCommands || [], total: (kr.data.teachCommands || []).length });
  }

  // ─── Auth required for all other actions ──────────────────────────────────
  const apiKey = getApiKey(req, query, body);
  if (!apiKey) return json({ error: "API key required. Use header ABDUL_KHALEK_RIDUY_API-KEY or ?key=YOUR_KEY" }, 401);
  const kr = await validateApiKey(base44, apiKey, body.bind_app || query.bind_app || "");
  if (!kr.success) return json({ error: kr.message }, 401);

  // Daily limit check
  const today = new Date().toISOString().split("T")[0];
  let tc = kr.data.todayCount || 0;
  if (kr.data.lastResetDate !== today) tc = 0;
  if (tc >= (kr.data.dailyLimit || 100)) return json({ error: "Daily limit reached." }, 429);
  await base44.asServiceRole.entities.RiduyApiKey.update(kr.data.id, { todayCount: tc + 1, lastResetDate: today, totalCalls: (kr.data.totalCalls || 0) + 1 });

  const teachings = kr.data.teachCommands || [];
  const prompt = body.prompt || query.prompt || "";

  // 1. Text → Image Animation
  if (action === "text_to_image_animation") {
    if (!prompt) return json({ error: "prompt দিন" }, 400);
    const r = await callHuggingFace("damo-vilab/text-to-video-ms-1.7b", { inputs: prompt });
    return json({ success: true, type: "image_animation", prompt, result: r, teachings });
  }

  // 2. X → Video
  if (action === "x_to_video") {
    const iu = body.image_url || query.image_url || "";
    if (!prompt && !iu) return json({ error: "prompt বা image_url দিন" }, 400);
    const input = iu ? { inputs: iu, parameters: { prompt } } : { inputs: prompt };
    const r = await callHuggingFace("damo-vilab/text-to-video-ms-1.7b", input);
    return json({ success: true, type: "x_to_video", prompt, imageUrl: iu, result: r, teachings });
  }

  // 3. Chain Generation (Text→Image→Video→Text)
  if (action === "chain_generation") {
    if (!prompt) return json({ error: "prompt দিন" }, 400);
    const [img, vid, txt] = await Promise.all([
      callHuggingFace("stabilityai/stable-diffusion-xl-base-1.0", { inputs: prompt }),
      callHuggingFace("damo-vilab/text-to-video-ms-1.7b", { inputs: prompt }),
      callHuggingFace("mistralai/Mistral-7B-Instruct-v0.3", { inputs: `<system>You are Riduy AI. ${teachings.join("; ")}</system>\n[INST] ${prompt} [/INST]`, parameters: { max_new_tokens: 200 } })
    ]);
    return json({ success: true, type: "chain_generation", prompt, steps: { image: img, video: vid, text_response: txt }, teachings });
  }

  // 4a. Text → Image
  if (action === "text_to_image") {
    if (!prompt) return json({ error: "prompt দিন" }, 400);
    const fp = teachings.length > 0 ? `${prompt}. Style: ${teachings.join(", ")}` : prompt;
    const r = await callHuggingFace("stabilityai/stable-diffusion-xl-base-1.0", { inputs: fp });
    return json({ success: true, type: "text_to_image", prompt, result: r, teachings });
  }

  // 4b. Text → Image Edit
  if (action === "text_to_image_edit") {
    if (!prompt) return json({ error: "prompt দিন" }, 400);
    const ei = body.edit_instruction || query.edit_instruction || "";
    const fp = ei ? `${prompt}. Edit: ${ei}` : prompt;
    const r = await callHuggingFace("stabilityai/stable-diffusion-xl-base-1.0", { inputs: fp });
    return json({ success: true, type: "text_to_image_edit", prompt, editInstruction: ei, result: r, teachings });
  }

  // 5a. Text → Code
  if (action === "text_to_code") {
    if (!prompt) return json({ error: "prompt দিন — কী কোড চান?" }, 400);
    const sp = `You are Riduy AI Code Generator. ${teachings.join("; ")}. Generate clean, working code for: ${prompt}`;
    const r = await callHuggingFace("mistralai/Mistral-7B-Instruct-v0.3", { inputs: `<system>${sp}</system>\n[INST] ${prompt} [/INST]`, parameters: { max_new_tokens: 500, temperature: 0.2 } });
    return json({ success: true, type: "text_to_code", prompt, code: r, teachings });
  }

  // 5b. Text → Code Edit
  if (action === "text_to_code_edit") {
    if (!prompt) return json({ error: "prompt দিন" }, 400);
    const ei = body.edit_instruction || query.edit_instruction || "";
    const fp = `Original code: ${prompt}\nEdit instruction: ${ei || "Improve and fix the code"}`;
    const r = await callHuggingFace("mistralai/Mistral-7B-Instruct-v0.3", { inputs: `<system>You are Riduy AI Code Editor. ${teachings.join("; ")}</system>\n[INST] ${fp} [/INST]`, parameters: { max_new_tokens: 500, temperature: 0.2 } });
    return json({ success: true, type: "text_to_code_edit", prompt, editInstruction: ei, code: r, teachings });
  }

  // History
  if (action === "history") {
    const gens = await base44.asServiceRole.entities.RiduyGeneration.list({ limit: 20, sort: "-created_date" });
    return json({ success: true, history: gens });
  }

  return json({ error: "Unknown action", availableActions: ["generate_key","teach","get_teachings","text_to_image_animation","x_to_video","chain_generation","text_to_image","text_to_image_edit","text_to_code","text_to_code_edit","history"] }, 400);
});
