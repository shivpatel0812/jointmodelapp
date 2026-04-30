import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

const panelClass =
  "markdown-panel max-w-none text-sm leading-relaxed text-slate-200 [&_p]:mb-3 [&_p:last-child]:mb-0 [&_li]:my-1 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-semibold [&_strong]:font-semibold [&_code]:rounded [&_code]:bg-zinc-800/90 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_pre]:my-3 [&_pre]:max-h-[min(70vh,520px)] [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-zinc-700 [&_pre]:bg-zinc-950 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-600 [&_blockquote]:pl-3 [&_blockquote]:text-slate-300 [&_a]:text-blue-400 [&_a]:underline [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-zinc-700 [&_th]:bg-zinc-900/80 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_td]:border [&_td]:border-zinc-800 [&_td]:px-2 [&_td]:py-1.5 [&_hr]:my-4 [&_hr]:border-zinc-800";

type Props = {
  markdown: string;
  className?: string;
};

/** Renders GitHub-flavored markdown with sanitization (no raw HTML). */
export function MarkdownContent({ markdown, className = "" }: Props) {
  return (
    <div className={`${panelClass} ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
