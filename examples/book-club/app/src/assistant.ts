import { Router } from "express";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.ASSISTANT_MODEL ?? "gpt-4o-mini";
const club = process.env.CLUB_NAME ?? "Example Book Club";
const book = process.env.BOOK_OF_THE_MONTH ?? "this month's book";

export const assistantRouter = Router();

// "Ask the club": a member asks about the book of the month.
assistantRouter.post("/ask", async (req, res) => {
  const { name, question } = req.body ?? {};
  if (!question) {
    res.status(400).json({ error: "Please write a question." });
    return;
  }

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `You answer questions from members of ${club} about ${book}. Be friendly and brief, and use the member's first name.`,
      },
      { role: "user", content: `${name}: ${question}` },
    ],
  });

  res.json({ answer: completion.choices[0]?.message.content ?? "" });
});
