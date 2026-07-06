// Riduy AI API — ফ্রি AI API প্ল্যাটফর্ম
import { createClientFromRequest } from "npm:@base44/sdk@0.8.31";

function generateApiKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let random = "";
  for (let i = 0; i < 35; i++) { random += chars[Math.floor(Math.random() * chars.length)]; }
  return `Riduy${random}Apik`;
}

function getApiKey(req: Request, query: any, body: any): string | null {
  return req.headers.get("ABDUL_KHALEK_RIDUY_API-KEY") || req.headers.get("abdul_khalek_riduy_api-key") || req.headers.get("x-api-key") || query.key || body.key || null;
}

// Direct API call to Base44 to list entity records (bypasses SDK auth issues)
async function listKeysViaAPI(): Promise<any[]> {
  const token = Deno.env.get("BASE44_SERVICE_TOKEN");
  if (!token) return [];
  try {
    const r = await fetch("https://api.base44.com/api/apps/6a405e6e979c2a41456c4c60/entities/RiduyApiKey/records?limit=100", {
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }
    });
    if (!r.ok) return [];
    const data = await r.json();
    return data.records || data.data || data || [];
  } catch { return []; }
}

async function createKeyViaAPI(keyData: any): Promise<boolean> {
  const token = Deno.env.get("BASE44_SERVICE_TOKEN");
  if (!token) return false;
  try {
    const r = await fetch("https://api.base44.com/api/apps/6a405e6e979c2a41456c4c60/entities/RiduyApiKey/records", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(keyData)
    });
    return r.ok;
  } catch { return false; }
}

async function updateKeyViaAPI(id: string, updateData: any): Promise<boolean> {
  const token = Deno.env.get("BASE44_SERVICE_TOKEN");
  if (!token) return false;
  try {
    const r = await fetch(`https://api.base44.com/api/apps/6a405e6e979c2a41456c4c60/entities/RiduyApiKey/records/${id}`, {
      method: "PATCH",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(updateData)
    });
    return r.ok;
  } catch { return false; }
}

async function validateApiKey(apiKey: string, bindApp: string): Promise<{success: boolean, data?: any, message?: string}> {
  if (!apiKey.startsWith("Riduy") || !apiKey.endsWith("Apik")) return { success: false, message: "Invalid key format." };
  if (apiKey.length < 40 || apiKey.length > 45) return { success: false, message: "Invalid key length." };

  const keys = await listKeysViaAPI();
  const keyData = keys.find((k: any) => {
    const ka = k.data?.apiKey || k.apiKey;
    const ia = k.data?.isActive ?? k.isActive;
    return ka === apiKey && ia === true;
  });

  if (!keyData) return { success: false, message: "Key not found. DB has " + keys.length + " keys." };
  const data = keyData.data || keyData;
  if (data.boundApp && bindApp && data.boundApp !== bindApp) return { success: false, message: "এই API key অন্য app-এ lock করা।" };
  return { success: true, data: { ...data, id: keyData.id || keyData._id } };
}

