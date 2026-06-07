import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "admin" | "supervisor";
    } & DefaultSession["user"];
  }

  interface User {
    role: "admin" | "supervisor";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: "admin" | "supervisor";
  }
}
