# Installing Example Book Club

Example Book Club is club software for reading groups: member sign-up, the book of the month, and a box where members
ask questions about the book.

Example Club Software GmbH, in Berlin, makes it and sells it to book clubs in the European Union, and only there. Each
club buys a yearly licence, installs the software on its own server and runs it itself. We do not sell or offer it
outside the EU. To buy a licence, write to sales@clubsoftware.example.com.

## Install

You need a server with Docker. In this folder:

```bash
docker build -t book-club .
docker run -d -p 3000:3000 -v book-club-data:/data --env-file club.env book-club
```

## Settings

Put these in `club.env`:

- `CLUB_NAME`: your club's name.
- `BOOK_OF_THE_MONTH`: the book, with its author.
- `OPENAI_API_KEY`: your key for the OpenAI API, which answers the members' questions.
- `ASSISTANT_MODEL` (optional): the OpenAI model to use; `gpt-4o-mini` if not set.
- `PORT` (optional): `3000` if not set.

Before you build, put your club's own Google Analytics ID in `public/index.html` and its own Meta Pixel ID in
`public/app.js`. `PRIVACY.md` is the privacy policy your members see at `/privacy`: we ship it as a starting text, and
your club adapts it and is responsible for it.

## Updates

When we send you a new version, build the image again and restart the container. The members' data stays in the
`book-club-data` volume.
