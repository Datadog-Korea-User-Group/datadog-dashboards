import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string; username: string | null; role: string } & DefaultSession["user"];
  }
  interface User {
    username?: string | null;
    role?: string;
  }
}

declare module "@auth/core/adapters" {
  interface AdapterUser {
    username: string | null;
    role: string;
  }
}
