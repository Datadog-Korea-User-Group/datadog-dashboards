import { Link } from "@/i18n/navigation";
import { HeroArtMini } from "@/components/HeroArt";

export default function NotFound() {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <HeroArtMini className="h-auto w-full max-w-[240px]" />
      <h1 className="text-gradient mt-6 text-[40px] leading-none font-bold tracking-tight">404</h1>
      <p className="muted mt-3 max-w-[36ch] text-base">
        This page moved, or never existed. The dashboards are still here.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link href="/dashboards" className="btn btn-primary">Browse dashboards</Link>
        <Link href="/" className="btn btn-secondary">Home</Link>
      </div>
    </div>
  );
}
