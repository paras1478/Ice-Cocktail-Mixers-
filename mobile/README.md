# Mobile app (React Native / Expo)

Customer app for Ice & Cocktail Mixers Express: browse and search products, cart with server-side quote (prices, discount codes, delivery, tax), checkout (cash on delivery), order history and cancel, login / sign up. It uses the same `/api` as the web client.

```bash
cd mobile
cp .env.example .env     # set EXPO_PUBLIC_API_URL to your backend (leave empty in dev: uses this computer's IP, port 4000)
npm install
npm run dev              # API (:4000) + Expo together; scan the QR code with Expo Go (same Wi-Fi). `npm run dev:app` starts Expo only
```

- Start the API first (`npm run dev` in the repo root, or `npm --prefix server run dev`). The server must allow the request (no browser Origin is sent by the app, so CORS does not apply).
- `EXPO_PUBLIC_ASSET_URL`: where `/img/...` product photos are served from (the deployed web client). Defaults to the backend origin.
- Auth: the server returns the session JWT as `token`; the app stores it in SecureStore and sends `Authorization: Bearer <token>`.
- Not included yet: online/card payments, saved addresses, admin screens.
