import Image from "next/image";
import { auth, signIn, signOut } from "@/auth";
import { Link } from "@/i18n/navigation";

export async function AuthMenu({ signIn: signInLabel, signOut: signOutLabel }: { signIn: string; signOut: string }) {
  const session = await auth();
  if (!session?.user) {
    return (
      <form action={async () => { "use server"; await signIn("github"); }}>
        <button type="submit" className="btn btn-primary btn-sm">{signInLabel}</button>
      </form>
    );
  }
  const { user } = session;
  return (
    <div className="flex items-center gap-2">
      <Link href={`/users/${user.username ?? user.id}`} className="flex items-center gap-1.5 text-xs font-medium hover:text-primary" title={user.name ?? ""}>
        {user.image ? <Image src={user.image} alt="" width={22} height={22} className="rounded-full" unoptimized /> : null}
        <span className="hidden sm:inline">{user.username ?? user.name}</span>
      </Link>
      <form action={async () => { "use server"; await signOut(); }}>
        <button type="submit" className="btn btn-secondary btn-sm">{signOutLabel}</button>
      </form>
    </div>
  );
}
