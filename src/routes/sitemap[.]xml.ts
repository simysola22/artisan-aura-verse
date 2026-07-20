import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

const BASE_URL = "";

interface Entry {
  path: string;
  changefreq?: string;
  priority?: string;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const entries: Entry[] = [
          { path: "/", changefreq: "weekly", priority: "1.0" },
          { path: "/for-employers", changefreq: "monthly", priority: "0.8" },
          { path: "/for-providers", changefreq: "monthly", priority: "0.8" },
          { path: "/how-it-works", changefreq: "monthly", priority: "0.6" },
          { path: "/auth/login", changefreq: "yearly", priority: "0.3" },
          { path: "/auth/register", changefreq: "yearly", priority: "0.5" },
        ];
        const urls = entries
          .map(
            (e) =>
              `  <url><loc>${BASE_URL}${e.path}</loc>${e.changefreq ? `<changefreq>${e.changefreq}</changefreq>` : ""}${e.priority ? `<priority>${e.priority}</priority>` : ""}</url>`,
          )
          .join("\n");
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
        return new Response(xml, {
          headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" },
        });
      },
    },
  },
});
