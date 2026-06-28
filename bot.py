import os
import time
import logging
import requests
import tempfile

# ─── Config ───────────────────────────────────────────────────────────────────
TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
HF_API_KEY = os.environ.get("HUGGINGFACE_API_KEY", "")

BASE_URL = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}"
HF_HEADERS = {
    "Authorization": f"Bearer {HF_API_KEY}",
}

IMAGE_MODEL = "stabilityai/stable-diffusion-xl-base-1.0"
VIDEO_MODEL = "damo-vilab/text-to-video-ms-1.7b"

logging.basicConfig(
    format="%(asctime)s - %(levelname)s - %(message)s",
    level=logging.INFO
)
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
        requests.post(f"{BASE_URL}/sendPhoto", data={
            "chat_id": chat_id, "caption": caption
        }, files={"photo": ("image.png", photo_bytes, "image/png")}, timeout=30)
    except Exception as e:
        logger.error(f"sendPhoto error: {e}")

def send_video(chat_id, video_bytes, caption=""):
    try:
        requests.post(f"{BASE_URL}/sendVideo", data={
            "chat_id": chat_id, "caption": caption
        }, files={"video": ("video.mp4", video_bytes, "video/mp4")}, timeout=60)
    except Exception as e:
        logger.error(f"sendVideo error: {e}")

def answer_callback(callback_id):
    try:
        requests.post(f"{BASE_URL}/answerCallbackQuery", json={"callback_query_id": callback_id}, timeout=5)
    except:
        pass

def edit_callback_message(chat_id, message_id, text):
    edit_message(chat_id, message_id, text)

# ─── HF API ───────────────────────────────────────────────────────────────────
def hf_generate_image(prompt):
    url = f"https://api-inference.huggingface.co/models/{IMAGE_MODEL}"
    try:
        resp = requests.post(url, headers=HF_HEADERS, json={"inputs": prompt}, timeout=120)
        if resp.status_code == 200:
            ct = resp.headers.get("content-type", "")
            if "image" in ct or "octet" in ct:
                return resp.content, None
            return None, f"Unexpected content: {ct}"
        elif resp.status_code == 503:
            return None, "loading"
        else:
            return None, f"Error {resp.status_code}: {resp.text[:100]}"
    except Exception as e:
        return None, str(e)

def hf_generate_video(prompt):
    url = f"https://api-inference.huggingface.co/models/{VIDEO_MODEL}"
    try:
        resp = requests.post(url, headers=HF_HEADERS, json={"inputs": prompt}, timeout=180)
        if resp.status_code == 200 and len(resp.content) > 1000:
            return resp.content, None
        elif resp.status_code == 503:
            return None, "loading"
        else:
            return None, f"Error {resp.status_code}: {resp.text[:100]}"
    except Exception as e:
        return None, str(e)

# ─── Handlers ─────────────────────────────────────────────────────────────────
def handle_start(chat_id):
    keyboard = {"inline_keyboard": [
        [{"text": "🎨 ইমেজ তৈরি করো", "callback_data": "gen_image"}],
        [{"text": "🎬 ভিডিও তৈরি করো", "callback_data": "gen_video"}],
        [{"text": "ℹ️ সাহায্য", "callback_data": "help"}],
    ]}
    send_message(chat_id,
        "👋 *RiduyStudio Bot*-এ স্বাগতম!\n\n"
        "🎨 AI দিয়ে ইমেজ ও ভিডিও তৈরি করুন।\n\n"
        "নিচের অপশন বেছে নিন বা কমান্ড লিখুন:",
        reply_markup=keyboard
    )

def handle_help(chat_id):
    send_message(chat_id,
        "📖 *কমান্ড লিস্ট:*\n\n"
        "/start — শুরু করুন\n"
        "/image `<প্রম্পট>` — AI দিয়ে ইমেজ তৈরি\n"
        "/video `<প্রম্পট>` — AI দিয়ে ভিডিও তৈরি\n"
        "/help — সাহায্য\n\n"
        "উদাহরণ:\n"
        "`/image a beautiful sunset over the ocean`\n"
        "`/video a cat walking in the rain`"
    )

def handle_image(chat_id, prompt):
    msg = send_message(chat_id, f"🎨 ইমেজ তৈরি হচ্ছে...\nপ্রম্পট: *{prompt}*\n\n⏳ একটু অপেক্ষা করুন...")
    msg_id = msg.get("message_id")
    data, error = hf_generate_image(prompt)
    if data:
        send_photo(chat_id, data, caption=f"✅ ইমেজ তৈরি হয়েছে!\nপ্রম্পট: {prompt}")
        if msg_id:
            try:
                requests.post(f"{BASE_URL}/deleteMessage", json={"chat_id": chat_id, "message_id": msg_id}, timeout=5)
            except:
                pass
    elif error == "loading":
        if msg_id:
            edit_message(chat_id, msg_id, f"⏳ মডেল লোড হচ্ছে। ৩০ সেকেন্ড পর `/image {prompt}` আবার চেষ্টা করুন।")
    else:
        logger.error(f"Image error: {error}")
        if msg_id:
            edit_message(chat_id, msg_id, "❌ ইমেজ তৈরি হয়নি। আবার চেষ্টা করুন।", parse_mode="")

