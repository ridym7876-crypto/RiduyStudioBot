// Riduy AI API — পৃথিবীর সবচেয়ে শক্তিশালী ফ্রি AI API প্ল্যাটফর্ম
// 5টি আলাদা API + API Key auth + AI teaching system
// Header: ABDUL_KHALEK_RIDUY_API-KEY
// Key format: Riduy + 35 random chars + Apik

import { createClientFromRequest } from "npm:@base44/sdk@0.8.31";

// ─── API Key Generator ───────────────────────────────────────────────────────
function generateApiKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let random = "";
  for (let i = 0; i < 35; i++) {
    random += chars[Math.floor(Math.random() * chars.length)];
  }
  return `Riduy${random}Apik`;
}

function getApiKey(req: Request): string | null {
  const headers = req.headers;
  return headers.get("ABDUL_KHALEK_RIDUY_API-KEY") ||
         headers.get("abdul_khalek_riduy_api-key") ||
         headers.get("x-api-key") ||
         null;
}

async function validateApiKey(base44: any, apiKey: string, bindApp: string): Promise<{success: boolean, data?: any, message?: string}> {
  if (!apiKey.startsWith("Riduy") || !apiKey.endsWith("Apik")) {
    return { success: false, message: "Invalid key format. Key must start with 'Riduy' and end with 'Apik'" };
  }

  if (apiKey.length < 40 || apiKey.length > 45) {
    return { success: false, message: "Invalid key length. Must be 40-45 characters." };
  }

  const keys = await base44.entities.RiduyApiKey.list({
    filter: { apiKey, isActive: true },
    limit: 1
  });

  if (!keys || keys.length === 0) {
    return { success: false, message: "API key not found or deactivated." };
  }

  const keyData = keys[0];

  if (keyData.data.boundApp && bindApp && keyData.data.boundApp !== bindApp) {
    return { success: false, message: "এই API key অন্য app-এ lock করা। প্রতিটি key শুধু এক জায়গায় ব্যবহার করুন।" };
  }

  return { success: true, data: keyData };
}

async function callHuggingFace(model: string, payload: any): Promise<any> {
  const HF_KEY = Deno.env.get("HUGGINGFACE_API_KEY") || Deno.env.get("HF_API_KEY");
  if (!HF_KEY) {
    return { error: "Hugging Face API key not configured on server." };
  }

  try {
    const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${HF_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (response.status === 503) {
      return { status: "loading", message: "মডেল লোড হচ্ছে। ৩০ সেকেন্ড পর আবার চেষ্টা করুন।" };
    }

    if (!response.ok) {
      const text = await response.text();
      return { error: `HF API error ${response.status}: ${text.substring(0, 200)}` };
    }

    const contentType = response.headers.get("content-type") || "";

    // Image/Video response (binary)
    if (contentType.includes("image/") || contentType.includes("video/") || contentType.includes("octet-stream")) {
      const buffer = await response.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      return {
        status: "success",
        type: contentType,
        size: buffer.byteLength,
        base64: base64.substring(0, 100) + "...[truncated]",
        note: "Binary output received successfully."
      };
    }

    // JSON response (text/code)
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      const text = data[0].generated_text || JSON.stringify(data[0]);
      return { status: "success", output: text };
    }
    return { status: "success", output: JSON.stringify(data) };

  } catch (error: any) {
    return { error: error.message };
  }
}

