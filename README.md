# WBL Draft Sync

Automatically marks players as drafted in the WBL Draft Board when draft picks are announced in the Slack #draft-results channel.

## How It Works

1. A draft pick is announced in #draft-results (e.g., "Round 3, Pick 12 (#56 overall): Denver Blucifers select P Bill Muncey")
2. Slack sends a webhook to the Netlify function
3. The function parses the message, finds the player in Firebase, and marks them as drafted
4. The Draft Board auto-syncs and shows the player as drafted

## Setup Instructions

### 1. Deploy to Netlify

1. Push this repo to GitHub
2. Go to [Netlify](https://app.netlify.com)
3. Click "Add new site" → "Import an existing project"
4. Connect your GitHub account and select this repo
5. Deploy settings should auto-detect from netlify.toml
6. Click "Deploy site"

### 2. Add Environment Variables in Netlify

Go to Site settings → Environment variables → Add variable:

- `SLACK_SIGNING_SECRET` = `a097f735e79e882132a27ba9877b344c`
- `FIREBASE_URL` = `https://wbl-gabs-machine-default-rtdb.firebaseio.com`

### 3. Configure Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Select "WBL Draft Sync"
3. Go to **Event Subscriptions** in the left sidebar
4. Toggle "Enable Events" to ON
5. In "Request URL", enter: `https://YOUR-NETLIFY-SITE.netlify.app/.netlify/functions/slack-draft`
   - Replace YOUR-NETLIFY-SITE with your actual Netlify subdomain
   - Slack will verify the URL automatically
6. Under "Subscribe to bot events", click "Add Bot User Event"
7. Add: `message.channels`
8. Click "Save Changes"

### 4. Add Bot to Channel

1. In Slack, go to #draft-results
2. Type `/invite @WBL Draft Sync` (or whatever you named the bot)
3. The bot needs to be in the channel to receive messages

## Message Format

The function expects messages in this format:
```
Round X, Pick Y (#Z overall): Team Name select POS Player Name
```

Example:
```
Round 3, Pick 12 (#56 overall): Denver Blucifers select P Bill Muncey
```

## Troubleshooting

- Check Netlify function logs at: Site → Functions → slack-draft → View logs
- Make sure the bot is invited to #draft-results
- Verify environment variables are set correctly
- Player names must match exactly (case-insensitive) with the draft board data
