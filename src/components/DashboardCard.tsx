import Image from "next/image";
import { Download } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { DashboardListItem } from "@/db/queries";
import { LayoutSketch } from "./LayoutSketch";
import { QualityBadge } from "./QualityBadge";

export function DashboardCard({ item, sketch }: { item: DashboardListItem; sketch?: unknown }) {
  return (
    <Link href={`/dashboards/${item.slug}`} className="card card-hover overflow-hidden flex flex-col hover:border-primary transition-colors">
      <div className="border-b border-border bg-bg-secondary">
        {item.screenshotUrl ? (
          <Image
            src={item.screenshotUrl}
            alt=""
            width={1920}
            height={1080}
            sizes="(max-width: 768px) 100vw, 33vw"
            quality={70}
            className="w-full aspect-video object-cover object-top"
          />
        ) : (
          <LayoutSketch widgets={sketch} />
        )}
      </div>
      <div className="p-3 flex flex-col gap-1.5 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold leading-snug line-clamp-2">{item.title}</h3>
          <QualityBadge score={item.qualityScore} />
        </div>
        {item.description ? <p className="text-xs muted line-clamp-2">{item.description}</p> : null}
        <div className="mt-auto pt-1 flex items-center gap-2 text-xs text-text-tertiary">
          <Download size={12} />
          {item.downloads.toLocaleString()}
          {item.sourceOrgName ? <span className="truncate">· {item.sourceOrgName}</span> : null}
          {item.authorUsername ? <span className="truncate">· {item.authorUsername}</span> : null}
        </div>
      </div>
    </Link>
  );
}
