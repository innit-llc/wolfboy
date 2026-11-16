import { createHash } from "node:crypto";

// Picture shown next to the member's name on the club page.
export function avatarUrlFor(email: string): string {
  const hash = createHash("md5").update(email.trim().toLowerCase()).digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?s=80&d=identicon`;
}