async function callHF(model: string, payload: any): Promise<any> {
  const HF_KEY = Deno.env.get("HUGGINGFACE_API_KEY") || Deno.env.get("HF_API_KEY");
  if (!HF_KEY) return { error: "HF API key not configured." };
  try {
    const r = await fetch(`https://api-inference.huggingface.co/models/${model}`, { method: "POST", headers: { "Authorization": `Bearer ${HF_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (r.status === 503) return { status: "loading", message: "মডেল লোড হচ্ছে। ৩০ সেকেন্ড পর চেষ্টা করুন।" };
    if (!r.ok) { const t = await r.text(); return { error: `HF error ${r.status}: ${t.substring(0, 200)}` }; }
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("image/") || ct.includes("video/") || ct.includes("octet-stream")) { const buf = await r.arrayBuffer(); return { status: "success", type: ct, size: buf.byteLength }; }
    const data = await r.json();
    if (Array.isArray(data) && data.length > 0) return { status: "success", output: data[0].generated_text || JSON.stringify(data[0]) };
    return { status: "success", output: JSON.stringify(data) };
  } catch (e: any) { return { error: e.message }; }
}

Deno.serve(async (req: Request) => {
  const ch = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, ABDUL_KHALEK_RIDUY_API-KEY", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: ch });
  const url = new URL(req.url);
  let body: any = {};
  try { if (req.method === "POST") body = await req.json(); } catch {}
  const action = body.action || url.searchParams.get("action");
  const query = Object.fromEntries(url.searchParams.entries());
  const json = (d: any, s = 200) => new Response(JSON.stringify(d), { status: s, headers: ch });

  // Generate API Key
  if (action === "generate_key") {
    const newKey = generateApiKey();
    const ok = await createKeyViaAPI({
      apiKey: newKey, userIdentifier: body.userIdentifier || query.user || "anonymous",
      boundApp: body.bind_app || query.bind_app || "", isActive: true, dailyLimit: 100,
      todayCount: 0, lastResetDate: new Date().toISOString().split("T")[0],
      totalCalls: 0, createdAt: new Date().toISOString(), teachCommands: []
    });
    if (!ok) return json({ error: "Failed to save key to DB." }, 500);
    return json({ success: true, apiKey: newKey, headerName: "ABDUL_KHALEK_RIDUY_API-KEY", message: "API key তৈরি হয়েছে।", dailyLimit: 100 });
  }

  // Teach AI
  if (action === "teach") {
    const ak = getApiKey(req, query, body);
    if (!ak) return json({ error: "API key required." }, 401);
    const kr = await validateApiKey(ak, body.bind_app || "");
    if (!kr.success) return json({ error: kr.message }, 401);
    const td = body.teach_data || query.teach_data || "";
    if (!td) return json({ error: "teach_data দিন" }, 400);
    const cmds = kr.data.teachCommands || [];
    cmds.push(td);
    await updateKeyViaAPI(kr.data.id, { teachCommands: cmds });
    return json({ success: true, message: "AI কে শেখানো হয়েছে!", totalCommands: cmds.length });
  }

  // Get Teachings
  if (action === "get_teachings") {
    const ak = getApiKey(req, query, body);
    if (!ak) return json({ error: "API key required." }, 401);
    const kr = await validateApiKey(ak, body.bind_app || "");
    if (!kr.success) return json({ error: kr.message }, 401);
    return json({ success: true, teachings: kr.data.teachCommands || [], total: (kr.data.teachCommands || []).length });
  }

  // All other actions require API key
  const ak = getApiKey(req, query, body);
  if (!ak) return json({ error: "API key required. Use header ABDUL_KHALEK_RIDUY_API-KEY or ?key=YOUR_KEY" }, 401);
  const kr = await validateApiKey(ak, body.bind_app || query.bind_app || "");
  if (!kr.success) return json({ error: kr.message }, 401);

  // Daily limit
  const today = new Date().toISOString().split("T")[0];
  let tc = kr.data.todayCount || 0;
  if (kr.data.lastResetDate !== today) tc = 0;
  if (tc >= (kr.data.dailyLimit || 100)) return json({ error: "Daily limit reached." }, 429);
  await updateKeyViaAPI(kr.data.id, { todayCount: tc + 1, lastResetDate: today, totalCalls: (kr.data.totalCalls || 0) + 1 });

  const teachings = kr.data.teachCommands || [];
  const prompt = body.prompt || query.prompt || "";

  if (action === "text_to_image_animation") { if (!prompt) return json({ error: "prompt দিন" }, 400); const r = await callHF("damo-vilab/text-to-video-ms-1.7b", { inputs: prompt }); return json({ success: true, type: "image_animation", prompt, result: r, teachings }); }
  if (action === "x_to_video") { const iu = body.image_url || query.image_url || ""; if (!prompt && !iu) return json({ error: "prompt বা image_url দিন" }, 400); const input = iu ? { inputs: iu, parameters: { prompt } } : { inputs: prompt }; const r = await callHF("damo-vilab/text-to-video-ms-1.7b", input); return json({ success: true, type: "x_to_video", prompt, imageUrl: iu, result: r, teachings }); }
  if (action === "chain_generation") { if (!prompt) return json({ error: "prompt দিন" }, 400); const [img, vid, txt] = await Promise.all([callHF("stabilityai/stable-diffusion-xl-base-1.0", { inputs: prompt }), callHF("damo-vilab/text-to-video-ms-1.7b", { inputs: prompt }), callHF("mistralai/Mistral-7B-Instruct-v0.3", { inputs: `<system>Riduy AI. ${teachings.join("; ")}</system>\n[INST] ${prompt} [/INST]`, parameters: { max_new_tokens: 200 } })]); return json({ success: true, type: "chain_generation", prompt, steps: { image: img, video: vid, text_response: txt }, teachings }); }
  if (action === "text_to_image") { if (!prompt) return json({ error: "prompt দিন" }, 400); const fp = teachings.length > 0 ? `${prompt}. Style: ${teachings.join(", ")}` : prompt; const r = await callHF("stabilityai/stable-diffusion-xl-base-1.0", { inputs: fp }); return json({ success: true, type: "text_to_image", prompt, result: r, teachings }); }
  if (action === "text_to_image_edit") { if (!prompt) return json({ error: "prompt দিন" }, 400); const ei = body.edit_instruction || query.edit_instruction || ""; const fp = ei ? `${prompt}. Edit: ${ei}` : prompt; const r = await callHF("stabilityai/stable-diffusion-xl-base-1.0", { inputs: fp }); return json({ success: true, type: "text_to_image_edit", prompt, editInstruction: ei, result: r, teachings }); }
  if (action === "text_to_code") { if (!prompt) return json({ error: "prompt দিন" }, 400); const sp = `You are Riduy AI Code Generator. ${teachings.join("; ")}. Generate clean code for: ${prompt}`; const r = await callHF("mistralai/Mistral-7B-Instruct-v0.3", { inputs: `<system>${sp}</system>\n[INST] ${prompt} [/INST]`, parameters: { max_new_tokens: 500, temperature: 0.2 } }); return json({ success: true, type: "text_to_code", prompt, code: r, teachings }); }
  if (action === "text_to_code_edit") { if (!prompt) return json({ error: "prompt দিন" }, 400); const ei = body.edit_instruction || query.edit_instruction || ""; const fp = `Original code: ${prompt}\nEdit: ${ei || "Improve and fix"}`; const r = await callHF("mistralai/Mistral-7B-Instruct-v0.3", { inputs: `<system>Riduy AI Code Editor. ${teachings.join("; ")}</system>\n[INST] ${fp} [/INST]`, parameters: { max_new_tokens: 500, temperature: 0.2 } }); return json({ success: true, type: "text_to_code_edit", prompt, editInstruction: ei, code: r, teachings }); }
  if (action === "history") { return json({ success: true, history: [] }); }
  return json({ error: "Unknown action", availableActions: ["generate_key","teach","get_teachings","text_to_image_animation","x_to_video","chain_generation","text_to_image","text_to_image_edit","text_to_code","text_to_code_edit","history"] }, 400);
});
