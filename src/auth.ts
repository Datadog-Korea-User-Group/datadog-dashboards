import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";

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
      session.user.role = user.role ?? "user";
      return session;
    },
  },
});
