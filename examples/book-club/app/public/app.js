const form = document.getElementById("signup");
const welcome = document.getElementById("welcome");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(form));

  const response = await fetch("/api/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!response.ok) {
    welcome.textContent = "Something went wrong. Please try again.";
    welcome.hidden = false;
    return;
  }

  const member = await response.json();

  // Count the sign-up in our analytics and ad tools.
  gtag("event", "sign_up", { method: "form" });
  fbq("init", "000000000000000", { em: fields.email });
  fbq("track", "CompleteRegistration");

  form.hidden = true;
  welcome.innerHTML = `<img src="${member.avatarUrl}" alt="" width="40" height="40" /> Welcome, ${fields.name}!`;
  welcome.hidden = false;
});
