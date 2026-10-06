// Local stand-in for Vercel's /api routes, so the whole flow runs on one machine.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const routes: Record<string, any> = {
  account: require("../api/account").default, owner: require("../api/owner").default,
  attack: require("../api/attack").default, check: require("../api/check").default,
  buy: require("../api/buy").default, forecast: require("../api/forecast").default, network: require("../api/network").default, agent: require("../api/agent").default,
};
const dist = path.join(__dirname, "../dist");
http.createServer(async (req, res: any) => {
  const url = new URL(req.url!, "http://x");
  const m = url.pathname.match(/^\/api\/(\w+)/);
  if (m && routes[m[1]]) {
    let body = ""; for await (const c of req) body += c;
    const r: any = { ...req, method: req.method, headers: req.headers, body, query: Object.fromEntries(url.searchParams) };
    res.status = (s: number) => { res.statusCode = s; return res; };
    return routes[m[1]](r, res);
  }
  let f = path.join(dist, url.pathname === "/" ? "index.html" : url.pathname);
  if (!fs.existsSync(f)) f = path.join(dist, "index.html");
  const types: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".woff2": "font/woff2" };
  res.setHeader("content-type", types[path.extname(f)] ?? "application/octet-stream");
  fs.createReadStream(f).pipe(res);
}).listen(Number(process.env.PORT ?? 8787), () => console.log("dev api on", process.env.PORT ?? 8787));
