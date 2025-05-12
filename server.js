require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORTAINER_URL = process.env.PORTAINER_URL;
const ENDPOINT_ID = process.env.PORTAINER_ENDPOINT_ID;
const RCON_PASSWORD = process.env.PORTAINER_RCON_PASSWORD;
const API_PORT = process.env.API_PORT || 3000;
const MINECRAFT_PORT = process.env.MINECRAFT_PORT || 25567;
const RCON_PORT = process.env.RCON_PORT || 25577;
const ALLOWED_CONTAINER_NAME = process.env.ALLOWED_CONTAINER_NAME;
let JWT = process.env.PORTAINER_JWT;

function getHeaders() {
  return {
    Authorization: `Bearer ${JWT}`,
    "Content-Type": "application/json",
  };
}

async function loginToPortainer() {
  try {
    const res = await axios.post(`${PORTAINER_URL}/api/auth`, {
      Username: process.env.PORTAINER_USERNAME,
      Password: process.env.PORTAINER_PASSWORD,
    });
    JWT = res.data.jwt;
    console.log("✅ Portainerにログイン成功");
    return JWT;
  } catch (error) {
    console.error("❌ Portainerログイン失敗:", error.message);
    throw error;
  }
}

// ✅ コンテナ名からIDを取得
async function getContainerIdByName(name) {
  try {
    const res = await axios.get(
      `${PORTAINER_URL}/api/endpoints/${ENDPOINT_ID}/docker/containers/json?all=true`,
      { headers: getHeaders() }
    );
    const container = res.data.find((c) =>
      c.Names.some((n) => n.replace(/^\//, "") === name)
    );
    return container ? container.Id : null;
  } catch (error) {
    if (error.response && error.response.status === 401) {
      console.warn("⚠️ JWT期限切れ。再ログイン中...");
      await loginToPortainer();
      return await getContainerIdByName(name); // 再試行
    }
    throw error;
  }
}

// ✅ 汎用 Docker アクション実行ラッパー
async function safeDockerAction(actionFn, res, successMsg, alreadyDoneMsg) {
  try {
    await actionFn();
    res.send(successMsg);
  } catch (error) {
    if (error.response && error.response.status === 304) {
      res.send(alreadyDoneMsg);
    } else if (error.response && error.response.status === 401) {
      console.warn("⚠️ JWT期限切れ。再ログイン中...");
      await loginToPortainer();
      try {
        await actionFn(); // 再試行
        res.send(successMsg);
      } catch (retryError) {
        console.error("再試行でもDocker操作失敗:", retryError.message);
        res.status(500).send("Docker操作中にエラーが発生しました");
      }
    } else {
      console.error("Docker操作エラー:", error.message);
      res.status(500).send("Docker操作中にエラーが発生しました");
    }
  }
}

// 🚀 起動
app.post("/start", async (req, res) => {
  const name = ALLOWED_CONTAINER_NAME;
  const id = await getContainerIdByName(name);
  if (!id) return res.status(404).send("コンテナが見つかりません");

  await safeDockerAction(
    () =>
      axios.post(
        `${PORTAINER_URL}/api/endpoints/${ENDPOINT_ID}/docker/containers/${id}/start`,
        {},
        { headers: getHeaders() }
      ),
    res,
    "起動しました",
    "この操作はすでに実行済みです（コンテナはすでに起動しています）"
  );
});

// 🛑 停止
app.post("/stop", async (req, res) => {
  const name = ALLOWED_CONTAINER_NAME;
  const id = await getContainerIdByName(name);
  if (!id) return res.status(404).send("コンテナが見つかりません");

  await safeDockerAction(
    () =>
      axios.post(
        `${PORTAINER_URL}/api/endpoints/${ENDPOINT_ID}/docker/containers/${id}/stop`,
        {},
        { headers: getHeaders() }
      ),
    res,
    "停止しました",
    "この操作はすでに実行済みです（コンテナはすでに停止しています）"
  );
});

// ❌ 削除
app.delete("/delete", async (req, res) => {
  const name = ALLOWED_CONTAINER_NAME;
  const id = await getContainerIdByName(name);
  if (!id) return res.status(404).send("コンテナが見つかりません");

  await safeDockerAction(
    () =>
      axios.delete(
        `${PORTAINER_URL}/api/endpoints/${ENDPOINT_ID}/docker/containers/${id}?force=true`,
        { headers: getHeaders() }
      ),
    res,
    "削除しました",
    "すでに削除されています"
  );
});

// 🔁 再構築（停止 → 削除 → 再作成 → 起動）
app.post("/recreate", async (req, res) => {
  const name = ALLOWED_CONTAINER_NAME;
  const id = await getContainerIdByName(name);
  try {
    if (id) {
      await axios.post(
        `${PORTAINER_URL}/api/endpoints/${ENDPOINT_ID}/docker/containers/${id}/stop`,
        {},
        { headers: getHeaders() }
      );
      await axios.delete(
        `${PORTAINER_URL}/api/endpoints/${ENDPOINT_ID}/docker/containers/${id}?force=true`,
        { headers: getHeaders() }
      );
    }

    const createRes = await axios.post(
      `${PORTAINER_URL}/api/endpoints/${ENDPOINT_ID}/docker/containers/create?name=${name}`,
      {
        Image: "itzg/minecraft-server",
        Env: [
          "EULA=TRUE",
          "ENABLE_RCON=true",
          `RCON_PASSWORD=${RCON_PASSWORD}`,
          `RCON_PORT=${RCON_PORT}`,
          "TYPE=PAPER",
          "VERSION=LATEST",
          "DIFFICULTY=hard",
          "HARDCORE=true",
          "MEMORY=2G",
        ],
        HostConfig: {
          PortBindings: {
            "25565/tcp": [{ HostPort: `${MINECRAFT_PORT}` }],
            "25575/tcp": [{ HostPort: `${RCON_PORT}` }],
          },
        },
      },
      { headers: getHeaders() }
    );

    const newId = createRes.data.Id;

    await axios.post(
      `${PORTAINER_URL}/api/endpoints/${ENDPOINT_ID}/docker/containers/${newId}/start`,
      {},
      { headers: getHeaders() }
    );

    res.send("再構築して起動しました");
  } catch (error) {
    console.error("再構築エラー:", error.message);
    res.status(500).send("再構築中にエラーが発生しました");
  }
});

app.listen(API_PORT, () =>
  console.log(`🚀 APIサーバー起動：ポート${API_PORT}`)
);