---
description: Deploy the gita-support app to an EC2 instance with SQLite
---

# Deploy to EC2

## Prerequisites
- An EC2 instance (Ubuntu 22.04+ recommended) with SSH access
- Security group allowing inbound on ports 22 (SSH), 3000 (dashboard), or 80/443 if using nginx
- Your SSH key (e.g. `~/.ssh/your-key.pem`)

## 1. Connect to EC2

```bash
ssh -i ~/.ssh/your-key.pem ubuntu@YOUR_EC2_IP
```

## 2. Install Node.js 20 + PM2

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
```

## 3. Install Chromium dependencies (required by whatsapp-web.js / Puppeteer)

```bash
sudo apt-get install -y \
  gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 \
  libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 \
  libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 \
  libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 \
  libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
  libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation \
  libappindicator1 libnss3 lsb-release xdg-utils wget libgbm-dev
```

## 4. Clone repo and install

```bash
cd ~
git clone YOUR_REPO_URL gita-support
cd gita-support
npm install
```

Or if not using git, from your local machine:
```bash
rsync -avz --exclude node_modules --exclude data --exclude .wwebjs_auth \
  -e "ssh -i ~/.ssh/your-key.pem" \
  . ubuntu@YOUR_EC2_IP:~/gita-support/
```
Then on EC2: `cd ~/gita-support && npm install`

## 5. Create .env file on EC2

```bash
cat > .env << 'EOF'
PORT=3000
OPENAI_API_KEY=sk-your-key-here
JWT_SECRET=change-this-to-a-random-string
NODE_ENV=production
EOF
```

## 6. Run database migration + seed

```bash
node src/database/migrate.js
node src/database/seed.js
```

## 7. Start with PM2

```bash
pm2 start src/app.js --name gita-support
pm2 save
pm2 startup  # follow the printed command to enable auto-start on reboot
```

## 8. WhatsApp Authentication

On first start, the app will print a QR code to the PM2 logs. Scan it:

```bash
pm2 logs gita-support
```

Open WhatsApp on your phone → Linked Devices → Link a Device → scan the QR.

The session is saved in `.wwebjs_auth/` so it persists across restarts.

## 9. Access the Dashboard

Open `http://YOUR_EC2_IP:3000` in your browser.

Default login: `admin` / `admin123` (change this after first login).

## Optional: Nginx reverse proxy (port 80 + HTTPS)

```bash
sudo apt-get install -y nginx
sudo tee /etc/nginx/sites-available/gita-support << 'EOF'
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_IP;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/gita-support /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx
```

For HTTPS, add certbot:
```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR_DOMAIN
```

## Useful PM2 Commands

| Command | Description |
|---|---|
| `pm2 logs gita-support` | View live logs |
| `pm2 restart gita-support` | Restart the app |
| `pm2 stop gita-support` | Stop the app |
| `pm2 monit` | Monitor CPU/memory |

## Updating the app

```bash
cd ~/gita-support
git pull   # or rsync again
npm install
pm2 restart gita-support
```

## Important Notes

- **SQLite DB** is stored at `./data/support.db` — back this up regularly
- **WhatsApp session** is in `.wwebjs_auth/` — if deleted, you'll need to re-scan QR
- **PM2 logs** rotate automatically but you can configure: `pm2 install pm2-logrotate`
