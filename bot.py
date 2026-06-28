import os
import asyncio
import logging
import aiohttp
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    CallbackQueryHandler, ContextTypes, filters
)

# ─── Config ───────────────────────────────────────────────────────────────────
TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
HF_API_KEY = os.environ.get("HUGGINGFACE_API_KEY", "")

HF_HEADERS = {
    "Authorization": f"Bearer {HF_API_KEY}",
    "Content-Type": "application/json"
}

# Hugging Face models
IMAGE_MODEL = "stabilityai/stable-diffusion-xl-base-1.0"
VIDEO_MODEL = "damo-vilab/text-to-video-ms-1.7b"

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# ─── HF API (async) ───────────────────────────────────────────────────────────
async def hf_generate_image(prompt: str):
    url = f"https://api-inference.huggingface.co/models/{IMAGE_MODEL}"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=HF_HEADERS, json={"inputs": prompt}, timeout=aiohttp.ClientTimeout(total=120)) as resp:
                if resp.status == 200:
                    ct = resp.headers.get("content-type", "")
                    if "image" in ct or "octet" in ct:
                        return await resp.read(), None
                    else:
                        text = await resp.text()
                        return None, f"Unexpected content: {ct}"
                elif resp.status == 503:
                    return None, "loading"
                else:
                    text = await resp.text()
                    return None, f"Error {resp.status}: {text[:100]}"
    except Exception as e:
        return None, str(e)

async def hf_generate_video(prompt: str):
    url = f"https://api-inference.huggingface.co/models/{VIDEO_MODEL}"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=HF_HEADERS, json={"inputs": prompt}, timeout=aiohttp.ClientTimeout(total=180)) as resp:
                if resp.status == 200:
                    data = await resp.read()
                    if len(data) > 1000:
                        return data, resp.headers.get("content-type", "video/mp4"), None
                    return None, None, "Empty response"
                elif resp.status == 503:
                    return None, None, "loading"
                else:
                    text = await resp.text()
                    return None, None, f"Error {resp.status}: {text[:100]}"
    except Exception as e:
        return None, None, str(e)

# ─── /start ───────────────────────────────────────────────────────────────────
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [InlineKeyboardButton("🎨 ইমেজ তৈরি করো", callback_data="gen_image")],
        [InlineKeyboardButton("🎬 ভিডিও তৈরি করো", callback_data="gen_video")],
        [InlineKeyboardButton("ℹ️ সাহায্য", callback_data="help")],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text(
        "👋 *RiduyStudio Bot*-এ স্বাগতম!\n\n"
        "🎨 AI দিয়ে ইমেজ ও ভিডিও তৈরি করুন।\n\n"
        "নিচের অপশন বেছে নিন বা সরাসরি কমান্ড লিখুন:",
        parse_mode="Markdown",
        reply_markup=reply_markup
    )

# ─── /help ────────────────────────────────────────────────────────────────────
async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "📖 *কমান্ড লিস্ট:*\n\n"
        "/start — শুরু করুন\n"
        "/image `<প্রম্পট>` — AI দিয়ে ইমেজ তৈরি\n"
        "/video `<প্রম্পট>` — AI দিয়ে ভিডিও তৈরি\n"
        "/help — সাহায্য\n\n"
        "উদাহরণ:\n"
        "`/image a beautiful sunset over the ocean`\n"
        "`/video a cat walking in the rain`",
        parse_mode="Markdown"
    )

