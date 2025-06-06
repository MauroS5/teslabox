#!/bin/sh
cd /root
curl --parallel -o main.zip https://codeload.github.com/mluggy/teslabox/zip/refs/heads/main
unzip -o main.zip
cp -r teslabox-main/* teslabox
rm -rf teslabox-main
rm main.zip
cd teslabox
npm install --production
npm prune
systemctl restart teslabox
