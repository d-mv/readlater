// Coverage gate for the Supabase edge functions: runs their tests with
// coverage, then fails unless every non-test .ts file under
// supabase/functions/ is at 100% lines, branches and functions. A file the
// tests never load counts as uncovered, so a new module can't slip past by
// having no test at all.
//
// Run via `deno task coverage:functions` (see deno.json for permissions).

const FUNCTIONS_DIR = "supabase/functions";
const TEST_ARGS = ["--frozen", "--allow-env", "--node-modules-dir=none"];

interface FileCoverage {
  lines: { found: number; hit: number; missed: number[] };
  branches: { found: number; hit: number; missed: number[] };
  functions: { found: number; hit: number; missed: string[] };
}

async function run(args: string[], capture: boolean): Promise<string> {
  const output = await new Deno.Command("deno", {
    args,
    stdout: capture ? "piped" : "inherit",
    stderr: "inherit",
  }).output();
  if (output.code !== 0) throw new Error(`\`deno ${args.join(" ")}\` exited with ${output.code}`);
  return capture ? new TextDecoder().decode(output.stdout) : "";
}

async function listSources(dir: string): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) out.push(...await listSources(path));
    else if (entry.isFile && path.endsWith(".ts") && !path.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

function parseLcov(lcov: string, root: string): Map<string, FileCoverage> {
  const files = new Map<string, FileCoverage>();
  let current: FileCoverage | undefined;
  const fnLines = new Map<string, string>();
  for (const line of lcov.split("\n")) {
    const [tag, ...rest] = line.split(":");
    const value = rest.join(":");
    if (tag === "SF") {
      const path = value.replace(/^file:\/\//, "");
      current = {
        lines: { found: 0, hit: 0, missed: [] },
        branches: { found: 0, hit: 0, missed: [] },
        functions: { found: 0, hit: 0, missed: [] },
      };
      fnLines.clear();
      files.set(path.startsWith(root) ? path.slice(root.length + 1) : path, current);
    } else if (!current) {
      continue;
    } else if (tag === "DA") {
      const [lineNo, count] = value.split(",");
      current.lines.found++;
      if (Number(count) > 0) current.lines.hit++;
      else current.lines.missed.push(Number(lineNo));
    } else if (tag === "BRDA") {
      const [lineNo, , , taken] = value.split(",");
      current.branches.found++;
      if (taken !== "-" && Number(taken) > 0) current.branches.hit++;
      else current.branches.missed.push(Number(lineNo));
    } else if (tag === "FN") {
      const [lineNo, name] = value.split(",");
      fnLines.set(name, lineNo);
      current.functions.found++;
    } else if (tag === "FNDA") {
      const [count, name] = value.split(",");
      if (Number(count) > 0) current.functions.hit++;
      else current.functions.missed.push(`${name} (line ${fnLines.get(name)})`);
    }
  }
  return files;
}

const pct = (hit: number, found: number) => (found === 0 ? 100 : (hit / found) * 100).toFixed(1);
const uniq = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b).join(", ");

const root = Deno.cwd();
const covDir = await Deno.makeTempDir({ prefix: "functions-coverage-" });
try {
  await run(["test", ...TEST_ARGS, `--coverage=${covDir}`, `${FUNCTIONS_DIR}/`], false);
  const lcov = await run(["coverage", covDir, `--include=${FUNCTIONS_DIR}/`, "--lcov"], true);
  const coverage = parseLcov(lcov, root);
  const sources = (await listSources(FUNCTIONS_DIR)).sort();

  const failures: string[] = [];
  console.log("\nFile                                              Branch %  Function %  Line %");
  for (const file of sources) {
    const c = coverage.get(file);
    if (!c) {
      console.log(`${file.padEnd(50)}  (not loaded by any test)`);
      failures.push(`${file}: not loaded by any test`);
      continue;
    }
    const b = pct(c.branches.hit, c.branches.found);
    const f = pct(c.functions.hit, c.functions.found);
    const l = pct(c.lines.hit, c.lines.found);
    console.log(`${file.padEnd(50)}  ${b.padStart(7)}  ${f.padStart(10)}  ${l.padStart(6)}`);
    if (c.lines.missed.length) failures.push(`${file}: uncovered lines ${uniq(c.lines.missed)}`);
    if (c.branches.missed.length) failures.push(`${file}: untaken branches on lines ${uniq(c.branches.missed)}`);
    if (c.functions.missed.length) failures.push(`${file}: uncalled functions ${c.functions.missed.join(", ")}`);
  }

  if (failures.length) {
    console.error(`\nCoverage gate FAILED — every file must be 100% lines/branches/functions:`);
    for (const failure of failures) console.error(`  ${failure}`);
    Deno.exitCode = 1;
  } else {
    console.log(`\nCoverage gate passed: ${sources.length} files at 100% lines/branches/functions.`);
  }
} catch (err) {
  console.error(`\n${err instanceof Error ? err.message : err}`);
  Deno.exitCode = 1;
} finally {
  await Deno.remove(covDir, { recursive: true });
}
