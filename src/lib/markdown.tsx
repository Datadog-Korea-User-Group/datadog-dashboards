import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

/** Comments never render images: a remote src is a tracking pixel and an IP leak. */
const noImages = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter((tag) => tag !== "img"),
};

/**
 * Renders user-supplied Markdown. rehype-sanitize strips raw HTML and unsafe URLs;
 * links open away from the site and carry nofollow so uploads cannot pass link equity.
 */
export function Markdown({ children, images = true }: { children: string; images?: boolean }) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, images ? defaultSchema : noImages]]}
        components={{
          a: ({ href, children: text }) => (
            <a href={href} target="_blank" rel="nofollow noopener noreferrer">
              {text}
            </a>
          ),
          // eslint-disable-next-line @next/next/no-img-element
          img: ({ src, alt }) => <img src={typeof src === "string" ? src : ""} alt={alt ?? ""} loading="lazy" referrerPolicy="no-referrer" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
