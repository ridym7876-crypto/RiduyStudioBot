import os
import time
import logging
import requests
import tempfile
import json

# ─── Config ───────────────────────────────────────────────────────────────────
TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
HF_API_KEY = os.environ.get("HUGGINGFACE_API_KEY") or os.environ.get("HF_API_KEY", "")
RIDUY_API_KEY = os.environ.get("ABDUL_KHALEK_RIDUY_API_KEY", "")

BASE_URL = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}"
HF_HEADERS = {"Authorization": f"Bearer {HF_API_KEY}", "Content-Type": "application/json"}

# Models
IMAGE_MODEL = "stabilityai/stable-diffusion-xl-base-1.0"
VIDEO_MODEL = "damo-vilab/text-to-video-ms-1.7b"
TEXT_MODEL = "mistralai/Mistral-7B-Instruct-v0.3"

logging.basicConfig(format="%(asctime)s - %(levelname)s - %(message)s", level=logging.INFO)
logger = logging.getLogger(__name__)

# ─── Telegram API helpers ─────────────────────────────────────────────────────
def send_message(chat_id, text, parse_mode="Markdown", reply_markup=None):
    payload = {"chat_id": chat_id, "text": text, "parse_mode": parse_mode}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    try:
        r = requests.post(f"{BASE_URL}/sendMessage", json=payload, timeout=10)
        return r.json().get("result", {})
    except Exception as e:
        logger.error(f"sendMessage error: {e}")
        return {}

def edit_message(chat_id, message_id, text, parse_mode="Markdown"):
    try:
        requests.post(f"{BASE_URL}/editMessageText", json={
            "chat_id": chat_id, "message_id": message_id,
            "text": text, "parse_mode": parse_mode
        }, timeout=10)
    except Exception as e:
        logger.error(f"editMessageText error: {e}")

def send_photo(chat_id, photo_bytes, caption=""):
    try:
        requests.post(f"{BASE_URL}/sendPhoto", data={"chat_id": chat_id, "caption": caption},
            files={"photo": ("image.png", photo_bytes, "image/png")}, timeout=30)
    except Exception as e:
        logger.error(f"sendPhoto error: {e}")

def send_video(chat_id, video_bytes, caption=""):
    try:
        requests.post(f"{BASE_URL}/sendVideo", data={"chat_id": chat_id, "caption": caption},
            files={"video": ("video.mp4", video_bytes, "video/mp4")}, timeout=60)
    except Exception as e:
        logger.error(f"sendVideo error: {e}")

def send_document(chat_id, content, filename, caption=""):
    try:
        requests.post(f"{BASE_URL}/sendDocument", data={"chat_id": chat_id, "caption": caption},
            files={"document": (filename, content, "text/plain")}, timeout=15)
    except Exception as e:
        logger.error(f"sendDocument error: {e}")

def answer_callback(callback_id):
    try:
        requests.post(f"{BASE_URL}/answerCallbackQuery", json={"callback_query_id": callback_id}, timeout=5)
    except:
        pass

def delete_message(chat_id, message_id):
    try:
        requests.post(f"{BASE_URL}/deleteMessage", json={"chat_id": chat_id, "message_id": message_id}, timeout=5)
    except:
        pass

# ─── HuggingFace API ──────────────────────────────────────────────────────────
def hf_call(model, payload, timeout=120):
    url = f"https://api-inference.huggingface.co/models/{model}"
    try:
        resp = requests.post(url, headers=HF_HEADERS, json=payload, timeout=timeout)
        if resp.status_code == 200:
            ct = resp.headers.get("content-type", "")
            if "image" in ct or "octet" in ct or "video" in ct:
                return resp.content, None
            data = resp.json()
            if isinstance(data, list) and data:
                return data[0].get("generated_text", str(data[0])), None
            return str(data), None
        elif resp.status_code == 503:
            return None, "loading"
        else:
            return None, f"Error {resp.status_code}: {resp.text[:150]}"
    except Exception as e:
        return None, str(e)

