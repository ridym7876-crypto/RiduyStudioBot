# 🤖 RiduyStudio Bot

A Telegram Bot that generates AI images and videos using Hugging Face API.

## Features
- 🎨 `/image <prompt>` — Generate AI images using Stable Diffusion XL
- 🎬 `/video <prompt>` — Generate AI videos using text-to-video model
- 📖 `/help` — Show all commands

## Commands
| Command | Description |
|---------|-------------|
| `/start` | Start the bot |
| `/image a beautiful sunset` | Generate an AI image |
| `/video a cat walking in rain` | Generate an AI video |
| `/help` | Show help |

## Tech Stack
- **Platform:** Base44 Backend Functions (Deno)
- **AI Models:** Hugging Face Inference API
  - Image: `stabilityai/stable-diffusion-xl-base-1.0`
  - Video: `damo-vilab/text-to-video-ms-1.7b`
- **Messaging:** Telegram Bot API (Webhook)

## Setup
1. Create a Telegram bot via [@BotFather](https://t.me/BotFather)
2. Get a [Hugging Face API Token](https://huggingface.co/settings/tokens)
3. Deploy `functions/telegramBot.ts` to Base44
4. Set webhook: `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<FUNCTION_URL>`

## Environment Variables
```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
HUGGINGFACE_API_KEY=your_hf_api_key
```

## Live Bot
[@RiduyStudioBot](https://t.me/RiduyStudioBot)