# ─── /image ───────────────────────────────────────────────────────────────────
async def generate_image(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text(
            "⚠️ প্রম্পট দিন!\nউদাহরণ: `/image a beautiful sunset`",
            parse_mode="Markdown"
        )
        return

    prompt = " ".join(context.args)
    msg = await update.message.reply_text(
        f"🎨 ইমেজ তৈরি হচ্ছে...\nপ্রম্পট: *{prompt}*\n\n⏳ একটু অপেক্ষা করুন...",
        parse_mode="Markdown"
    )

    data, error = await hf_generate_image(prompt)

    if data:
        await context.bot.send_photo(
            chat_id=update.effective_chat.id,
            photo=data,
            caption=f"✅ ইমেজ তৈরি হয়েছে!\nপ্রম্পট: {prompt}"
        )
        await msg.delete()
    elif error == "loading":
        await msg.edit_text("⏳ মডেল লোড হচ্ছে। ৩০ সেকেন্ড পর `/image " + prompt + "` আবার চেষ্টা করুন।", parse_mode="Markdown")
    else:
        logger.error(f"Image error: {error}")
        await msg.edit_text(f"❌ ইমেজ তৈরি হয়নি। আবার চেষ্টা করুন।")

# ─── /video ───────────────────────────────────────────────────────────────────
async def generate_video(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text(
            "⚠️ প্রম্পট দিন!\nউদাহরণ: `/video a cat walking in rain`",
            parse_mode="Markdown"
        )
        return

    prompt = " ".join(context.args)
    msg = await update.message.reply_text(
        f"🎬 ভিডিও তৈরি হচ্ছে...\nপ্রম্পট: *{prompt}*\n\n⏳ ১-২ মিনিট সময় নিতে পারে...",
        parse_mode="Markdown"
    )

    data, content_type, error = await hf_generate_video(prompt)

    if data:
        ext = "gif" if "gif" in (content_type or "") else "mp4"
        file_path = f"/tmp/video_{update.effective_user.id}.{ext}"
        with open(file_path, "wb") as f:
            f.write(data)

        try:
            await context.bot.send_video(
                chat_id=update.effective_chat.id,
                video=open(file_path, "rb"),
                caption=f"✅ ভিডিও তৈরি হয়েছে!\nপ্রম্পট: {prompt}"
            )
        except Exception:
            await context.bot.send_document(
                chat_id=update.effective_chat.id,
                document=open(file_path, "rb"),
                filename=f"video.{ext}",
                caption=f"✅ ভিডিও তৈরি হয়েছে!\nপ্রম্পট: {prompt}"
            )

        await msg.delete()
        if os.path.exists(file_path):
            os.remove(file_path)
    elif error == "loading":
        await msg.edit_text("⏳ মডেল লোড হচ্ছে। ১ মিনিট পর `/video " + prompt + "` আবার চেষ্টা করুন।", parse_mode="Markdown")
    else:
        logger.error(f"Video error: {error}")
        await msg.edit_text("❌ ভিডিও তৈরি হয়নি। আবার চেষ্টা করুন।")

# ─── Callback Handler ─────────────────────────────────────────────────────────
async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    if query.data == "gen_image":
        await query.edit_message_text(
            "🎨 ইমেজ তৈরি করতে লিখুন:\n`/image আপনার প্রম্পট`\n\nউদাহরণ:\n`/image a beautiful mountain landscape`",
            parse_mode="Markdown"
        )
    elif query.data == "gen_video":
        await query.edit_message_text(
            "🎬 ভিডিও তৈরি করতে লিখুন:\n`/video আপনার প্রম্পট`\n\nউদাহরণ:\n`/video a cat walking in the rain`",
            parse_mode="Markdown"
        )
    elif query.data == "help":
        await query.edit_message_text(
            "📖 *কমান্ড লিস্ট:*\n\n"
            "/start — শুরু করুন\n"
            "/image [প্রম্পট] — AI দিয়ে ইমেজ তৈরি\n"
            "/video [প্রম্পট] — AI দিয়ে ভিডিও তৈরি\n"
            "/help — সাহায্য",
            parse_mode="Markdown"
        )

# ─── Text Message Handler ─────────────────────────────────────────────────────
async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip().lower()

    # ইমেজ সম্পর্কিত keyword
    if any(word in text for word in ["image", "ইমেজ", "ছবি", "picture", "photo", "draw", "আঁক"]):
        await update.message.reply_text(
            "🎨 ইমেজ তৈরি করতে এভাবে লিখুন:\n`/image আপনার প্রম্পট`\n\nউদাহরণ:\n`/image a beautiful sunset`",
            parse_mode="Markdown"
        )
    # ভিডিও সম্পর্কিত keyword
    elif any(word in text for word in ["video", "ভিডিও", "animation", "অ্যানিমেশন", "animate"]):
        await update.message.reply_text(
            "🎬 ভিডিও তৈরি করতে এভাবে লিখুন:\n`/video আপনার প্রম্পট`\n\nউদাহরণ:\n`/video a cat walking in rain`",
            parse_mode="Markdown"
        )
    # হ্যালো / সালাম
    elif any(word in text for word in ["hello", "hi", "হ্যালো", "হেলো", "সালাম", "আসসালামু"]):
        await update.message.reply_text(
            "👋 হ্যালো! আমি RiduyStudio Bot।\n\n"
            "আমি AI দিয়ে ইমেজ ও ভিডিও তৈরি করতে পারি।\n"
            "/start দিয়ে শুরু করুন বা /help দেখুন।"
        )
    # সাহায্য
    elif any(word in text for word in ["help", "সাহায্য", "হেল্প", "কি করো", "কী করো"]):
        await help_command(update, context)
    # যেকোনো অন্য text
    else:
        await update.message.reply_text(
            "❓ বুঝতে পারিনি!\n\n"
            "🎨 ইমেজ চাইলে: `/image আপনার প্রম্পট`\n"
            "🎬 ভিডিও চাইলে: `/video আপনার প্রম্পট`\n"
            "📖 সাহায্যের জন্য: /help",
            parse_mode="Markdown"
        )

# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    if not TELEGRAM_TOKEN:
        logger.error("❌ TELEGRAM_BOT_TOKEN not set!")
        return
    if not HF_API_KEY:
        logger.error("❌ HUGGINGFACE_API_KEY not set!")
        return

    app = Application.builder().token(TELEGRAM_TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", help_command))
    app.add_handler(CommandHandler("image", generate_image))
    app.add_handler(CommandHandler("video", generate_video))
    app.add_handler(CallbackQueryHandler(button_callback))
    # সাধারণ text message handler (command ছাড়া সব)
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
    # Unknown command
    app.add_handler(MessageHandler(filters.COMMAND, lambda u, c: u.message.reply_text("❓ অজানা কমান্ড। /help দেখুন।")))

    logger.info("✅ RiduyStudio Bot চালু হয়েছে! Polling mode...")
    app.run_polling(allowed_updates=Update.ALL_TYPES, drop_pending_updates=True)

if __name__ == "__main__":
    main()
