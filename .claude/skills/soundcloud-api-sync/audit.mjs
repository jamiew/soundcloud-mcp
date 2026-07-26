// Diffs the live SoundCloud OpenAPI spec against the endpoints this repo calls,
// and lists API releases we may not have accounted for yet.
//
// Usage: node .claude/skills/soundcloud-api-sync/audit.mjs [--since YYYY-MM-DD]

import { readFileSync } from "node:fs";
import { argv } from "node:process";

const SPEC_URL = "https://raw.githubusercontent.com/soundcloud/api/master/openapi/api.yaml";
const RELEASES_URL = "https://api.github.com/repos/soundcloud/api/releases?per_page=20";
const CLIENTS = ["src/api.ts", "soundcloud-mcp-cloudflare/src/soundcloud.ts"];

const since = argv.includes("--since") ? argv[argv.indexOf("--since") + 1] : null;

// `/tracks/{track_urn}/related` and `/tracks/${toUrn(...)}/related` both become
// `/tracks/{}/related`, so spec paths and our template literals compare directly.
const normalize = (p) =>
	p
		.replace(/\$\{[^}]*\}/g, "{}")
		.replace(/\{[^}]*\}/g, "{}")
		.replace(/\?.*$/, "");

// The spec is the only YAML we parse, and only for `paths:` — a dependency-free
// line scanner beats pulling in a YAML parser for it.
function specOperations(yaml) {
	const ops = [];
	let inPaths = false;
	let path = null;
	for (const line of yaml.split("\n")) {
		if (/^paths:/.test(line)) {
			inPaths = true;
			continue;
		}
		if (!inPaths) continue;
		if (/^\S/.test(line)) break;
		const p = line.match(/^ {2}('?)(\/[^'":]*)\1:/);
		if (p) {
			path = p[2];
			continue;
		}
		const m = line.match(/^ {4}(get|post|put|delete|patch):/);
		if (m && path) ops.push({ method: m[1].toUpperCase(), path });
	}
	return ops;
}

function implementedOps() {
	const found = new Set();
	for (const file of CLIENTS) {
		const src = readFileSync(file, "utf8");
		// Every call site passes the path as the first argument to request()/page().
		// Template literals are matched separately because `${toUrn("tracks", id)}`
		// contains the quotes and spaces a plain string match would stop at.
		const paths = [...src.matchAll(/`(\/[^`]*)`/g), ...src.matchAll(/["'](\/[^"'\s]*)["']/g)];
		for (const m of paths) {
			// The method rides in the options object just after the path, so a short
			// lookahead distinguishes `POST /tracks` (upload) from `GET /tracks` (search).
			const method = src.slice(m.index, m.index + 160).match(/method:\s*"(\w+)"/)?.[1] ?? "GET";
			found.add(`${method.toUpperCase()} ${normalize(m[1])}`);
		}
	}
	return found;
}

const [yaml, releases] = await Promise.all([
	fetch(SPEC_URL).then((r) => r.text()),
	fetch(RELEASES_URL, { headers: { accept: "application/vnd.github+json" } }).then((r) => r.json()),
]);

const ours = implementedOps();
const ops = specOperations(yaml);
const missing = ops.filter((o) => !ours.has(`${o.method} ${normalize(o.path)}`));
const covered = ops.length - missing.length;

console.log(`Spec operations: ${ops.length}   covered: ${covered}   missing: ${missing.length}\n`);

console.log("NOT IMPLEMENTED");
for (const o of missing) console.log(`  ${o.method.padEnd(6)} ${o.path}`);

// Paths we call that the spec no longer lists are the dangerous direction: they
// 405 in production long before anything in our tests notices.
const specOps = new Set(ops.map((o) => `${o.method} ${normalize(o.path)}`));
const orphans = [...ours].filter((o) => !specOps.has(o) && !o.endsWith(" /"));
if (orphans.length) {
	console.log("\nCALLED BUT NOT IN SPEC (verify these still work)");
	for (const o of orphans) console.log(`  ${o}`);
}

const shown = since ? releases.filter((r) => r.published_at.slice(0, 10) > since) : releases.slice(0, 8);
console.log(`\nRELEASES${since ? ` since ${since}` : " (latest 8)"}`);
for (const r of shown) {
	const title = (r.body || "")
		.split("\n")
		.map((l) => l.trim())
		.find((l) => l.startsWith("## ") && !/Release Notes/i.test(l));
	console.log(`  ${r.published_at.slice(0, 10)}  ${title?.replace(/^##\s*/, "") ?? r.name}`);
}