def hf_image(prompt):
    return hf_call(IMAGE_MODEL, {"inputs": prompt}, timeout=120)

def hf_video(prompt):
    return hf_call(VIDEO_MODEL, {"inputs": prompt}, timeout=180)

def hf_text(prompt, system_prompt="", max_tokens=500):
    full = f"<system>{system_prompt}</system>\n[INST] {prompt} [/INST]" if system_prompt else prompt
    return hf_call(TEXT_MODEL, {"inputs": full, "parameters": {"max_new_tokens": max_tokens, "temperature": 0.2}}, timeout=60)

# ─── Teach storage (in-memory per chat) ───────────────────────────────────────
TEACHINGS = {}  # chat_id -> list of teachings

def get_teachings(chat_id):
    return TEACHINGS.get(chat_id, [])

def add_teaching(chat_id, text):
    if chat_id not in TEACHINGS:
        TEACHINGS[chat_id] = []
    TEACHINGS[chat_id].append(text)
    return len(TEACHINGS[chat_id])

# ─── Handlers ─────────────────────────────────────────────────────────────────
def handle_start(chat_id):
    keyboard = {"inline_keyboard": [
        [{"text": "🎨 ইমেজ", "callback_data": "gen_image"}, {"text": "🎬 ভিডিও", "callback_data": "gen_video"}],
        [{"text": "💻 কোড", "callback_data": "gen_code"}, {"text": "🔗 চেইন-জেন", "callback_data": "gen_chain"}],
        [{"text": "✏️ ইমেজ এডিট", "callback_data": "gen_imgedit"}, {"text": "📝 কোড এডিট", "callback_data": "gen_codeedit"}],
        [{"text": "🧠 AI কে শেখান", "callback_data": "teach"}, {"text": "ℹ️ সাহায্য", "callback_data": "help"}],
    ]}
    send_message(chat_id,
        "👋 *RiduyStudio Bot*-এ স্বাগতম!\n\n"
        "🎨 AI ইমেজ · 🎬 ভিডিও · 💻 কোড · 🔗 চেইন-জেন\n"
        "✏️ এডিট · 🧠 শেখানো\n\n"
        "নিচের অপশন বেছে নিন বা কমান্ড লিখুন:",
        reply_markup=keyboard
    )

def handle_help(chat_id):
    send_message(chat_id,
        "📖 *কমান্ড লিস্ট:*\n\n"
        "/start — শুরু করুন\n"
        "/image `<প্রম্পট>` — AI ইমেজ তৈরি\n"
        "/video `<প্রম্পট>` — AI ভিডিও তৈরি\n"
        "/code `<কী কোড চান>` — AI কোড লিখবে\n"
        "/codeedit `<কোড>` — কোড এডিট/ফিক্স\n"
        "/imgedit `<প্রম্পট>` — ইমেজ এডিট\n"
        "/chain `<প্রম্পট>` — ইমেজ+ভিডিও+টেক্সট একসাথে\n"
        "/teach `<নির্দেশ>` — AI কে শেখান\n"
        "/myteach — আপনার teachings দেখুন\n"
        "/keygen — নতুন API key তৈরি\n"
        "/help — সাহায্য\n\n"
        "উদাহরণ:\n"
        "`/image a beautiful sunset over the ocean`\n"
        "`/code write a Python fibonacci function`\n"
        "`/chain a futuristic city at night`"
    )

def handle_image(chat_id, prompt):
    teachings = get_teachings(chat_id)
    full_prompt = f"{prompt}. Style: {', '.join(teachings)}" if teachings else prompt
    msg = send_message(chat_id, f"🎨 ইমেজ তৈরি হচ্ছে...\nপ্রম্পট: *{prompt}*\n⏳ অপেক্ষা করুন...")
    msg_id = msg.get("message_id")
    data, error = hf_image(full_prompt)
    if data and isinstance(data, bytes):
        send_photo(chat_id, data, caption=f"✅ ইমেজ তৈরি হয়েছে!\nপ্রম্পট: {prompt}")
        if msg_id: delete_message(chat_id, msg_id)
    elif error == "loading":
        if msg_id: edit_message(chat_id, msg_id, f"⏳ মডেল লোড হচ্ছে। ৩০ সেকেন্ড পর আবার চেষ্টা করুন।\n`/image {prompt}`")
    else:
        if msg_id: edit_message(chat_id, msg_id, f"❌ ইমেজ তৈরি হয়নি।\n{error or ''}", parse_mode="")

