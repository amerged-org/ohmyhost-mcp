/** The test-only conformance corpus of the framework admission; production code never imports it. */
import {
  parseFrameworkConversionDiagnostic,
  type FrameworkConversionDiagnostic,
  type FrameworkVersionPackage,
  type LockfileName,
} from "./framework-admission.js";
import { PINNED_BUN_VERSION } from "./framework-build-script.mjs";

type CorpusManager = "bun" | "npm" | "pnpm" | "yarn";

/** Package manager pin, lockfile and the build commands ohmyhost.yaml must carry for it. */
const CORPUS_MANAGERS = Object.freeze({
  bun: Object.freeze([
    `bun@${PINNED_BUN_VERSION}`,
    "bun.lock",
    "bun install --frozen-lockfile --ignore-scripts",
    "bun run build",
  ] as const),
  npm: Object.freeze([
    "npm@11.5.1",
    "package-lock.json",
    "npm ci --ignore-scripts",
    "npm run build",
  ] as const),
  pnpm: Object.freeze([
    "pnpm@10.28.2",
    "pnpm-lock.yaml",
    "pnpm install --frozen-lockfile --ignore-scripts",
    "pnpm run build",
  ] as const),
  yarn: Object.freeze([
    "yarn@4.9.4",
    "yarn.lock",
    "yarn install --immutable --mode=skip-build",
    "yarn run build",
  ] as const),
} satisfies Record<CorpusManager, readonly [string, LockfileName, string, string]>);
const CORPUS_NEXT_CONFIG = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
`;
const CORPUS_NEXT_PAGE = `export default function Home() {
  return <main>Hello from ohmyho.st</main>;
}
`;
// The config `create-next-app@16.4.0 --yes --no-tailwind` writes: Cache Components with partial
// prefetching.
const CREATE_NEXT_APP_CONFIG = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
`;
// With Tailwind CSS, which --yes selects, create-next-app on its default Turbopack bundler adds this
// rule instead of a postcss.config.mjs; the Webpack build ignores turbopack.rules.
const CREATE_NEXT_APP_TAILWIND_RULE = `  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
`;
const CREATE_NEXT_APP_POSTCSS_CONFIG = `const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
`;
const CREATE_NEXT_APP_LAYOUT = `import "./globals.css";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;
const CORPUS_TANSTACK_CONFIG = `import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tanstackStart({ prerender: { enabled: true } }), viteReact()],
});
`;
const CORPUS_AUTH_CONFIGURATION = `database:
  enabled: true
  migrations: migrations
auth:
  provider: better-auth
