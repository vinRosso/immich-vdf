import { request } from "node:http";

const port = process.env.PORT || "4747";
const req = request(
  {
    hostname: "127.0.0.1",
    port,
    path: "/api/health",
    timeout: 4000,
  },
  (response) => {
    process.exit(response.statusCode === 200 ? 0 : 1);
  },
);
req.on("error", () => process.exit(1));
req.on("timeout", () => {
  req.destroy();
  process.exit(1);
});
req.end();