def handle_video(chat_id, prompt):
    msg = send_message(chat_id, f"🎬 ভিডিও তৈরি হচ্ছে...\nপ্রম্পট: *{prompt}*\n⏳ ১-২ মিনিট সময় লাগতে পারে...")
    msg_id = msg.get("message_id")
    data, error = hf_video(prompt)
    if data and isinstance(data, bytes):
        send_video(chat_id, data, caption=f"✅ ভিডিও তৈরি হয়েছে!\nপ্রম্পট: {prompt}")
        if msg_id: delete_message(chat_id, msg_id)
    elif error == "loading":
        if msg_id: edit_message(chat_id, msg_id, f"⏳ মডেল লোড হচ্ছে। ১ মিনিট পর আবার চেষ্টা করুন।\n`/video {prompt}`")
    else:
        if msg_id: edit_message(chat_id, msg_id, f"❌ ভিডিও তৈরি হয়নি।\n{error or ''}", parse_mode="")

def handle_code(chat_id, prompt):
    teachings = get_teachings(chat_id)
    sys_prompt = f"You are Riduy AI Code Generator. {'; '.join(teachings)}. Generate clean, working code for: {prompt}"
    msg = send_message(chat_id, f"💻 কোড লিখছি...\nপ্রম্পট: *{prompt}*\n⏳ অপেক্ষা করুন...")
    msg_id = msg.get("message_id")
    result, error = hf_text(prompt, system_prompt=sys_prompt, max_tokens=500)
    if result and isinstance(result, str) and len(result) > 10:
        # Send as document for long code, message for short
        if len(result) > 3500:
            send_document(chat_id, result.encode(), "riduy_code.txt", caption=f"✅ কোড তৈরি হয়েছে!\nপ্রম্পট: {prompt}")
            if msg_id: delete_message(chat_id, msg_id)
        else:
            code_text = f"```\n{result}\n```"
            if msg_id:
                edit_message(chat_id, msg_id, f"✅ কোড তৈরি হয়েছে!\n\n{code_text}")
            else:
                send_message(chat_id, f"✅ কোড তৈরি হয়েছে!\n\n{code_text}")
    elif error == "loading":
        if msg_id: edit_message(chat_id, msg_id, "⏳ মডেল লোড হচ্ছে। ৩০ সেকেন্ড পর আবার চেষ্টা করুন।")
    else:
        if msg_id: edit_message(chat_id, msg_id, f"❌ কোড তৈরি হয়নি।\n{error or ''}", parse_mode="")

def handle_code_edit(chat_id, prompt):
    teachings = get_teachings(chat_id)
    sys_prompt = f"You are Riduy AI Code Editor. {'; '.join(teachings)}. Improve and fix the code."
    msg = send_message(chat_id, f"📝 কোড এডিট হচ্ছে...\n⏳ অপেক্ষা করুন...")
    msg_id = msg.get("message_id")
    result, error = hf_text(f"Original code: {prompt}\nEdit: Improve and fix", system_prompt=sys_prompt, max_tokens=500)
    if result and isinstance(result, str) and len(result) > 10:
        code_text = f"```\n{result}\n```"
        if len(result) > 3500:
            send_document(chat_id, result.encode(), "riduy_edited_code.txt", caption="✅ কোড এডিট হয়েছে!")
            if msg_id: delete_message(chat_id, msg_id)
        else:
            if msg_id: edit_message(chat_id, msg_id, f"✅ কোড এডিট হয়েছে!\n\n{code_text}")
    elif error == "loading":
        if msg_id: edit_message(chat_id, msg_id, "⏳ মডেল লোড হচ্ছে। ৩০ সেকেন্ড পর আবার চেষ্টা করুন।")
    else:
        if msg_id: edit_message(chat_id, msg_id, f"❌ কোড এডিট হয়নি।\n{error or ''}", parse_mode="")