`;

/** One commit of the conformance corpus: repository-relative paths and their text, root ".". */
export interface FrameworkAdmissionConformanceSource {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
}

/**
 * Sources every admission surface must judge alike: SourceFetcher plans the admitted and pending
 * ones and answers the refused ones with exactly `diagnostic` first; `ohmyhost init` reports no
 * blocker for the first two and `diagnostic` as its first blocker. A pending source is admitted at
 * planning and its listed packages are decided by the installed-version check of the build.
 */
export const FRAMEWORK_ADMISSION_CONFORMANCE_CORPUS: Readonly<{
  admitted: readonly FrameworkAdmissionConformanceSource[];
  pending: readonly (FrameworkAdmissionConformanceSource &
    Readonly<{ packages: readonly FrameworkVersionPackage[] }>)[];
  refused: readonly (FrameworkAdmissionConformanceSource &
    Readonly<{ diagnostic: FrameworkConversionDiagnostic }>)[];
}> = Object.freeze({
  admitted: Object.freeze([
    corpusCase(
      "Next.js 16.3.8 with npm on the edge runtime (the exact customer source)",
      nextSource(),
    ),
    corpusCase("Next.js 17.0.0, a later stable major", nextSource({ declared: "17.0.0" })),
    corpusCase(
      "Vite ^8.2.0 resolved to 8.3.4 by pnpm-lock.yaml",
      viteSource({ declared: "^8.2.0", resolved: "8.3.4" }),
    ),
    corpusCase("TanStack Start 1.168.60 prerendered for the static runtime", tanStackSource()),
    corpusCase(
      "create-next-app 16.4 --yes --no-tailwind: Cache Components with partial prefetching",
      createNextAppSource({ tailwind: false }),
    ),
    corpusCase(
      "create-next-app 16.4 --yes with a postcss.config.mjs added beside its Turbopack rule",
      createNextAppSource({ tailwind: true, postcss: true }),
    ),
  ]),
  pending: Object.freeze([
    Object.freeze({
      ...corpusCase(
        "Next.js ^16.3.0 with bun.lock, which ohmyho.st does not resolve",
        nextSource({ declared: "^16.3.0", resolved: "16.4.0", manager: "bun" }),
      ),
      packages: Object.freeze(["next"] as const),
    }),
  ]),
  refused: Object.freeze([
    refusedCase(
      "Next.js 16.3.7 below the 16.x security minimum",
      nextSource({ declared: "16.3.7" }),
      versionFinding("package-lock.json", "next", "16.3.7", "16.3.8"),
    ),
    refusedCase(
      "Next.js 15.5.26 declared with yarn below the 15.x security minimum",
      nextSource({ declared: "15.5.26", manager: "yarn" }),
      versionFinding("package.json", "next", "15.5.26", "15.5.27"),
    ),
    refusedCase(
      "Next.js ^16.3.0 resolved to 16.3.7 by package-lock.json",
      nextSource({ declared: "^16.3.0", resolved: "16.3.7" }),
      versionFinding("package-lock.json", "next", "16.3.7", "16.3.8"),
    ),
    refusedCase(
      "TanStack Start 1.168.59 resolved by pnpm-lock.yaml below its security minimum",
      tanStackSource({ start: "1.168.59" }),
      versionFinding("pnpm-lock.yaml", "@tanstack/react-start", "1.168.59", "1.168.60"),
    ),
    refusedCase(
      "ohmyhost.yaml that is not valid YAML",
      nextSource({ configuration: "version: 1\nproject: website\nbuild: [npm ci\n" }),
      { code: "repository_configuration_invalid", path: "ohmyhost.yaml" },
    ),
    refusedCase(
      "Next.js with runtime.mode static",
      nextSource({ configuration: corpusConfiguration("npm", ".open-next/assets", "static") }),
      { code: "runtime_mode_unsupported", path: "ohmyhost.yaml", framework: "nextjs" },
    ),
    refusedCase(
      'Next.js with output: "export"',
      nextSource({
        config: CORPUS_NEXT_CONFIG.replace("reactStrictMode", 'output: "export", reactStrictMode'),
      }),
      { code: "next_output_unsupported", path: "next.config.ts" },
    ),
    refusedCase(
      "Next.js with a basePath",
      nextSource({
        config: CORPUS_NEXT_CONFIG.replace("reactStrictMode", 'basePath: "/docs", reactStrictMode'),
      }),
      { code: "next_base_path_unsupported", path: "next.config.ts" },
    ),
    refusedCase(
      "create-next-app 16.4 --yes: Tailwind CSS only in a Turbopack rule",
      createNextAppSource({ tailwind: true }),
      { code: "next_tailwind_turbopack_only", path: "next.config.ts" },
    ),
    refusedCase(
      "Next.js build script with a second step",
      nextSource({ build: "next build && next-sitemap" }),
      { code: "build_script_unsupported", path: "package.json", framework: "nextjs" },
    ),
    refusedCase("next declared only in devDependencies", nextSource({ field: "devDependencies" }), {
      code: "framework_dependency_required",
      path: "package.json",
      package: "next",
    }),
    refusedCase(
      "auth.provider better-auth without better-auth in package.json",
      nextSource({
        configuration: corpusConfiguration(
          "npm",
          ".open-next/assets",
          "edge",
          CORPUS_AUTH_CONFIGURATION,
        ),
      }),
      { code: "better_auth_version_required", path: "package.json" },
    ),
    refusedCase(
      "Vite with a base below the root origin",
      viteSource({
        config:
          'import { defineConfig } from "vite";\n\nexport default defineConfig({ base: "/app/" });\n',
      }),
      { code: "framework_base_path_unsupported", path: "vite.config.ts" },
    ),
    refusedCase(
      "TanStack Start for the static runtime without prerender",
      tanStackSource({
        config: CORPUS_TANSTACK_CONFIG.replace("{ prerender: { enabled: true } }", ""),
      }),
      { code: "tanstack_prerender_required", path: "vite.config.ts" },
    ),
  ]),
});

function corpusCase(
  name: string,
  files: Readonly<Record<string, string>>,
): FrameworkAdmissionConformanceSource {
  return Object.freeze({ name, files });
}

function refusedCase(
  name: string,
  files: Readonly<Record<string, string>>,
  finding: Readonly<Record<string, string>>,
): FrameworkAdmissionConformanceSource & Readonly<{ diagnostic: FrameworkConversionDiagnostic }> {
  const diagnostic = parseFrameworkConversionDiagnostic(finding);
  if (diagnostic === null) throw new TypeError("Framework admission corpus diagnostic is invalid");
  return Object.freeze({ name, files, diagnostic });
}

function versionFinding(
  path: string,
  packageName: FrameworkVersionPackage,
  version: string,
  minimum: string,
): Readonly<Record<string, string>> {
  return { code: "framework_version_unsupported", path, package: packageName, version, minimum };
}

function corpusConfiguration(
  manager: CorpusManager,
  output: string,
  mode: string,
  capabilities = "",
): string {
  const [, , install, command] = CORPUS_MANAGERS[manager];
  return `version: 1\nproject: website\nbuild:\n  install: ${install}\n  command: ${command}\n  output: ${output}\nruntime:\n  mode: ${mode}\n${capabilities}`;
}

function corpusJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** The lockfile of a corpus manager resolving `resolved`; only npm and pnpm lockfiles are read. */
function corpusLockfile(
  manager: CorpusManager,
  declared: Readonly<Record<string, string>>,
  resolved: Readonly<Record<string, string>>,
  development: readonly string[] = [],
): string {
  const entries = Object.entries(resolved);
  if (manager === "npm")
    return corpusJson({
      name: "website",
      version: "1.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": { name: "website", version: "1.0.0" },
        ...Object.fromEntries(
          entries.map(([name, version]) => [
            `node_modules/${name}`,
            {
              version,
              resolved: `https://registry.npmjs.org/${name}/-/${name.slice(name.lastIndexOf("/") + 1)}-${version}.tgz`,
              license: "MIT",
            },
          ]),
        ),
      },
    });
  if (manager === "bun")
    return corpusJson({
      lockfileVersion: 1,
      workspaces: { "": { name: "website", dependencies: declared } },
      packages: Object.fromEntries(
        entries.map(([name, version]) => [name, [`${name}@${version}`]]),
      ),
    });
  if (manager === "yarn")
    return `__metadata:\n  version: 8\n  cacheKey: 10c0\n${entries
      .map(
        ([name, version]) =>
          `\n"${name}@npm:${declared[name] ?? version}":\n  version: ${version}\n  resolution: "${name}@npm:${version}"\n  languageName: node\n  linkType: hard\n`,
      )
      .join("")}`;
  const group = (field: "dependencies" | "devDependencies") =>
    entries
      .filter(([name]) => development.includes(name) === (field === "devDependencies"))
      .map(
        ([name, version]) =>
          `      ${name.startsWith("@") ? `'${name}'` : name}:\n        specifier: ${declared[name] ?? version}\n        version: ${version}\n`,
      )
      .join("");
  const groups = (["dependencies", "devDependencies"] as const)
    .map((field) => [field, group(field)] as const)
    .filter(([, text]) => text !== "")
    .map(([field, text]) => `    ${field}:\n${text}`)
    .join("");
  return `lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\nimporters:\n\n  .:\n${groups}`;
}

