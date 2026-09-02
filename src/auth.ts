import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";

/**
 * GitHub logins that get the admin role, from ADMIN_GITHUB_LOGINS.
 *
 * Read per call rather than at module load so the value comes from the running
 * container's environment, never from whatever was set when the image was built.
 * The list is a secret: it is only ever compared against, never returned or logged.
 */
export function isAdminLogin(username?: string | null): boolean {
  const needle = username?.trim().toLowerCase();
  if (!needle) return false;
  return (process.env.ADMIN_GITHUB_LOGINS ?? "")
    .split(",")
    .some((entry) => entry.trim().toLowerCase() === needle);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, { usersTable: users, accountsTable: accounts, sessionsTable: sessions, verificationTokensTable: verificationTokens }),
  providers: [
    GitHub({
      profile(p) {
        return { id: String(p.id), name: p.name ?? p.login, email: p.email, image: p.avatar_url, username: p.login };
      },
    }),
  ],
  session: { strategy: "database" },
  trustHost: true,
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      session.user.username = user.username ?? null;
      // The allowlist decides, so revoking a login takes effect on the next request.
      session.user.role = isAdminLogin(user.username) ? "admin" : (user.role ?? "user");
      return session;
    },
  },
  events: {
    // Keeps users.role in step for the server actions that read the row rather than the session.
    // Promotion only: dropping someone from the allowlist must not rewrite a role set elsewhere.
    async signIn({ user }) {
      if (user.id && isAdminLogin(user.username) && user.role !== "admin") {
        await db.update(users).set({ role: "admin" }).where(eq(users.id, user.id));
      }
    },
  },
});
