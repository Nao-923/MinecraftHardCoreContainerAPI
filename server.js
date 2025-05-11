require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORTAINER_URL = process.env.PORTAINER_URL;
const ENDPOINT_ID = process.env.PORTAINER_ENDPOINT_ID;
const JWT = process.env.PORTAINER_JWT;
const RCON_PASSWORD = process.env.PORTAINER_RCON_PASSWORD;
const API_PORT = process.env.API_PORT || 3000;
const MINECRAFT_PORT = process.env.MINECRAFT_PORT || 25567;
const RCON_PORT = process.env.RCON_PORT || 25577;
const ALLOWED_CONTAINER_NAME = process.env.ALLOWED_CONTAINER_NAME;

const headers = {
  Authorization: `Bearer ${JWT}`,
  "Content-Type": "application/json",
};

// 🔍 名前からコンテナID取得
async function getContainerIdByName(name) {
    const res = await axios.get(
      `${PORTAINER_URL}/api/endpoints/${ENDPOINT_ID}/docker/containers/json?all=true`,
      { headers }
    );
    const container = res.data.find(c => c.Names.some(n => n.replace(/^\//, '') === name));
    return container ? container.Id : null;
  }

// 🚀 起動
app.post("/start", async (req, res) => {
    const name = ALLOWED_CONTAINER_NAME;
    const id = await getContainerIdByName(name);
    if (!id) return res.status(404).send("コンテナが見つかりません");
    await axios.post(`${PORTAINER_URL}/api/endpoints/${ENDPOINT_ID}/docker/containers/${id}/start`, {}, { headers });
    res.send("起動しました");
  });
  
  // 🛑 停止
  app.post("/stop", async (req, res) => {
    const name = ALLOWED_CONTAINER_NAME;
    const id = await getContainerIdByName(name);
    if (!id) return res.status(404).send("コンテナが見つかりません");
    await axios.post(`${PORTAINER_URL}/api/endpoints/${ENDPOINT_ID}/docker/containers/${id}/stop`, {}, { headers });
    res.send("停止しました");
  });
  
  // ❌ 削除
  app.delete("/delete", async (req, res) => {
    const name = ALLOWED_CONTAINER_NAME;
    const id = await getContainerIdByName(name);
    if (!id) return res.status(404).send("コンテナが見つかりません");
    await axios.delete(`${PORTAINER_URL}/api/endpoints/${ENDPOINT_ID}/docker/containers/${id}?force=true`, { headers });
    res.send("削除しました");
  });
  
  // 🔁 再構築（停止 → 削除 → 再作成）
  app.post("/recreate", async (req, res) => {
    const name = ALLOWED_CONTAINER_NAME;
    const id = await getContainerIdByName(name);
    if (id) {
      await axios.post(`${PORTAINER_URL}/api/endpoints/${ENDPOINT_ID}/docker/containers/${id}/stop`, {}, { headers });
      await axios.delete(`${PORTAINER_URL}/api/endpoints/${ENDPOINT_ID}/docker/containers/${id}?force=true`, { headers });
    }
  
    const createRes = await axios.post(
      `${PORTAINER_URL}/api/endpoints/${ENDPOINT_ID}/docker/containers/create?name=${name}`,
      {
        Image: "itzg/minecraft-server",
        Env: [
          "EULA=TRUE",
          "ENABLE_RCON=true",
          `RCON_PASSWORD=${RCON_PASSWORD}`,
          `RCON_PORT=25575`,
          "TYPE=PAPER",
          "VERSION=LATEST",
          "DIFFICULTY=hard",
          "HARDCORE=true",
          "MEMORY=4G"
        ],
        HostConfig: {
          PortBindings: {
            "25565/tcp": [{ HostPort: `${MINECRAFT_PORT}` }],
            "25575/tcp": [{ HostPort: `${RCON_PORT}` }]
          }
        }
      },
      { headers }
    );
  
    const newId = createRes.data.Id;
    await axios.post(`${PORTAINER_URL}/api/endpoints/${ENDPOINT_ID}/docker/containers/${newId}/start`, {}, { headers });
  
    res.send("再構築して起動しました");
  });
app.listen(API_PORT, () => console.log(`🚀 APIサーバー起動：ポート${API_PORT}`));