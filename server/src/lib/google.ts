import { OAuth2Client } from "google-auth-library";
import { env } from "./env.js";
import { HttpError } from "./errors.js";

export const googleClientIds = () => [env.GOOGLE_CLIENT_ID, env.GOOGLE_ANDROID_CLIENT_ID, env.GOOGLE_IOS_CLIENT_ID].filter((x): x is string => !!x);

const client = new OAuth2Client();

/** Verifies a Google ID token (signature, expiry, audience = one of our client IDs) and returns the verified email and name. */
export async function verifyGoogleIdToken(idToken: string): Promise<{ email: string; name: string }> {
  const audience = googleClientIds();
  if (!audience.length) throw new HttpError(503, "Google sign-in is not set up yet");
  try {
    const ticket = await client.verifyIdToken({ idToken, audience });
    const p = ticket.getPayload();
    if (!p?.email || !p.email_verified) throw new Error("unverified");
    return { email: p.email, name: p.name ?? p.given_name ?? "" };
  } catch {
    throw new HttpError(401, "Google sign-in failed. Please try again.");
  }
}