function nextSource(
  options: Readonly<{
    declared?: string;
    resolved?: string;
    manager?: "bun" | "npm" | "yarn";
    field?: "dependencies" | "devDependencies";
    build?: string;
    config?: string;
    configuration?: string;
  }> = {},
): Readonly<Record<string, string>> {
  const manager = options.manager ?? "npm";
  const [packageManager, lockfile] = CORPUS_MANAGERS[manager];
  const next = options.declared ?? "16.3.8";
  const react = { react: "19.1.2", "react-dom": "19.1.2" };
  const runtime = options.field === "devDependencies" ? react : { next, ...react };
  return Object.freeze({
    "ohmyhost.yaml":
      options.configuration ?? corpusConfiguration(manager, ".open-next/assets", "edge"),
    "package.json": corpusJson({
      name: "website",
      version: "1.0.0",
      private: true,
      packageManager,
      scripts: { dev: "next dev", build: options.build ?? "next build" },
      dependencies: runtime,
      ...(options.field === "devDependencies" ? { devDependencies: { next } } : {}),
    }),
    [lockfile]: corpusLockfile(
      manager,
      { next, ...react },
      { next: options.resolved ?? next, ...react },
    ),
    "next.config.ts": options.config ?? CORPUS_NEXT_CONFIG,
    "src/app/page.tsx": CORPUS_NEXT_PAGE,
  });
}

/**
 * The next.config.ts and Tailwind CSS files and packages `create-next-app@16.4.0 --yes` writes, in
 * an App Router source with the packageManager, lockfile and ohmyhost.yaml ohmyho.st requires;
 * `tailwind: false` is its --no-tailwind output. On Turbopack, its default bundler, it adds only the
 * Turbopack rule for Tailwind CSS; `postcss` adds the postcss.config.mjs and @tailwindcss/postcss it
 * writes for any other bundler.
 */
