# YouTube Transcript Extractor

Paste up to 10 YouTube links and download each transcript as a .txt file.

No API keys needed. Works by fetching YouTube's built-in caption data server-side.

## Deploy to Vercel (5 minutes)

### Step 1: Create a GitHub repo

1. Go to [github.com/new](https://github.com/new)
2. Name it `yt-transcript` (or whatever you want)
3. Keep it set to **Public** or **Private** (either works)
4. Click **Create repository**

### Step 2: Upload the files

1. On your new repo page, click **"uploading an existing file"** (the link in the instructions)
2. Drag the entire contents of this project folder into the upload area:
   - `package.json`
   - `next.config.js`
   - `.gitignore`
   - `app/layout.js`
   - `app/page.js`
   - `app/api/transcript/route.js`
3. Click **Commit changes**

**Important:** Make sure the `app` folder structure is preserved. GitHub's drag-and-drop handles folders fine.

### Step 3: Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with your GitHub account
2. Click **"Add New Project"**
3. Find your `yt-transcript` repo and click **Import**
4. Leave all settings as default (Vercel auto-detects Next.js)
5. Click **Deploy**
6. Wait about 60 seconds. Done! You'll get a URL like `yt-transcript.vercel.app`

### That's it!

Every time you push changes to the GitHub repo, Vercel will auto-redeploy.

## Local development (optional)

```bash
npm install
npm run dev
```

Then open http://localhost:3000