def handle_image_edit(chat_id, prompt):
    teachings = get_teachings(chat_id)
    full_prompt = f"{prompt}. Edit: {', '.join(teachings)}" if teachings else prompt
    msg = send_message(chat_id, f"✏️ ইমেজ এডিট হচ্ছে...\nপ্রম্পট: *{prompt}*\n⏳ অপেক্ষা করুন...")
    msg_id = msg.get("message_id")
    data, error = hf_image(full_prompt)
    if data and isinstance(data, bytes):
        send_photo(chat_id, data, caption=f"✅ ইমেজ এডিট হয়েছে!\nপ্রম্পট: {prompt}")
        if msg_id: delete_message(chat_id, msg_id)
    elif error == "loading":
        if msg_id: edit_message(chat_id, msg_id, "⏳ মডেল লোড হচ্ছে। ৩০ সেকেন্ড পর আবার চেষ্টা করুন।")
    else:
        if msg_id: edit_message(chat_id, msg_id, f"❌ এডিট হয়নি।\n{error or ''}", parse_mode="")

def handle_chain(chat_id, prompt):
    teachings = get_teachings(chat_id)
    msg = send_message(chat_id, f"🔗 চেইন-জেন শুরু!\nপ্রম্পট: *{prompt}*\n⏳ ইমেজ + ভিডিও + টেক্সট একসাথে তৈরি হচ্ছে...")
    msg_id = msg.get("message_id")

    sys_prompt = f"You are Riduy AI. {'; '.join(teachings)}"
    # Run all 3 in sequence (HF free tier doesn't guarantee parallel)
    img_result, img_err = hf_image(prompt)
    vid_result, vid_err = hf_video(prompt)
    txt_result, txt_err = hf_text(prompt, system_prompt=sys_prompt, max_tokens=200)

    parts = []
    if img_result and isinstance(img_result, bytes):
        send_photo(chat_id, img_result, caption=f"🎨 চেইন স্টেপ ১: ইমেজ")
        parts.append("✅ ইমেজ")
    else:
        parts.append(f"❌ ইমেজ ({img_err or 'fail'})")

    if vid_result and isinstance(vid_result, bytes):
        send_video(chat_id, vid_result, caption=f"🎬 চেইন স্টেপ ২: ভিডিও")
        parts.append("✅ ভিডিও")
    else:
        parts.append(f"❌ ভিডিও ({vid_err or 'fail'})")

    if txt_result and isinstance(txt_result, str):
        parts.append("✅ টেক্সট")
        # Send text response
        send_message(chat_id, f"💬 চেইন স্টেপ ৩: AI রেসপন্স\n\n{txt_result[:2000]}", parse_mode="")
    else:
        parts.append(f"❌ টেক্সট ({txt_err or 'fail'})")

    summary = "🔗 চেইন-জেন সম্পূর্ণ!\n\n" + "\n".join(parts)
    if msg_id:
        edit_message(chat_id, msg_id, summary, parse_mode="")
    else:
        send_message(chat_id, summary, parse_mode="")

def handle_teach(chat_id, text):
    if not text:
        send_message(chat_id, "🧠 AI কে কী শেখাবেন?\n\nউদাহরণ:\n`/teach always use dark theme`\n`/teach ছবিতে নদী রাখবেন`")
        return
    count = add_teaching(chat_id, text)
    send_message(chat_id, f"✅ AI কে শেখানো হয়েছে!\n📝 মোট teachings: {count}\n📖 শেখানো হয়েছে: {text}")

def handle_myteach(chat_id):
    teachings = get_teachings(chat_id)
    if not teachings:
        send_message(chat_id, "📝 আপনি এখনো কিছু শেখাননি।\n`/teach <নির্দেশ>` দিয়ে শেখান।")
        return
    text = "📝 আপনার teachings:\n\n" + "\n".join([f"{i+1}. {t}" for i, t in enumerate(teachings)])
    send_message(chat_id, text, parse_mode="")