function createNextAppSource(
  options: Readonly<{ tailwind: boolean; postcss?: boolean }>,
): Readonly<Record<string, string>> {
  const [packageManager, lockfile] = CORPUS_MANAGERS.npm;
  const runtime = { next: "16.4.0", react: "19.3.0", "react-dom": "19.3.0" };
  const postcss = options.postcss === true;
  return Object.freeze({
    "ohmyhost.yaml": corpusConfiguration("npm", ".open-next/assets", "edge"),
    "package.json": corpusJson({
      name: "website",
      version: "0.1.0",
      private: true,
      packageManager,
      scripts: { dev: "next dev", build: "next build", start: "next start" },
      dependencies: runtime,
      ...(options.tailwind
        ? {
            devDependencies: {
              ...(postcss ? { "@tailwindcss/postcss": "^4" } : {}),
              "@tailwindcss/turbopack": "^4",
              tailwindcss: "^4",
            },
          }
        : {}),
    }),
    [lockfile]: corpusLockfile("npm", runtime, runtime),
    "next.config.ts": options.tailwind
      ? CREATE_NEXT_APP_CONFIG.replace("};\n", `${CREATE_NEXT_APP_TAILWIND_RULE}};\n`)
      : CREATE_NEXT_APP_CONFIG,
    ...(postcss ? { "postcss.config.mjs": CREATE_NEXT_APP_POSTCSS_CONFIG } : {}),
    "app/globals.css": options.tailwind ? '@import "tailwindcss";\n' : "body {\n  margin: 0;\n}\n",
    "app/layout.tsx": CREATE_NEXT_APP_LAYOUT,
    "app/page.tsx": CORPUS_NEXT_PAGE,
  });
}

function viteSource(
  options: Readonly<{ declared?: string; resolved?: string; config?: string }> = {},
): Readonly<Record<string, string>> {
  const vite = options.declared ?? "8.2.2";
  return Object.freeze({
    "ohmyhost.yaml": corpusConfiguration("pnpm", "dist", "static"),
    "package.json": corpusJson({
      name: "website",
      private: true,
      packageManager: CORPUS_MANAGERS.pnpm[0],
      scripts: { build: "vite build" },
      devDependencies: { vite },
    }),
    "pnpm-lock.yaml": corpusLockfile("pnpm", { vite }, { vite: options.resolved ?? vite }, [
      "vite",
    ]),
    "index.html":
      '<!doctype html>\n<div id="root"></div>\n<script type="module" src="/src/main.ts"></script>\n',
    "src/main.ts": 'document.querySelector("#root")?.append("Hello from ohmyho.st");\n',
    "vite.config.ts":
      options.config ??
      'import { defineConfig } from "vite";\n\nexport default defineConfig({});\n',
  });
}

function tanStackSource(
  options: Readonly<{ start?: string; config?: string }> = {},
): Readonly<Record<string, string>> {
  const declared = {
    "@tanstack/react-router": "1.170.41",
    "@tanstack/react-start": options.start ?? "1.168.60",
    react: "19.2.8",
    "react-dom": "19.2.8",
  };
  const development = { "@vitejs/plugin-react": "6.1.0", vite: "8.2.2" };
  return Object.freeze({
    "ohmyhost.yaml": corpusConfiguration("pnpm", "dist/client", "static"),
    "package.json": corpusJson({
      name: "website",
      private: true,
      packageManager: CORPUS_MANAGERS.pnpm[0],
      scripts: { build: "vite build" },
      dependencies: declared,
      devDependencies: development,
    }),
    "pnpm-lock.yaml": corpusLockfile(
      "pnpm",
      { ...declared, ...development },
      {
        "@tanstack/react-router": `${declared["@tanstack/react-router"]}(react-dom@19.2.8(react@19.2.8))(react@19.2.8)`,
        "@tanstack/react-start": `${declared["@tanstack/react-start"]}(react-dom@19.2.8(react@19.2.8))(react@19.2.8)(vite@8.2.2)`,
        react: "19.2.8",
        "react-dom": "19.2.8(react@19.2.8)",
        "@vitejs/plugin-react": "6.1.0(vite@8.2.2)",
        vite: "8.2.2",
      },
      ["@vitejs/plugin-react", "vite"],
    ),
    "vite.config.ts": options.config ?? CORPUS_TANSTACK_CONFIG,
    "src/routes/index.tsx":
      'import { createFileRoute } from "@tanstack/react-router";\n\nexport const Route = createFileRoute("/")({ component: () => <main>Hello</main> });\n',
  });
}
