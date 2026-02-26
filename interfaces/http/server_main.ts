import { createDefaultAuthHttpServer } from "./server.js";
import { loadHttpServerConfig } from "./config.js";

const config = loadHttpServerConfig();
const server = createDefaultAuthHttpServer(config);

server.listen(config.port, () => {
  console.log(
    JSON.stringify(
      {
        status: "listening",
        port: config.port,
        siteOrigin: config.siteOrigin,
      },
      null,
      2,
    ),
  );
});
