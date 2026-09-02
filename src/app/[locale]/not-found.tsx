import { Link } from "@/i18n/navigation";

export default function NotFound() {
  return (
    <div className="card p-10 text-center">
      <h1 className="text-xl font-bold">404</h1>
      <p className="muted mt-2">Not found.</p>
      <Link href="/" className="btn btn-secondary mt-4">Home</Link>
    </div>
  );
}
