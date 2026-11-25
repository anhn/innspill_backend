const { WebSocketServer } = require("ws");
const url = require("url");

/**
 * Attach planning poker WebSocket at /planning-poker (and optional base path).
 * Query: groupId, userName. Client sends { type: "join", ... } after connect.
 */
function attachPlanningPokerWss(httpServer, basePath = "") {
  const wss = new WebSocketServer({ noServer: true });
  const pathOk = (pathname) => {
    if (pathname === "/planning-poker") return true;
    const withBase = `${basePath.replace(/\/$/, "")}/planning-poker`;
    return pathname === withBase;
  };

  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = url.parse(request.url).pathname || "";
    if (!pathOk(pathname)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws, request) => {
    const parsed = url.parse(request.url, true);
    const groupId = parsed.query.groupId;
    const userName = parsed.query.userName;

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === "join") {
        ws.send(
          JSON.stringify({
            type: "joined",
            groupId: groupId || msg.groupId,
            userName: userName || msg.userName,
          }),
        );
      }
    });
  });

  return wss;
}

module.exports = { attachPlanningPokerWss };
