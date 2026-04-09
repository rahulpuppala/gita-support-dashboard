#!/bin/bash
# Deploy and restart gita-support on EC2
# Usage: ssh ec2-user@<EC2_IP> 'bash -s' < scripts/deploy.sh

export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"

cd ~/gita-support-dashboard

echo "Pulling latest code..."
git pull

echo "Installing dependencies..."
npm install

echo "Restarting app..."
pm2 restart gita-support

echo "Tailing app logs (logs/combined.log). Ctrl+C to stop..."
if [ -f ./logs/combined.log ]; then
  tail -n 50 -f ./logs/combined.log
else
  echo "combined.log not found yet; falling back to pm2 logs"
  pm2 logs gita-support --lines 30
fi