// ─── Main Handler ────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // CORS
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, ABDUL_KHALEK_RIDUY_API-KEY",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const base44 = createClientFromRequest(req);
  const url = new URL(req.url);
  const queryAction = url.searchParams.get("action");

  let body: any = {};
  try {
    if (req.method === "POST") {
      body = await req.json();
    }
  } catch {}

  const action = body.action || queryAction;
  const query = Object.fromEntries(url.searchParams.entries());

  const json = (data: any, status = 200) => {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders });
  };

  // ─── Action: Generate API Key ─────────────────────────────────────────────
  if (action === "generate_key") {
    const newKey = generateApiKey();
    const userIdentifier = body.userIdentifier || query.user || "anonymous";
    const bindApp = body.bind_app || query.bind_app || "";

    await base44.entities.RiduyApiKey.create({
      apiKey: newKey,
      userIdentifier,
      boundApp: bindApp,
      isActive: true,
      dailyLimit: 100,
      todayCount: 0,
      lastResetDate: new Date().toISOString().split("T")[0],
      totalCalls: 0,
      createdAt: new Date().toISOString(),
      teachCommands: []
    });

    return json({
      success: true,
      apiKey: newKey,
      headerName: "ABDUL_KHALEK_RIDUY_API-KEY",
      message: "আপনার API key তৈরি হয়েছে। এটি শুধু একটি app/website/game-এ ব্যবহার করুন।",
      dailyLimit: 100,
      note: "এই key শুধু এক জায়গায় কাজ করবে।"
    });
  }

  // ─── Action: Teach AI ─────────────────────────────────────────────────────
  if (action === "teach") {
    const apiKey = getApiKey(req);
    if (!apiKey) return json({ error: "API key required. Header: ABDUL_KHALEK_RIDUY_API-KEY" }, 401);

    const keyRecord = await validateApiKey(base44, apiKey, body.bind_app || "");
    if (!keyRecord.success) return json({ error: keyRecord.message }, 401);

    const teachData = body.teach_data || query.teach_data || "";
    if (!teachData) return json({ error: "teach_data দিন — কী শেখাতে চান?" }, 400);

    const existingCommands = keyRecord.data.teachCommands || [];
    existingCommands.push(teachData);

    await base44.entities.RiduyApiKey.update(keyRecord.data.id, {
      teachCommands: existingCommands
    });

    return json({
      success: true,
      message: "AI কে শেখানো হয়েছে!",
      totalCommands: existingCommands.length,
      latestCommand: teachData
    });
  }

  // ─── Action: Get Teachings ────────────────────────────────────────────────
  if (action === "get_teachings") {
    const apiKey = getApiKey(req);
    if (!apiKey) return json({ error: "API key required." }, 401);

    const keyRecord = await validateApiKey(base44, apiKey, body.bind_app || "");
    if (!keyRecord.success) return json({ error: keyRecord.message }, 401);

    return json({
      success: true,
      teachings: keyRecord.data.teachCommands || [],
      total: (keyRecord.data.teachCommands || []).length
    });
  }

  // ─── বাকি সব action-এর জন্য API Key লাগবে ────────────────────────────────
  const apiKey = getApiKey(req);
  if (!apiKey) {
    return json({
      error: "API key required. Use header: ABDUL_KHALEK_RIDUY_API-KEY",
      hint: "Key format: Riduy + 35 chars + Apik. Generate with action=generate_key"
    }, 401);
  }

  const keyRecord = await validateApiKey(base44, apiKey, body.bind_app || query.bind_app || "");
  if (!keyRecord.success) return json({ error: keyRecord.message }, 401);

  // Check daily limit
  const today = new Date().toISOString().split("T")[0];
  let todayCount = keyRecord.data.todayCount || 0;
  if (keyRecord.data.lastResetDate !== today) {
    todayCount = 0;
  }
  if (todayCount >= (keyRecord.data.dailyLimit || 100)) {
    return json({
      error: "Daily limit reached. আগামীকাল আবার চেষ্টা করুন।",
      limit: keyRecord.data.dailyLimit,
      used: todayCount
    }, 429);
  }

  // Increment usage
  await base44.entities.RiduyApiKey.update(keyRecord.data.id, {
    todayCount: todayCount + 1,
    lastResetDate: today,
    totalCalls: (keyRecord.data.totalCalls || 0) + 1
  });

  const teachings = keyRecord.data.teachCommands || [];
  const prompt = body.prompt || query.prompt || "";

  // ─── 1. Text → Image Animation ────────────────────────────────────────────
  if (action === "text_to_image_animation") {
    if (!prompt) return json({ error: "prompt দিন" }, 400);

    const result = await callHuggingFace("damo-vilab/text-to-video-ms-1.7b", { inputs: prompt });
    return json({ success: true, type: "image_animation", prompt, result, teachings });
  }

  // ─── 2. X → Video ──────────────────────────────────────────────────────────
  if (action === "x_to_video") {
    const imageUrl = body.image_url || query.image_url || "";
    if (!prompt && !imageUrl) return json({ error: "prompt বা image_url দিন" }, 400);

    const input = imageUrl ? { inputs: imageUrl, parameters: { prompt } } : { inputs: prompt };
    const result = await callHuggingFace("damo-vilab/text-to-video-ms-1.7b", input);
    return json({ success: true, type: "x_to_video", prompt, imageUrl, result, teachings });
  }

  // ─── 3. Chain Generation (Text→Image→Video→Audio→Text) ─────────────────────
  if (action === "chain_generation") {
    if (!prompt) return json({ error: "prompt দিন" }, 400);

    const [imageResult, videoResult, textResponse] = await Promise.all([
      callHuggingFace("stabilityai/stable-diffusion-xl-base-1.0", { inputs: prompt }),
      callHuggingFace("damo-vilab/text-to-video-ms-1.7b", { inputs: prompt }),
      callHuggingFace("mistralai/Mistral-7B-Instruct-v0.3", {
        inputs: `<system>You are Riduy AI. ${teachings.join("; ")}</system>\n[INST] ${prompt} [/INST]`,
        parameters: { max_new_tokens: 200 }
      })
    ]);

    return json({
      success: true,
      type: "chain_generation",
      prompt,
      steps: { image: imageResult, video: videoResult, text_response: textResponse },
      teachings
    });
  }

  // ─── 4a. Text → Image ──────────────────────────────────────────────────────
  if (action === "text_to_image") {
    if (!prompt) return json({ error: "prompt দিন" }, 400);

    const fullPrompt = teachings.length > 0 ? `${prompt}. Style: ${teachings.join(", ")}` : prompt;
    const result = await callHuggingFace("stabilityai/stable-diffusion-xl-base-1.0", { inputs: fullPrompt });
    return json({ success: true, type: "text_to_image", prompt, result, teachings });
  }

  // ─── 4b. Text → Image Edit ─────────────────────────────────────────────────
  if (action === "text_to_image_edit") {
    if (!prompt) return json({ error: "prompt দিন" }, 400);

    const editInstruction = body.edit_instruction || query.edit_instruction || "";
    const fullPrompt = editInstruction ? `${prompt}. Edit: ${editInstruction}` : prompt;
    const result = await callHuggingFace("stabilityai/stable-diffusion-xl-base-1.0", { inputs: fullPrompt });
    return json({ success: true, type: "text_to_image_edit", prompt, editInstruction, result, teachings });
  }

  // ─── 5a. Text → Code ───────────────────────────────────────────────────────
  if (action === "text_to_code") {
    if (!prompt) return json({ error: "prompt দিন — কী কোড চান?" }, 400);

    const systemPrompt = `You are Riduy AI Code Generator. ${teachings.join("; ")}. Generate clean, working code for: ${prompt}`;
    const result = await callHuggingFace("mistralai/Mistral-7B-Instruct-v0.3", {
      inputs: `<system>${systemPrompt}</system>\n[INST] ${prompt} [/INST]`,
      parameters: { max_new_tokens: 500, temperature: 0.2 }
    });
    return json({ success: true, type: "text_to_code", prompt, code: result, teachings });
  }

  // ─── 5b. Text → Code Edit ──────────────────────────────────────────────────
  if (action === "text_to_code_edit") {
    if (!prompt) return json({ error: "prompt দিন — কোন কোড edit করবেন?" }, 400);

    const editInstruction = body.edit_instruction || query.edit_instruction || "";
    const fullPrompt = `Original code: ${prompt}\nEdit instruction: ${editInstruction || "Improve and fix the code"}`;
    const result = await callHuggingFace("mistralai/Mistral-7B-Instruct-v0.3", {
      inputs: `<system>You are Riduy AI Code Editor. ${teachings.join("; ")}</system>\n[INST] ${fullPrompt} [/INST]`,
      parameters: { max_new_tokens: 500, temperature: 0.2 }
    });
    return json({ success: true, type: "text_to_code_edit", prompt, editInstruction, code: result, teachings });
  }

  // ─── History ───────────────────────────────────────────────────────────────
  if (action === "history") {
    const generations = await base44.entities.RiduyGeneration.list({
      filter: { userIdentifier: keyRecord.data.userIdentifier },
      limit: 20,
      sort: "-created_date"
    });
    return json({ success: true, history: generations });
  }

  // ─── Unknown action ────────────────────────────────────────────────────────
  return json({
    error: "Unknown action",
    availableActions: [
      "generate_key",
      "teach",
      "get_teachings",
      "text_to_image_animation",
      "x_to_video",
      "chain_generation",
      "text_to_image",
      "text_to_image_edit",
      "text_to_code",
      "text_to_code_edit",
      "history"
    ]
  }, 400);
});
