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

echo "Tailing logs (Ctrl+C to stop)..."
pm2 logs gita-support --lines 30
