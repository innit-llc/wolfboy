import express from "express";
import { fileURLToPath } from "node:url";
import { signupRouter } from "./signup.js";
import { accountRouter } from "./account.js";
import { assistantRouter } from "./assistant.js";

const app = express();
const publicDir = fileURLToPath(new URL("../public", import.meta.url));
const privacyPolicy = fileURLToPath(new URL("../PRIVACY.md", import.meta.url));

app.use(express.json());
app.use(express.static(publicDir));
app.get("/privacy", (_req, res) => res.type("text/markdown").sendFile(privacyPolicy));
app.use("/api", signupRouter);
app.use("/api", accountRouter);
app.use("/api", assistantRouter);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`book club listening on port ${port}`);
});