def handle_keygen(chat_id):
    import string, random
    chars = string.ascii_letters + string.digits
    random_part = ''.join(random.choice(chars) for _ in range(35))
    new_key = f"Riduy{random_part}Apik"
    send_message(chat_id,
        f"🔑 আপনার নতুন Riduy API Key:\n\n`{new_key}`\n\n"
        f"Header: `ABDUL_KHALEK_RIDUY_API-KEY`\n"
        f"দৈনিক লিমিট: 100 calls\n"
        f"⚠️ এই key শুধু এক জায়গায় ব্যবহার করুন।",
    )

def handle_text(chat_id, text):
    t = text.lower()
    if any(w in t for w in ["image", "ইমেজ", "ছবি", "picture", "photo", "draw", "আঁক"]):
        send_message(chat_id, "🎨 ইমেজ তৈরি করতে:\n`/image আপনার প্রম্পট`\n\nউদাহরণ:\n`/image a beautiful sunset`")
    elif any(w in t for w in ["video", "ভিডিও", "animation", "অ্যানিমেশন"]):
        send_message(chat_id, "🎬 ভিডিও তৈরি করতে:\n`/video আপনার প্রম্পট`\n\nউদাহরণ:\n`/video a cat walking in rain`")
    elif any(w in t for w in ["code", "কোড", "program", "প্রোগ্রাম"]):
        send_message(chat_id, "💻 কোড তৈরি করতে:\n`/code কী কোড চান`\n\nউদাহরণ:\n`/code write a Python fibonacci function`")
    elif any(w in t for w in ["hello", "hi", "হ্যালো", "হেলো", "সালাম", "আসসালামু"]):
        send_message(chat_id, "👋 হ্যালো! আমি RiduyStudio Bot।\n\n🎨 ইমেজ · 🎬 ভিডিও · 💻 কোড · 🔗 চেইন-জেন\n/start দিয়ে শুরু করুন।", parse_mode="")
    elif any(w in t for w in ["help", "সাহায্য", "হেল্প"]):
        handle_help(chat_id)
    else:
        send_message(chat_id,
            "❓ বুঝতে পারিনি!\n\n"
            "🎨 `/image` — ইমেজ\ntl;🎬 `/video` — ভিডিও\n"
            "💻 `/code` — কোড\n🔗 `/chain` — চেইন-জেন\n"
            "✏️ `/imgedit` — ইমেজ এডিট\n📝 `/codeedit` — কোড এডিট\n"
            "🧠 `/teach` — AI কে শেখান\n📖 /help — সাহায্য"
        )

def handle_callback(callback_query):
    cid = callback_query["id"]
    chat_id = callback_query["message"]["chat"]["id"]
    msg_id = callback_query["message"]["message_id"]
    data = callback_query.get("data", "")
    answer_callback(cid)
    guides = {
        "gen_image": "🎨 ইমেজ তৈরি করতে লিখুন:\n`/image আপনার প্রম্পট`\n\nউদাহরণ:\n`/image a beautiful mountain landscape`",
        "gen_video": "🎬 ভিডিও তৈরি করতে লিখুন:\n`/video আপনার প্রম্পট`\n\nউদাহরণ:\n`/video a cat walking in the rain`",
        "gen_code": "💻 কোড তৈরি করতে লিখুন:\n`/code কী কোড চান`\n\nউদাহরণ:\n`/code write a Python web scraper`",
        "gen_chain": "🔗 চেইন-জেন করতে লিখুন:\n`/chain আপনার প্রম্পট`\n\nইমেজ + ভিডিও + টেক্সট একসাথে!\nউদাহরণ:\n`/chain a futuristic city at night`",
        "gen_imgedit": "✏️ ইমেজ এডিট করতে লিখুন:\n`/imgedit আপনার প্রম্পট`\n\nউদাহরণ:\n`/imgedit a red car on a highway, make it blue`",
        "gen_codeedit": "📝 কোড এডিট করতে লিখুন:\n`/codeedit আপনার কোড`\n\nAI কোড ফিক্স ও ইম্প্রুভ করবে।",
        "teach": "🧠 AI কে শেখাতে লিখুন:\n`/teach আপনার নির্দেশ`\n\nউদাহরণ:\n`/teach always use dark theme`\n`/teach ছবিতে নদী রাখবেন`",
        "help": "📖 *কমান্ড লিস্ট:*\n\n/image — ইমেজ\n/video — ভিডিও\n/code — কোড\n/codeedit — কোড এডিট\n/imgedit — ইমেজ এডিট\n/chain — চেইন-জেন\n/teach — AI কে শেখান\n/myteach — teachings দেখুন\n/keygen — API key তৈরি\n/help — সাহায্য",
    }
    if data in guides:
        edit_message(chat_id, msg_id, guides[data])