def handle_video(chat_id, prompt):
    msg = send_message(chat_id, f"🎬 ভিডিও তৈরি হচ্ছে...\nপ্রম্পট: *{prompt}*\n\n⏳ ১-২ মিনিট সময় নিতে পারে...")
    msg_id = msg.get("message_id")
    data, error = hf_generate_video(prompt)
    if data:
        send_video(chat_id, data, caption=f"✅ ভিডিও তৈরি হয়েছে!\nপ্রম্পট: {prompt}")
        if msg_id:
            try:
                requests.post(f"{BASE_URL}/deleteMessage", json={"chat_id": chat_id, "message_id": msg_id}, timeout=5)
            except:
                pass
    elif error == "loading":
        if msg_id:
            edit_message(chat_id, msg_id, f"⏳ মডেল লোড হচ্ছে। ১ মিনিট পর `/video {prompt}` আবার চেষ্টা করুন।")
    else:
        logger.error(f"Video error: {error}")
        if msg_id:
            edit_message(chat_id, msg_id, "❌ ভিডিও তৈরি হয়নি। আবার চেষ্টা করুন।", parse_mode="")

def handle_text(chat_id, text):
    t = text.lower()
    if any(w in t for w in ["image", "ইমেজ", "ছবি", "picture", "photo", "draw", "আঁক"]):
        send_message(chat_id, "🎨 ইমেজ তৈরি করতে লিখুন:\n`/image আপনার প্রম্পট`\n\nউদাহরণ:\n`/image a beautiful sunset`")
    elif any(w in t for w in ["video", "ভিডিও", "animation", "অ্যানিমেশন", "animate"]):
        send_message(chat_id, "🎬 ভিডিও তৈরি করতে লিখুন:\n`/video আপনার প্রম্পট`\n\nউদাহরণ:\n`/video a cat walking in rain`")
    elif any(w in t for w in ["hello", "hi", "হ্যালো", "হেলো", "সালাম", "আসসালামু"]):
        send_message(chat_id, "👋 হ্যালো! আমি RiduyStudio Bot।\n\nAI দিয়ে ইমেজ ও ভিডিও তৈরি করতে পারি।\n/start দিয়ে শুরু করুন।", parse_mode="")
    elif any(w in t for w in ["help", "সাহায্য", "হেল্প", "কি করো", "কী করো"]):
        handle_help(chat_id)
    else:
        send_message(chat_id,
            "❓ বুঝতে পারিনি!\n\n"
            "🎨 ইমেজ চাইলে: `/image আপনার প্রম্পট`\n"
            "🎬 ভিডিও চাইলে: `/video আপনার প্রম্পট`\n"
            "📖 সাহায্যের জন্য: /help"
        )

def handle_callback(callback_query):
    cid = callback_query["id"]
    chat_id = callback_query["message"]["chat"]["id"]
    msg_id = callback_query["message"]["message_id"]
    data = callback_query.get("data", "")
    answer_callback(cid)
    if data == "gen_image":
        edit_callback_message(chat_id, msg_id, "🎨 ইমেজ তৈরি করতে লিখুন:\n`/image আপনার প্রম্পট`\n\nউদাহরণ:\n`/image a beautiful mountain landscape`")
    elif data == "gen_video":
        edit_callback_message(chat_id, msg_id, "🎬 ভিডিও তৈরি করতে লিখুন:\n`/video আপনার প্রম্পট`\n\nউদাহরণ:\n`/video a cat walking in the rain`")
    elif data == "help":
        edit_callback_message(chat_id, msg_id,
            "📖 *কমান্ড লিস্ট:*\n\n"
            "/start — শুরু করুন\n"
            "/image [প্রম্পট] — AI দিয়ে ইমেজ তৈরি\n"
            "/video [প্রম্পট] — AI দিয়ে ভিডিও তৈরি\n"
            "/help — সাহায্য"
        )

# ─── Polling Loop ─────────────────────────────────────────────────────────────
def main():
    if not TELEGRAM_TOKEN:
        logger.error("❌ TELEGRAM_BOT_TOKEN not set!")
        return
    if not HF_API_KEY:
        logger.error("❌ HUGGINGFACE_API_KEY not set!")
        return

    # Webhook বাতিল করো
    requests.post(f"{BASE_URL}/deleteWebhook", json={"drop_pending_updates": True}, timeout=10)
    logger.info("✅ RiduyStudio Bot চালু! Polling শুরু হয়েছে...")

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
                    # Callback query
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

                    if text.startswith("/start"):
                        handle_start(chat_id)
                    elif text.startswith("/help"):
                        handle_help(chat_id)
                    elif text.startswith("/image"):
                        prompt = text[7:].strip()
                        if prompt:
                            handle_image(chat_id, prompt)
                        else:
                            send_message(chat_id, "⚠️ প্রম্পট দিন!\nউদাহরণ: `/image a beautiful sunset`")
                    elif text.startswith("/video"):
                        prompt = text[7:].strip()
                        if prompt:
                            handle_video(chat_id, prompt)
                        else:
                            send_message(chat_id, "⚠️ প্রম্পট দিন!\nউদাহরণ: `/video a cat walking in rain`")
                    else:
                        handle_text(chat_id, text)

                except Exception as e:
                    logger.error(f"Update processing error: {e}")

        except requests.exceptions.Timeout:
            pass  # Normal long-poll timeout, continue
        except Exception as e:
            logger.error(f"Polling error: {e}")
            time.sleep(3)

if __name__ == "__main__":
    main()
