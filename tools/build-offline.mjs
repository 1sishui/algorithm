/**
 * 把带 ES Module 的工程打包成一个「双击就能打开」的单文件 HTML。
 *
 * 为什么要它：file:// 协议下浏览器不允许加载 ../src/app.js 这种模块（CORS），
 * 所以带模块的版本必须起本地服务；单文件版把 CSS/JS 全部内联，双击即可。
 *
 * 这不是通用打包器，只适用于本项目「一个模块 = 一个文件 + 顶部 import」的写法。
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const OUT = path.join(root, '算法学习智能体-离线版.html');

// 需要打包的模块清单。真正的执行顺序由下面的拓扑排序决定，
// 不用手工维护“谁必须在谁前面”——漏排一次就会白屏，交给代码算更稳。
const MODULES = [
  'src/knowledge/graph.js',
  'src/diagnosis/rules.js',
  'src/ui/mastery.js',
  'src/core/player.js',
  'src/render/arrayBars.js',
  'src/render/treeView.js',
  'src/render/graphView.js',
  'src/algorithms/tree/model.js',
  'src/algorithms/tree/traversal.js',
  'src/algorithms/graph/model.js',
  'src/algorithms/graph/traversal.js',
  'src/llm/client.js',
  'src/user/runner.js',
  'src/user/history.js',
  'src/assessment/features.js',
  'src/import/luogu.js',
  'src/import/luoguClient.js',
  'src/assessment/submissions.js',
  'src/assessment/diff.js',
  'src/assessment/correction.js',
  'src/agent/report.js',
  'src/ui/diagnosisPanel.js',
  'src/algorithms/sort/quick.js',
  'src/algorithms/sort/bubble.js',
  'src/algorithms/sort/insertion.js',
  'src/algorithms/registry.js',
  'src/app.js'
];

function moduleId(relPath) {
  return '__m_' + relPath.replace(/^src\//, '').replace(/\.js$/, '').replace(/[\/-]/g, '_');
}

function specToPath(spec, fromFile) {
  // 相对导入要相对于「当前文件所在的目录」解析，否则 registry.js 里的 './sort/quick.js' 会算错
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
}

function collectExports(code) {
  const names = new Set();
  const re = /^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(code)) !== null) names.add(m[1]);
  return [...names];
}

function stripImports(code, fromFile) {
  let out = code;
  // import * as ns from './x.js'
  out = out.replace(/^import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm, (_, ns, spec) => {
    return `const ${ns} = ${moduleId(specToPath(spec, fromFile))};`;
  });
  // import { a, b as c } from './x.js'
  out = out.replace(/^import\s+\{([^}]*)\}\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm, (_, names, spec) => {
    const id = moduleId(specToPath(spec, fromFile));
    const mapping = names
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const [orig, alias] = s.split(/\s+as\s+/).map((x) => x.trim());
        return alias ? `${orig}: ${alias}` : orig;
      })
      .join(', ');
    return `const { ${mapping} } = ${id};`;
  });
  return out;
}

/**
 * 拓扑排序：被依赖的模块先执行。
 * 单文件版里每个模块是一个立即执行的 IIFE，顺序错了会直接白屏，
 * 所以这里从 import 语句自动推导顺序，避免手工维护出错。
 */
function topoOrder(modules) {
  const deps = new Map();
  for (const rel of modules) {
    const code = fs.readFileSync(path.join(root, rel), 'utf8');
    const found = [];
    const re = /^import\s+(?:\*\s+as\s+\w+|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/gm;
    let match;
    while ((match = re.exec(code)) !== null) {
      const target = specToPath(match[1], rel);
      if (modules.includes(target)) found.push(target);
    }
    deps.set(rel, found);
  }

  const ordered = [];
  const visiting = new Set();
  const done = new Set();

  const visit = (rel) => {
    if (done.has(rel)) return;
    if (visiting.has(rel)) throw new Error(`循环依赖：${rel}`);
    visiting.add(rel);
    for (const dep of deps.get(rel) || []) visit(dep);
    visiting.delete(rel);
    done.add(rel);
    ordered.push(rel);
  };

  for (const rel of modules) visit(rel);
  return ordered;
}

const chunks = [];
for (const rel of topoOrder(MODULES)) {
  const file = path.join(root, rel);
  let code = fs.readFileSync(file, 'utf8');
  const exports = collectExports(code);
  code = stripImports(code, rel);
  code = code.replace(/^export\s+/gm, '');

  chunks.push(
    `/* ===== ${rel} ===== */\n` +
      `const ${moduleId(rel)} = (function () {\n${code}\nreturn { ${exports.join(', ')} };\n})();`
  );
}

const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

html = html.replace(
  /<link rel="stylesheet" href="\.\/src\/styles\.css">\s*/,
  `<style>\n${css}\n</style>\n`
);
html = html.replace(
  /<script type="module" src="\.\/src\/app\.js"><\/script>/,
  `<script>\n${chunks.join('\n\n')}\n</script>`
);
html = html.replace('<title>算法学习智能体 · 原型 v0.1</title>', '<title>算法学习智能体 · 原型 v0.1（离线版）</title>');

if (html.includes('src="') || html.includes('type="module"')) {
  throw new Error('还有没内联的外部资源，检查 index.html');
}

fs.writeFileSync(OUT, html, 'utf8');
console.log('已生成:', OUT, (html.length / 1024).toFixed(1) + ' KB');