# ─── Polling Loop ─────────────────────────────────────────────────────────────
def main():
    if not TELEGRAM_TOKEN:
        logger.error("❌ TELEGRAM_BOT_TOKEN not set!")
        return
    if not HF_API_KEY:
        logger.error("❌ HUGGINGFACE_API_KEY not set!")
        return

    requests.post(f"{BASE_URL}/deleteWebhook", json={"drop_pending_updates": True}, timeout=10)
    logger.info("✅ RiduyStudio Bot চালু! ৫টা endpoint সহ polling শুরু...")

    offset = None
    while True:
        try:
            params = {"timeout": 30, "allowed_updates": ["message", "callback_query"]}
            if offset:
                params["offset"] = offset

            resp = requests.get(f"{BASE_URL}/getUpdates", params=params, timeout=40)
            updates = resp.json().get("result", [])

            for update in updates:
                offset = update["update_id"] + 1
                try:
                    if "callback_query" in update:
                        handle_callback(update["callback_query"])
                        continue

                    msg = update.get("message", {})
                    if not msg:
                        continue

                    chat_id = msg["chat"]["id"]
                    text = msg.get("text", "").strip()
                    if not text:
                        continue

                    logger.info(f"Message from {chat_id}: {text}")

                    # Command routing
                    if text.startswith("/start"):
                        handle_start(chat_id)
                    elif text.startswith("/help"):
                        handle_help(chat_id)
                    elif text.startswith("/image "):
                        handle_image(chat_id, text[7:].strip())
                    elif text.startswith("/video "):
                        handle_video(chat_id, text[7:].strip())
                    elif text.startswith("/code "):
                        handle_code(chat_id, text[6:].strip())
                    elif text.startswith("/codeedit "):
                        handle_code_edit(chat_id, text[10:].strip())
                    elif text.startswith("/imgedit "):
                        handle_image_edit(chat_id, text[9:].strip())
                    elif text.startswith("/chain "):
                        handle_chain(chat_id, text[7:].strip())
                    elif text.startswith("/teach "):
                        handle_teach(chat_id, text[7:].strip())
                    elif text.startswith("/myteach"):
                        handle_myteach(chat_id)
                    elif text.startswith("/keygen"):
                        handle_keygen(chat_id)
                    elif text.startswith("/image"):
                        send_message(chat_id, "⚠️ প্রম্পট দিন!\nউদাহরণ: `/image a beautiful sunset`")
                    elif text.startswith("/video"):
                        send_message(chat_id, "⚠️ প্রম্পট দিন!\nউদাহরণ: `/video a cat walking in rain`")
                    elif text.startswith("/code"):
                        send_message(chat_id, "⚠️ কী কোড চান লিখুন!\nউদাহরণ: `/code write a Python function`")
                    else:
                        handle_text(chat_id, text)

                except Exception as e:
                    logger.error(f"Update error: {e}")

        except requests.exceptions.Timeout:
            pass
        except Exception as e:
            logger.error(f"Polling error: {e}")
            time.sleep(3)

if __name__ == "__main__":
    main()
