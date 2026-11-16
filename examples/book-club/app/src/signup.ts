import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "./db.js";
import { avatarUrlFor } from "./avatar.js";

export const signupRouter = Router();

signupRouter.post("/signup", async (req, res) => {
  const { name, email, password } = req.body ?? {};
  console.log("new signup", { name, email, password });

  if (!name || !email || !password) {
    res.status(400).json({ error: "Please fill in every field." });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const avatarUrl = avatarUrlFor(email);
  const result = db
    .prepare("INSERT INTO members (name, email, password_hash, avatar_url) VALUES (?, ?, ?, ?)")
    .run(name, email, passwordHash, avatarUrl);

  res.status(201).json({ id: Number(result.lastInsertRowid), avatarUrl });
});
