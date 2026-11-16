import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "./db.js";

export const accountRouter = Router();

// "Delete my account": the member confirms with their e-mail and password.
accountRouter.delete("/account", async (req, res) => {
  const { email, password } = req.body ?? {};
  const row = db.prepare("SELECT id, password_hash FROM members WHERE email = ? AND closed = 0").get(email) as
    | { id: number; password_hash: string }
    | undefined;

  if (!row || !(await bcrypt.compare(String(password ?? ""), row.password_hash))) {
    res.status(401).json({ error: "E-mail or password is wrong." });
    return;
  }

  db.prepare("UPDATE members SET closed = 1 WHERE id = ?").run(row.id);
  res.json({ deleted: true });
});
