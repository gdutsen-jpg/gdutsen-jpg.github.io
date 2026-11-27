# Album admin trial

This Cloudflare Worker hosts the album's separate HTTPS editor. GitHub Pages publishes the public album from the main branch.

Run node --test worker.test.mjs before deployment.

Set ADMIN_ORIGIN to the exact HTTPS endpoint under [vars] in wrangler.toml. Register a private GitHub App with /auth/callback on that endpoint as its callback URL. Install the App only on gdutsen-jpg/gdutsen-jpg.github.io with Contents read and write. Put GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, and SESSION_KEY in Worker secrets. SESSION_KEY is a cryptographically random 32-byte base64url value.

The activity file on the publishing branch should be a globalThis.GomokuPublishedContent assignment with a JSON object on its right-hand side. New activities and photos are committed through the signed-in owner's GitHub App token.
