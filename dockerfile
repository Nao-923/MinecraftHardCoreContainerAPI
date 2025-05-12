# ベースイメージ
FROM node:22

# 作業ディレクトリ
WORKDIR /app

# 依存関係コピー＆インストール
COPY package*.json ./
RUN npm install

# アプリケーションコードをコピー
COPY . .

# ポートを開放
EXPOSE 3000

# アプリ起動
CMD ["node", "server.js"]