import os
import asyncio
import requests
import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    CallbackQueryHandler, ContextTypes, filters
)

# ─── Config ───────────────────────────────────────────────────────────────────
TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
HF_API_KEY = os.environ.get("HUGGINGFACE_API_KEY", "")

HF_HEADERS = {"Authorization": f"Bearer {HF_API_KEY}"}

# Hugging Face models
MODELS = {
    "text_to_image": "stabilityai/stable-diffusion-2-1",
    "image_to_video": "stabilityai/stable-video-diffusion-img2vid",
    "animation": "guoyww/animatediff-motion-adapter-v1-5-2",
}

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# ─── /start ───────────────────────────────────────────────────────────────────
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [InlineKeyboardButton("🎨 ইমেজ তৈরি করো", callback_data="gen_image")],
        [InlineKeyboardButton("🎬 ভিডিও/এনিমেশন তৈরি করো", callback_data="gen_video")],
        [InlineKeyboardButton("ℹ️ সাহায্য", callback_data="help")],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text(
        "👋 *RiduyStudio Bot*-এ স্বাগতম!\n\n"
        "আমি Hugging Face AI দিয়ে ইমেজ ও ভিডিও/এনিমেশন তৈরি করতে পারি।\n\n"
        "নিচের অপশন বেছে নিন:",
        parse_mode="Markdown",
        reply_markup=reply_markup
    )

# ─── /help ────────────────────────────────────────────────────────────────────
async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "📖 *কমান্ড লিস্ট:*\n\n"
        "/start — শুরু করুন\n"
        "/image [প্রম্পট] — AI দিয়ে ইমেজ তৈরি\n"
        "/video [প্রম্পট] — AI দিয়ে ভিডিও/এনিমেশন তৈরি\n"
        "/help — সাহায্য\n\n"
        "উদাহরণ:\n"
        "`/image a beautiful sunset over the ocean`\n"
        "`/video a cat walking in the rain`",
        parse_mode="Markdown"
    )

# ─── Image Generation ─────────────────────────────────────────────────────────
async def generate_image(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text(
            "⚠️ প্রম্পট দিন!\nউদাহরণ: `/image a beautiful sunset`",
            parse_mode="Markdown"
        )
        return

    prompt = " ".join(context.args)
    msg = await update.message.reply_text(f"🎨 ইমেজ তৈরি হচ্ছে...\nপ্রম্পট: *{prompt}*", parse_mode="Markdown")

    try:
        api_url = f"https://api-inference.huggingface.co/models/{MODELS['text_to_image']}"
        response = requests.post(
            api_url,
            headers=HF_HEADERS,
            json={"inputs": prompt},
            timeout=120
        )

        if response.status_code == 200 and response.headers.get("content-type", "").startswith("image"):
            await context.bot.send_photo(
                chat_id=update.effective_chat.id,
                photo=response.content,
                caption=f"✅ ইমেজ তৈরি হয়েছে!\nপ্রম্পট: {prompt}"
            )
            await msg.delete()
        elif response.status_code == 503:
            await msg.edit_text("⏳ মডেল লোড হচ্ছে, ৩০ সেকেন্ড পর আবার চেষ্টা করুন।")
        else:
            error = response.json() if response.content else {}
            logger.error(f"Image error: {response.status_code} - {error}")
            await msg.edit_text(f"❌ ইমেজ তৈরি হয়নি। আবার চেষ্টা করুন।\nError: {response.status_code}")

    except Exception as e:
        logger.error(f"Image generation error: {e}")
        await msg.edit_text("❌ কোনো সমস্যা হয়েছে। আবার চেষ্টা করুন।")

# ─── Video/Animation Generation ───────────────────────────────────────────────
async def generate_video(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text(
            "⚠️ প্রম্পট দিন!\nউদাহরণ: `/video a cat walking in rain`",
            parse_mode="Markdown"
        )
        return

    prompt = " ".join(context.args)
    msg = await update.message.reply_text(
        f"🎬 ভিডিও/এনিমেশন তৈরি হচ্ছে...\nপ্রম্পট: *{prompt}*\n\n⏳ এটি একটু সময় নেবে...",
        parse_mode="Markdown"
    )

    try:
        # Use AnimateDiff for text-to-animation
        api_url = "https://api-inference.huggingface.co/models/damo-vilab/text-to-video-ms-1.7b"
        response = requests.post(
            api_url,
            headers=HF_HEADERS,
            json={"inputs": prompt},
            timeout=180
        )

        if response.status_code == 200:
            content_type = response.headers.get("content-type", "")
            if "video" in content_type or "gif" in content_type or len(response.content) > 1000:
                # Save temp file
                ext = "mp4" if "video" in content_type else "gif"
                file_path = f"/tmp/video_{update.effective_user.id}.{ext}"
                with open(file_path, "wb") as f:
                    f.write(response.content)

                await context.bot.send_video(
                    chat_id=update.effective_chat.id,
                    video=open(file_path, "rb"),
                    caption=f"✅ ভিডিও তৈরি হয়েছে!\nপ্রম্পট: {prompt}"
                )
                await msg.delete()
                os.remove(file_path)
            else:
                await msg.edit_text("❌ ভিডিও ফরম্যাট সঠিক নয়। আবার চেষ্টা করুন।")
        elif response.status_code == 503:
            await msg.edit_text("⏳ মডেল লোড হচ্ছে, ১ মিনিট পর আবার চেষ্টা করুন।")
        else:
            logger.error(f"Video error: {response.status_code}")
            await msg.edit_text(f"❌ ভিডিও তৈরি হয়নি। Error: {response.status_code}")

    except Exception as e:
        logger.error(f"Video generation error: {e}")
        await msg.edit_text("❌ কোনো সমস্যা হয়েছে। আবার চেষ্টা করুন।")

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
            "🎬 ভিডিও/এনিমেশন তৈরি করতে লিখুন:\n`/video আপনার প্রম্পট`\n\nউদাহরণ:\n`/video a cat walking in the rain`",
            parse_mode="Markdown"
        )
    elif query.data == "help":
        await query.edit_message_text(
            "📖 *কমান্ড লিস্ট:*\n\n"
            "/start — শুরু করুন\n"
            "/image [প্রম্পট] — AI দিয়ে ইমেজ তৈরি\n"
            "/video [প্রম্পট] — AI দিয়ে ভিডিও/এনিমেশন তৈরি\n"
            "/help — সাহায্য",
            parse_mode="Markdown"
        )

# ─── Unknown messages ─────────────────────────────────────────────────────────
async def unknown(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "❓ বুঝতে পারিনি। /start দিয়ে শুরু করুন বা /help দেখুন।"
    )

# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    if not TELEGRAM_TOKEN:
        logger.error("TELEGRAM_BOT_TOKEN not set!")
        return
    if not HF_API_KEY:
        logger.error("HUGGINGFACE_API_KEY not set!")
        return

    app = Application.builder().token(TELEGRAM_TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", help_command))
    app.add_handler(CommandHandler("image", generate_image))
    app.add_handler(CommandHandler("video", generate_video))
    app.add_handler(CallbackQueryHandler(button_callback))
    app.add_handler(MessageHandler(filters.COMMAND, unknown))

    logger.info("✅ RiduyStudio Bot চালু হয়েছে!")
    app.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()
